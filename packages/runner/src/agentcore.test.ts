import { describe, expect, it } from "bun:test";
import { agentcoreSessionId } from "@metaprompt/shared";
import { envFromProcess, harnessInvokeUrl, invokeAgentcore, runtimeInvokeUrl } from "./agentcore.js";

describe("agentcore invoke", () => {
  it("builds harness and runtime URLs", () => {
    const harness = harnessInvokeUrl({
      region: "us-west-2",
      harnessArn: "arn:aws:bedrock-agentcore:us-west-2:1:harness/demo-abcdefghij",
      qualifier: "DEFAULT",
    });
    expect(harness.host).toBe("bedrock-agentcore.us-west-2.amazonaws.com");
    expect(harness.pathname).toBe("/harnesses/invoke");
    expect(harness.searchParams.get("harnessArn")).toContain("harness/demo-abcdefghij");
    expect(harness.searchParams.get("qualifier")).toBe("DEFAULT");

    const runtime = runtimeInvokeUrl({
      region: "us-east-1",
      runtimeArn: "arn:aws:bedrock-agentcore:us-east-1:1:runtime/agent-abcdefghij",
    });
    expect(runtime.pathname).toContain("/runtimes/");
    expect(decodeURIComponent(runtime.pathname)).toContain("runtime/agent-abcdefghij");
  });

  it("reads invoke env without printing the run token", () => {
    const env = envFromProcess({
      METAPROMPT_RUN_ID: "run_abc",
      METAPROMPT_PROMPT: "ping",
      METAPROMPT_RUN_TOKEN: "secret-token",
      METAPROMPT_AGENTCORE_HARNESS_ARN: "arn:harness",
      METAPROMPT_RESOLVED_MODEL: JSON.stringify({
        id: "bedrock-sonnet",
        provider: "bedrock",
        vendorId: "us.anthropic.claude-sonnet-4-6",
      }),
      AWS_REGION: "us-east-1",
    });
    expect(env.modelId).toBe("us.anthropic.claude-sonnet-4-6");
    expect(env.harnessArn).toBe("arn:harness");
    expect(env.planeToken).toBe("secret-token");
  });

  it("POSTs InvokeHarness and extracts streamed text", async () => {
    const calls: Array<{ url: string; headers: HeadersInit; body: string }> = [];
    const text = await invokeAgentcore(
      {
        runId: "run_1",
        prompt: "ping",
        region: "us-east-1",
        harnessArn: "arn:aws:bedrock-agentcore:us-east-1:1:harness/demo-abcdefghij",
        planeUrl: "http://metaprompt-mcp:3333",
        planeToken: "run-token",
      },
      {
        credentials: { accessKeyId: "AKI", secretAccessKey: "secret" },
        fetchImpl: async (url, init) => {
          calls.push({
            url: String(url),
            headers: init?.headers ?? {},
            body: String(init?.body ?? ""),
          });
          return new Response(
            JSON.stringify([
              { contentBlockDelta: { delta: { text: "pong" } } },
              { messageStop: { stopReason: "end_turn" } },
            ]),
            { status: 200 },
          );
        },
      },
    );
    expect(text).toBe("pong");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/harnesses/invoke");
    const headers = calls[0]!.headers as Record<string, string>;
    expect(headers["x-amzn-bedrock-agentcore-runtime-session-id"]).toBe(agentcoreSessionId("run_1"));
    expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
    const payload = JSON.parse(calls[0]!.body) as { tools: Array<{ type: string }> };
    expect(payload.tools.some((t) => t.type === "remote_mcp")).toBe(true);
    expect(calls[0]!.body).not.toContain("AKI");
  });
});
