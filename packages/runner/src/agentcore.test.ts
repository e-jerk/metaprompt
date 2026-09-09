import { describe, expect, it } from "bun:test";
import { agentcoreSessionId } from "@metaprompt/shared";
import {
  createMemoryEvent,
  envFromProcess,
  harnessInvokeUrl,
  invokeAgentcore,
  memoryEventUrl,
  memoryRetrieveUrl,
  mintCatalogMcpAuth,
  runtimeInvokeUrl,
} from "./agentcore.js";

describe("agentcore invoke", () => {
  it("builds harness, runtime, and memory URLs", () => {
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
    expect(memoryEventUrl("us-east-1", "mem-abcdefghij").pathname).toBe("/memories/mem-abcdefghij/events");
    expect(memoryRetrieveUrl("us-east-1", "mem-abcdefghij").pathname).toBe("/memories/mem-abcdefghij/retrieve");
  });

  it("reads invoke env without printing the run token", () => {
    const env = envFromProcess({
      METAPROMPT_RUN_ID: "run_abc",
      METAPROMPT_PROMPT: "ping",
      METAPROMPT_RUN_TOKEN: "secret-token",
      METAPROMPT_OWNER: "alice",
      METAPROMPT_PARTY_ID: "party_1",
      METAPROMPT_AGENTCORE_HARNESS_ARN: "arn:harness",
      METAPROMPT_PLANE_URL: "http://metaprompt-mcp:3333",
      METAPROMPT_PLANE_EXTERNAL_URL: "https://plane.example",
      METAPROMPT_AGENTCORE_MEMORY_ARN: "arn:aws:bedrock-agentcore:us-east-1:1:memory/mem-abcdefghij",
      METAPROMPT_SKILLS: JSON.stringify([{ name: "xlsx", url: "s3://skills/xlsx/" }]),
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
    expect(env.planePublicUrl).toBe("https://plane.example");
    expect(env.memoryArn).toContain("memory/mem-");
    expect(env.skills?.[0]?.url).toBe("s3://skills/xlsx/");
  });

  it("POSTs InvokeHarness with actor, baggage, and extracts streamed text", async () => {
    const calls: Array<{ url: string; headers: HeadersInit; body: string }> = [];
    const result = await invokeAgentcore(
      {
        runId: "run_1",
        prompt: "ping",
        region: "us-east-1",
        owner: "alice",
        partyId: "party_1",
        harnessArn: "arn:aws:bedrock-agentcore:us-east-1:1:harness/demo-abcdefghij",
        planeUrl: "http://metaprompt-mcp:3333",
        planePublicUrl: "https://plane.example",
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
              { metadata: { usage: { inputTokens: 3, outputTokens: 1 } } },
              { messageStop: { stopReason: "end_turn" } },
            ]),
            { status: 200 },
          );
        },
      },
    );
    expect(result.text).toBe("pong");
    expect(result.actorId).toBe("alice");
    expect(result.sessionId).toBe(agentcoreSessionId("run_1"));
    expect(result.usage.inputTokens).toBe(3);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/harnesses/invoke");
    const headers = calls[0]!.headers as Record<string, string>;
    expect(headers["x-amzn-bedrock-agentcore-runtime-session-id"]).toBe(agentcoreSessionId("run_1"));
    expect(headers["x-amzn-bedrock-agentcore-runtime-user-id"]).toBe("alice");
    expect(headers.baggage).toContain("mp.run=run_1");
    expect(headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
    const payload = JSON.parse(calls[0]!.body) as {
      actorId: string;
      tools: Array<{ type: string; config?: { remoteMcp?: { url: string } } }>;
    };
    expect(payload.actorId).toBe("alice");
    expect(payload.tools.some((t) => t.type === "remote_mcp")).toBe(true);
    expect(payload.tools[0]!.config?.remoteMcp?.url).toBe("https://plane.example/mcp");
    expect(calls[0]!.body).not.toContain("AKI");
  });

  it("retrieves memory before invoke and writes CreateEvent after", async () => {
    const calls: string[] = [];
    const result = await invokeAgentcore(
      {
        runId: "run_mem",
        prompt: "remember this",
        region: "us-east-1",
        owner: "alice",
        harnessArn: "arn:aws:bedrock-agentcore:us-east-1:1:harness/demo-abcdefghij",
        memoryArn: "arn:aws:bedrock-agentcore:us-east-1:1:memory/mem-abcdefghij",
        planeUrl: "http://plane",
      },
      {
        credentials: { accessKeyId: "AKI", secretAccessKey: "secret" },
        fetchImpl: async (url, init) => {
          const href = String(url);
          calls.push(href);
          if (href.includes("/retrieve")) {
            return Response.json({
              memoryRecordSummaries: [{ content: { text: "alice likes concise diffs" } }],
            });
          }
          const body = String(init?.body ?? "");
          expect(body).toContain("alice likes concise diffs");
          return Response.json([{ contentBlockDelta: { delta: { text: "ok" } } }]);
        },
      },
    );
    expect(result.text).toBe("ok");
    expect(calls.some((u) => u.includes("/retrieve"))).toBe(true);

    const events: string[] = [];
    await createMemoryEvent(
      {
        region: "us-east-1",
        memoryArn: "arn:aws:bedrock-agentcore:us-east-1:1:memory/mem-abcdefghij",
        runId: "run_mem",
        partyId: "party_1",
        prompt: "remember this",
      },
      result,
      { accessKeyId: "AKI", secretAccessKey: "secret" },
      async (url, init) => {
        events.push(String(url));
        const body = JSON.parse(String(init?.body ?? "{}")) as { actorId: string; sessionId: string };
        expect(body.actorId).toBe("alice");
        expect(body.sessionId).toBe(result.sessionId);
        return new Response("{}", { status: 201 });
      },
    );
    expect(events[0]).toContain("/memories/mem-abcdefghij/events");
  });

  it("mints catalog MCP tokens from the plane without printing them", async () => {
    const mcps = await mintCatalogMcpAuth(
      [{ name: "linear", url: "https://mcp.linear.app/mcp" }],
      { planeUrl: "http://plane", planeToken: "run-token" },
      async (_url, init) => {
        expect(String(init?.body ?? "")).toContain("app.cred.mint");
        return Response.json({
          jsonrpc: "2.0",
          result: { content: [{ type: "text", text: JSON.stringify({ token: "lin_tmp" }) }] },
        });
      },
    );
    expect(mcps[0]?.token).toBe("lin_tmp");
  });
});
