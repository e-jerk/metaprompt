import { defaultHarnesses } from "@metaprompt/shared";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { bedrockOmitsAnthropicKey, commandFor } from "./adapters.js";
import { materializePrefix, prefixInventory } from "./prefix-files.js";

describe("adapters", () => {
  it("disallows Task/subagent on every catalog harness", () => {
    for (const h of defaultHarnesses()) {
      expect(h.disallowedTools).toEqual(expect.arrayContaining(["Task", "Agent", "subagent"]));
    }
  });

  it("sets Bedrock env and omits Anthropic key", () => {
    const claude = defaultHarnesses().find((h) => h.name === "claude-code")!;
    const run = {
      id: "run_1",
      resolvedModel: { id: "bedrock-sonnet", provider: "bedrock", vendorId: "us.anthropic.claude-sonnet-4-6" },
    };
    const { env, argv } = commandFor(claude, run as never, false);
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBe("1");
    expect(argv).toContain("us.anthropic.claude-sonnet-4-6");
    expect(bedrockOmitsAnthropicKey(run as never)).toBe(true);
  });

  it("passes OpenCode Zen free model as -m provider/id", () => {
    const oc = defaultHarnesses().find((h) => h.name === "opencode")!;
    const { argv } = commandFor(
      oc,
      {
        id: "r",
        prompt: "ping",
        resolvedModel: { id: "mimo-v2.5-free", provider: "opencode", vendorId: "opencode/mimo-v2.5-free" },
      } as never,
      false,
    );
    expect(argv).toEqual(expect.arrayContaining(["-m", "opencode/mimo-v2.5-free", "ping"]));
  });

  it("maps cursor auto", () => {
    const cursor = defaultHarnesses().find((h) => h.name === "cursor")!;
    const { env } = commandFor(
      cursor,
      { id: "r", resolvedModel: { id: "auto", provider: "cursor", vendorId: "auto" } } as never,
      false,
    );
    expect(env.CURSOR_MODEL).toBe("auto");
  });
});

describe("prefix materialize", () => {
  it("writes stable prefix files and pointers", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mp-"));
    const stub = defaultHarnesses().find((h) => h.name === "stub")!;
    const result = await materializePrefix({
      cwd,
      harness: stub,
      skills: [{ name: "review", content: "review it" }],
      mcpServers: [{ name: "linear" }],
      planeUrl: "http://plane",
      childMcpUrl: "http://child",
    });
    expect(result.prefixHash).toBe(
      prefixInventory(stub, [{ name: "review", content: "review it" }], [{ name: "linear" }]).hash,
    );
    const mcp = JSON.parse(await readFile(join(cwd, "mcp.json"), "utf8"));
    expect(Object.keys(mcp.mcpServers).sort()).toEqual(["jj", "linear", "party", "plane"]);
    expect(mcp.mcpServers.plane.url).toBe("http://plane/mcp");
    expect(mcp.mcpServers.party.url).toBe("http://child/mcp");
    expect(mcp.mcpServers.jj.url).toBe("http://child/jj");
    expect(await readFile(join(cwd, "skills/review/SKILL.md"), "utf8")).toContain("review it");
    expect(await readFile(join(cwd, ".cursor/skills/review/SKILL.md"), "utf8")).toContain("review it");
  });

  it("session prefix points always-on MCPs at the plane with a bearer", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mp-sess-"));
    const stub = defaultHarnesses().find((h) => h.name === "stub")!;
    await materializePrefix({
      cwd,
      harness: stub,
      skills: [],
      mcpServers: [],
      planeUrl: "http://metaprompt-mcp:3333",
      childMcpUrl: "http://127.0.0.1:3334",
      planeToken: "run-token",
      alwaysOnViaPlane: true,
    });
    const mcp = JSON.parse(await readFile(join(cwd, "mcp.json"), "utf8"));
    expect(mcp.mcpServers.plane).toEqual({
      url: "http://metaprompt-mcp:3333/mcp",
      headers: { Authorization: "Bearer run-token" },
    });
    expect(mcp.mcpServers.party).toEqual(mcp.mcpServers.plane);
    expect(mcp.mcpServers.jj).toEqual(mcp.mcpServers.plane);
  });

  it("points party and jj at the in-pod child MCP with the run bearer", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mp-child-"));
    const stub = defaultHarnesses().find((h) => h.name === "stub")!;
    await materializePrefix({
      cwd,
      harness: stub,
      skills: [],
      mcpServers: [],
      planeUrl: "http://metaprompt-mcp:3333",
      childMcpUrl: "http://127.0.0.1:3334",
      planeToken: "run-token",
    });
    const mcp = JSON.parse(await readFile(join(cwd, "mcp.json"), "utf8"));
    expect(mcp.mcpServers.plane).toEqual({
      url: "http://metaprompt-mcp:3333/mcp",
      headers: { Authorization: "Bearer run-token" },
    });
    expect(mcp.mcpServers.party).toEqual({
      url: "http://127.0.0.1:3334/mcp",
      headers: { Authorization: "Bearer run-token" },
    });
    expect(mcp.mcpServers.jj).toEqual({
      url: "http://127.0.0.1:3334/jj",
      headers: { Authorization: "Bearer run-token" },
    });
  });
});
