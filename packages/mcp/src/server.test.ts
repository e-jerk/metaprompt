import { defaultConfig, identityFromStatic } from "@metaprompt/shared";
import { describe, expect, it } from "bun:test";
import { Plane } from "./plane.js";
import { createApp } from "./server.js";

function listen(app: ReturnType<typeof createApp>): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

async function rpc(
  url: string,
  token: string | undefined,
  method: string,
  params?: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${url}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function call(url: string, token: string, name: string, args: Record<string, unknown> = {}) {
  const { status, body } = await rpc(url, token, "tools/call", { name, arguments: args });
  if (status !== 200 || body.error) {
    const err = body.error as { message?: string; code?: number } | undefined;
    throw Object.assign(new Error(err?.message ?? `http ${status}`), { status, code: err?.code, body });
  }
  return JSON.parse((body.result as { content: { text: string }[] }).content[0]!.text);
}

describe("HTTP MCP", () => {
  it("lists tools and creates a stub run as alice", async () => {
    const plane = new Plane(defaultConfig());
    const { url, close } = await listen(createApp(plane));
    try {
      const listed = await rpc(url, "alice-token", "tools/list");
      const tools = (listed.body.result as { tools: { name: string }[] }).tools.map((t) => t.name);
      expect(tools).toContain("run.create");
      expect(tools).toContain("memory.put");
      const created = await call(url, "alice-token", "run.create", { harness: "stub", repo: "app", prompt: "hi" });
      expect(created.harness).toBe("stub");
      expect(created.owner).toBe(identityFromStatic(plane.config.staticUsers[1]!).user);
    } finally {
      await close();
    }
  });

  it("covers catalog, auth, party, cron, mint, and memory", async () => {
    const plane = new Plane(defaultConfig());
    const { url, close } = await listen(createApp(plane));
    try {
      const harnesses = await call(url, "alice-token", "harness.list");
      expect(harnesses.some((h: { name: string }) => h.name === "stub")).toBe(true);
      expect((await call(url, "alice-token", "harness.get", { name: "stub" })).name).toBe("stub");
      expect((await call(url, "alice-token", "model.list")).length).toBeGreaterThan(0);
      expect((await call(url, "alice-token", "skill.list")).some((s: { name: string }) => s.name === "review")).toBe(true);
      const mcps = await call(url, "alice-token", "mcp.list");
      expect(mcps.every((m: { name: string }) => m.name !== "clanker")).toBe(true);
      expect((await call(url, "alice-token", "repo.list")).some((r: { name: string }) => r.name === "app")).toBe(true);
      expect((await call(url, "alice-token", "asset.list")).some((a: { name: string }) => a.name === "eval-set")).toBe(true);

      const missing = await rpc(url, undefined, "tools/list");
      expect(missing.status).toBe(401);

      const run = await call(url, "alice-token", "run.create", {
        harness: "stub",
        repo: "app",
        prompt: "http-acl",
        storage: "tmpfs",
      });
      await expect(call(url, "bob-token", "run.get", { runId: run.id })).rejects.toThrow(/cannot read|403/);
      await expect(call(url, "alice-token", "job.spawn", { agents: [{ harness: "stub", prompt: "x" }] })).rejects.toThrow(
        /run token/,
      );
      await expect(
        call(url, "alice-token", "run.create", { harness: "stub", repo: "app", mcpServers: [{ name: "clanker" }] }),
      ).rejects.toThrow(/parent-only/);

      const party = await call(url, "alice-token", "party.create");
      await call(url, "alice-token", "coord.post", { partyId: party.id, body: "hello" });
      const inbox = await call(url, "alice-token", "coord.inbox", { partyId: party.id });
      expect(inbox.some((e: { type: string }) => e.type === "post")).toBe(true);
      await call(url, "alice-token", "coord.barrier", { partyId: party.id });
      await call(url, "alice-token", "coord.handoff", {
        partyId: party.id,
        harness: "stub",
        prompt: "handoff",
        message: "next",
        storage: "tmpfs",
      });
      await call(url, "alice-token", "coord.artifact.put", { partyId: party.id, name: "note", bytes: "abc" });
      expect((await call(url, "alice-token", "coord.artifact.get", { partyId: party.id, name: "note" })).bytes).toBe("abc");
      expect(await call(url, "alice-token", "coord.wait", { partyId: party.id })).toEqual({ ok: true });
      expect(await call(url, "alice-token", "coord.signal", { partyId: party.id })).toEqual({ ok: true });

      const cron = await call(url, "alice-token", "cron.create", {
        name: "tmp-http",
        schedule: "0 2 * * *",
        harness: "stub",
        repo: "app",
        prompt: "cron",
        storage: "tmpfs",
        concurrencyPolicy: "Forbid",
      });
      expect(cron.storage).toBe("tmpfs");
      await expect(call(url, "bob-token", "cron.list")).resolves.toEqual([]);
      await call(url, "alice-token", "cron.delete", { name: "tmp-http" });

      const minted = await call(url, "alice-token", "vcs.cred.mint", { repo: "app", op: "push", runId: run.id });
      expect(minted.ephemeral).toBe(true);
      const got = await call(url, "alice-token", "run.get", { runId: run.id });
      expect(JSON.stringify(got)).not.toContain("fake-pat");

      const userMem = await call(url, "alice-token", "memory.put", { scope: "user", text: "alice user memory phrase" });
      const partyMem = await call(url, "alice-token", "memory.put", {
        scope: "party",
        partyId: party.id,
        text: "alice party memory phrase",
      });
      const repoMem = await call(url, "alice-token", "memory.put", {
        scope: "repo",
        repo: "app",
        text: "alice repo memory phrase",
      });
      const hits = await call(url, "alice-token", "memory.search", { query: "alice user memory phrase", scope: "user" });
      expect(hits[0].id).toBe(userMem.id);
      await expect(call(url, "bob-token", "memory.get", { id: userMem.id })).rejects.toThrow(/cannot read|403/);
      await call(url, "alice-token", "party.add", { partyId: party.id, subject: "user:bob", role: "member" });
      const partyHits = await call(url, "bob-token", "memory.search", {
        query: "alice party memory phrase",
        scope: "party",
        partyId: party.id,
      });
      expect(partyHits.some((h: { id: string }) => h.id === partyMem.id)).toBe(true);
      expect((await call(url, "alice-token", "memory.get", { id: repoMem.id })).repo).toBe("app");
      await call(url, "alice-token", "memory.delete", { id: userMem.id });
    } finally {
      await close();
    }
  });
});
