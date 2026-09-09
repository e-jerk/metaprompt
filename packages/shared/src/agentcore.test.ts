import { describe, expect, it } from "bun:test";
import {
  AGENTCORE_GATEWAY_NAME,
  agentcoreActorId,
  agentcoreBaggage,
  agentcoreConfigured,
  agentcoreMemoryNamespace,
  agentcoreMode,
  agentcoreSessionId,
  catalogMcpsForAgentcore,
  extractHarnessText,
  extractHarnessUsage,
  invokeHarnessBody,
  memoryIdFromArn,
  parseAgentcoreStream,
  skillRefsToHarnessSkills,
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

  it("pads session ids and sanitizes actor ids", () => {
    expect(agentcoreSessionId("run_1").length).toBe(33);
    expect(agentcoreSessionId("run_1")).toMatch(/^run_1/);
    const long = `run_${"x".repeat(120)}`;
    expect(agentcoreSessionId(long).length).toBe(100);
    expect(agentcoreActorId("alice")).toBe("alice");
    expect(agentcoreActorId("octocat[bot]")).toBe("octocat-bot");
    expect(agentcoreActorId("")).toBe("user");
  });

  it("derives memory id and namespace from ARN / actor", () => {
    expect(memoryIdFromArn("arn:aws:bedrock-agentcore:us-east-1:1:memory/mem-abcdefghij")).toBe("mem-abcdefghij");
    expect(agentcoreMemoryNamespace("alice")).toBe("/actors/alice");
    expect(agentcoreMemoryNamespace("alice", "/party/{actorId}")).toBe("/party/alice");
    expect(agentcoreBaggage({ runId: "run_1", partyId: "p1", rootRunId: "run_0", attempt: 2 })).toBe(
      "mp.run=run_1,mp.party=p1,mp.root=run_0,mp.attempt=2",
    );
  });

  it("maps skill refs and catalog MCPs onto InvokeHarness", () => {
    const skills = skillRefsToHarnessSkills(
      [
        { name: "review", content: "look for bugs" },
        { name: "xlsx", url: "https://github.com/anthropics/skills?path=skills/xlsx" },
        { name: "sops", url: "s3://bucket/skills/sops/" },
      ],
      ["core-skills/*"],
    );
    expect(skills).toEqual([
      { awsSkills: { paths: ["core-skills/*"] } },
      { git: { url: "https://github.com/anthropics/skills", path: "skills/xlsx" } },
      { s3: { uri: "s3://bucket/skills/sops/" } },
    ]);
    expect(
      catalogMcpsForAgentcore([
        { name: "linear", url: "https://mcp.linear.app/mcp" },
        { name: AGENTCORE_GATEWAY_NAME, url: "https://gw.example/mcp" },
        { name: "jj" },
      ]),
    ).toEqual([{ name: "linear", url: "https://mcp.linear.app/mcp" }]);
  });

  it("builds InvokeHarness body with actor, plane MCP, skills, and Bedrock model", () => {
    const body = invokeHarnessBody({
      prompt: "ping",
      planeUrl: "https://metaprom.example/plane",
      planeToken: "run-token",
      modelId: "us.anthropic.claude-sonnet-4-6",
      gatewayArn: "arn:aws:bedrock-agentcore:us-east-1:1:gateway/g-abcdefghij",
      enableBrowser: true,
      actorId: "alice",
      systemTexts: ["Use job.spawn for children."],
      skills: [{ awsSkills: { paths: ["core-skills/aws-cdk"] } }],
      mcpServers: [{ name: "linear", url: "https://mcp.linear.app/mcp" }],
      maxIterations: 12,
    });
    expect(body.actorId).toBe("alice");
    expect(body.maxIterations).toBe(12);
    expect(body.messages).toEqual([{ role: "user", content: [{ text: "ping" }] }]);
    expect(body.model).toEqual({ bedrockModelConfig: { modelId: "us.anthropic.claude-sonnet-4-6" } });
    expect(body.skills).toEqual([{ awsSkills: { paths: ["core-skills/aws-cdk"] } }]);
    const tools = body.tools as Array<{ type: string; name: string; config?: Record<string, unknown> }>;
    expect(tools.map((t) => t.type)).toEqual([
      "remote_mcp",
      "remote_mcp",
      "agentcore_gateway",
      "agentcore_browser",
    ]);
    expect((tools[0]!.config as { remoteMcp: { url: string } }).remoteMcp.url).toBe(
      "https://metaprom.example/plane/mcp",
    );
    expect((tools[2]!.config as { agentCoreGateway: { arn: string } }).agentCoreGateway.arn).toContain("gateway/g-");
    expect(JSON.stringify(body)).toContain("job.spawn");
    expect(JSON.stringify(body.systemPrompt)).toContain("Use job.spawn for children.");
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

  it("extracts streamed text deltas and usage", () => {
    const events = [
      { messageStart: { role: "assistant" } },
      { contentBlockDelta: { delta: { text: "hel" } } },
      { contentBlockDelta: { delta: { text: "lo" } } },
      {
        metadata: {
          usage: {
            inputTokens: 10,
            outputTokens: 4,
            cacheReadInputTokens: 2,
            cacheWriteInputTokens: 1,
          },
        },
      },
      { messageStop: { stopReason: "end_turn" } },
    ];
    expect(extractHarnessText(events)).toBe("hello");
    expect(extractHarnessUsage(events)).toEqual({
      inputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
    });
    expect(parseAgentcoreStream('data: {"text":"x"}\n\ndata: [DONE]\n')).toEqual([{ text: "x" }]);
  });
});
