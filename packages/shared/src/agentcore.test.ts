import { describe, expect, it } from "bun:test";
import {
  AGENTCORE_GATEWAY_NAME,
  agentcoreConfigured,
  agentcoreMode,
  agentcoreSessionId,
  extractHarnessText,
  invokeHarnessBody,
} from "./agentcore.js";
import { defaultConfig } from "./catalog.js";

describe("agentcore helpers", () => {
  it("requires enabled plus a harness or runtime ARN", () => {
    expect(agentcoreConfigured({ enabled: true, region: "us-east-1" })).toBe(false);
    expect(
      agentcoreConfigured({
        enabled: true,
        region: "us-east-1",
        harnessArn: "arn:aws:bedrock-agentcore:us-east-1:1:harness/demo-abcdefghij",
      }),
    ).toBe(true);
    expect(agentcoreMode({ enabled: true, region: "us-east-1", runtimeArn: "arn:runtime" })).toBe("runtime");
  });

  it("pads session ids to 33 characters", () => {
    expect(agentcoreSessionId("run_1").length).toBe(33);
    expect(agentcoreSessionId("run_1")).toMatch(/^run_1/);
    const long = `run_${"x".repeat(120)}`;
    expect(agentcoreSessionId(long).length).toBe(100);
  });

  it("builds InvokeHarness body with plane MCP and optional Bedrock model", () => {
    const body = invokeHarnessBody({
      prompt: "ping",
      planeUrl: "http://metaprompt-mcp:3333",
      planeToken: "run-token",
      modelId: "us.anthropic.claude-sonnet-4-6",
      gatewayArn: "arn:aws:bedrock-agentcore:us-east-1:1:gateway/g-abcdefghij",
      enableBrowser: true,
    });
    expect(body.messages).toEqual([{ role: "user", content: [{ text: "ping" }] }]);
    expect(body.model).toEqual({ bedrockModelConfig: { modelId: "us.anthropic.claude-sonnet-4-6" } });
    const tools = body.tools as Array<{ type: string; name: string; config?: { remoteMcp?: { url: string } } }>;
    expect(tools.map((t) => t.type)).toEqual([
      "remote_mcp",
      "agentcore_gateway",
      "agentcore_browser",
    ]);
    expect(tools[0]!.config?.remoteMcp?.url).toBe("http://metaprompt-mcp:3333/mcp");
    expect(JSON.stringify(body)).toContain("job.spawn");
  });

  it("injects Gateway into the MCP catalog when a URL is set", () => {
    const cfg = defaultConfig({
      agentcore: {
        enabled: true,
        region: "us-east-1",
        gatewayUrl: "https://gw.gateway.bedrock-agentcore.us-east-1.amazonaws.com/mcp",
      },
    });
    expect(cfg.mcpServers.some((m) => m.name === AGENTCORE_GATEWAY_NAME)).toBe(true);
  });

  it("extracts streamed text deltas", () => {
    const text = extractHarnessText([
      { messageStart: { role: "assistant" } },
      { contentBlockDelta: { delta: { text: "hel" } } },
      { contentBlockDelta: { delta: { text: "lo" } } },
      { messageStop: { stopReason: "end_turn" } },
    ]);
    expect(text).toBe("hello");
  });
});
