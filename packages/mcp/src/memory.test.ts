import { defaultConfig, identityFromStatic, type Identity } from "@metaprompt/shared";
import { describe, expect, it } from "bun:test";
import { PlaneError } from "./errors.js";
import { HashEmbedder, cosine } from "./memory.js";
import { Plane } from "./plane.js";

function users(plane: Plane): { alice: Identity; bob: Identity; admin: Identity } {
  const [admin, alice, bob] = plane.config.staticUsers;
  return {
    admin: identityFromStatic(admin!),
    alice: identityFromStatic(alice!),
    bob: identityFromStatic(bob!),
  };
}

function plane(overrides: Parameters<typeof defaultConfig>[0] = {}) {
  return new Plane(defaultConfig({ bedrock: { enabled: false, region: "us-east-1" }, ...overrides }));
}

describe("memory store", () => {
  it("put/search ranks the same text first", async () => {
    const p = plane();
    const { alice } = users(p);
    const text = "alpha bravo unique-vector-phrase";
    const put = await p.memoryPut(alice, { scope: "user", text });
    await p.memoryPut(alice, { scope: "user", text: "unrelated garden vegetables" });
    const hits = await p.memorySearch(alice, { query: text, scope: "user" });
    expect(hits[0]?.id).toBe(put.id);
    expect(hits[0]?.score).toBeGreaterThan(0.99);
  });

  it("hash embedder is deterministic and cosine of self is 1", async () => {
    const e = new HashEmbedder();
    const a = await e.embed("same words here");
    const b = await e.embed("same words here");
    expect(a).toEqual(b);
    expect(cosine(a, b)).toBeCloseTo(1, 8);
  });

  it("denies user/party/repo ACL across principals", async () => {
    const p = plane();
    const { alice, bob } = users(p);
    const party = p.partyCreate(alice);
    const userMem = await p.memoryPut(alice, { scope: "user", text: "alice private note" });
    const partyMem = await p.memoryPut(alice, { scope: "party", partyId: party.id, text: "party shared note" });
    const repoMem = await p.memoryPut(alice, { scope: "repo", repo: "app", text: "repo note about app" });

    const bobUser = await p.memorySearch(bob, { query: "alice private note", scope: "user" });
    expect(bobUser.every((h) => h.id !== userMem.id)).toBe(true);
    await expect(p.memoryGet(bob, userMem.id)).rejects.toBeInstanceOf(PlaneError);

    await expect(p.memoryGet(bob, partyMem.id)).rejects.toBeInstanceOf(PlaneError);
    expect(() => p.partyGet(bob, party.id)).toThrow(PlaneError);

    const bobRepo = await p.memorySearch(bob, { query: "repo note", scope: "repo", repo: "app" });
    expect(bobRepo.some((h) => h.id === repoMem.id)).toBe(true);
    await expect(p.memoryPut(bob, { scope: "repo", repo: "app", text: "bob write" })).rejects.toThrow(/writer/);

    p.partyAdd(alice, party.id, "user:bob", "member");
    const after = await p.memorySearch(bob, { query: "party shared note", scope: "party", partyId: party.id });
    expect(after.some((h) => h.id === partyMem.id)).toBe(true);
  });

  it("party observer cannot put; coordinator or author can delete", async () => {
    const p = plane();
    const { alice, bob } = users(p);
    const party = p.partyCreate(alice);
    p.partyAdd(alice, party.id, "user:bob", "observer");
    await expect(p.memoryPut(bob, { scope: "party", partyId: party.id, text: "nope" })).rejects.toThrow(/member/);
    const mem = await p.memoryPut(alice, { scope: "party", partyId: party.id, text: "keep" });
    await expect(p.memoryDelete(bob, mem.id)).rejects.toBeInstanceOf(PlaneError);
    await expect(p.memoryDelete(alice, mem.id)).resolves.toEqual({ ok: true });
    await expect(p.memoryGet(alice, mem.id)).rejects.toThrow(/not found/);
  });

  it("rejects empty, oversize, and secret-looking text", async () => {
    const small = plane({ limits: { maxMemoryBytes: 32 } });
    const { alice } = users(small);
    await expect(small.memoryPut(alice, { scope: "user", text: "" })).rejects.toThrow(/empty/);
    await expect(small.memoryPut(alice, { scope: "user", text: "   " })).rejects.toThrow(/empty/);
    await expect(small.memoryPut(alice, { scope: "user", text: "x".repeat(40) })).rejects.toThrow(/maxMemoryBytes/);
    const p = plane();
    const { alice: a2 } = users(p);
    await expect(p.memoryPut(a2, { scope: "user", text: "token ghp_abcdefghijklmnopqrstuvwxyz0123" })).rejects.toThrow(
      /secret/,
    );
    await expect(
      p.memoryPut(a2, {
        scope: "user",
        text: "apiVersion: v1\nkind: Config\nclusters:\n- name: x",
      }),
    ).rejects.toThrow(/secret/);
  });

  it("Job identity puts and searches as the run owner", async () => {
    const p = plane();
    const { alice, bob } = users(p);
    const run = await p.createRun(alice, { harness: "stub", repo: "app", prompt: "mem", storage: "tmpfs" });
    const put = await p.memoryPut(p.asRun(run), { scope: "user", text: "job-owned memory phrase" });
    expect(put.owner).toBe(alice.user);
    const hits = await p.memorySearch(alice, { query: "job-owned memory phrase", scope: "user" });
    expect(hits[0]?.id).toBe(put.id);
    const bobHits = await p.memorySearch(bob, { query: "job-owned memory phrase", scope: "user" });
    expect(bobHits.every((h) => h.id !== put.id)).toBe(true);
  });
});
