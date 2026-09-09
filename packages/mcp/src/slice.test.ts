import { defaultConfig, identityFromStatic, type Identity } from "@metaprompt/shared";
import { describe, expect, it } from "bun:test";
import { PlaneError } from "./errors.js";
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
  return new Plane(
    defaultConfig({
      bedrock: { enabled: false, region: "us-east-1" },
      ...overrides,
    }),
  );
}

describe("vertical slice", () => {
  it("3. ACL deny-by-default until share", async () => {
    const p = plane();
    const { alice, bob } = users(p);
    const run = await p.createRun(alice, { harness: "stub", repo: "app", prompt: "hello" });
    await expect(p.get(bob, run.id)).rejects.toBeInstanceOf(PlaneError);
    expect(() => p.logs(bob, { runId: run.id })).toThrow(PlaneError);
    p.share(alice, run.id, ["user:bob"], "read");
    await expect(p.get(bob, run.id)).resolves.toMatchObject({ id: run.id });
    expect(p.logs(bob, { runId: run.id })[run.id]!.length).toBeGreaterThan(0);
  });

  it("4. party coord + handoff survives completion; other user denied", async () => {
    const p = plane();
    const { alice, bob } = users(p);
    const party = p.partyCreate(alice);
    const a = await p.createRun(alice, { harness: "stub", repo: "app", partyId: party.id, prompt: "a" });
    const b = await p.createRun(alice, { harness: "stub", repo: "app", partyId: party.id, prompt: "b" });
    p.coordPost(p.asRun(a), party.id, "hello from a");
    await p.coordBarrier(p.asRun(a), party.id);
    await p.coordBarrier(p.asRun(b), party.id);
    const handoff = await p.coordHandoff(p.asRun(a), { harness: "stub", prompt: "third", partyId: party.id });
    await p.selfExit(p.asRun(a), { summary: "a done" });
    await p.selfExit(p.asRun(b), { summary: "b done" });
    expect(p.partyGet(alice, party.id).log.some((e) => e.type === "handoff")).toBe(true);
    expect(p.store.runs.get(handoff.runId)?.status).toBe("running");
    expect(() => p.partyGet(bob, party.id)).toThrow(PlaneError);
  });

  it("5. wait under 60s stays on attempt; eager wait auto-suspends then resumes", async () => {
    const p = plane();
    const { alice } = users(p);
    const parent = await p.createRun(alice, { harness: "stub", repo: "app", prompt: "parent", storage: "pvc" });
    const fast = await p.createRun(alice, {
      harness: "stub",
      repo: "app",
      parentRunId: parent.id,
      createdByRunId: parent.id,
      prompt: "fast",
    });
    await p.selfExit(p.asRun(fast), { summary: "fast done" });
    const waited = await p.jobWait(p.asRun(parent), { runIds: [fast.id] });
    expect(waited.action).toBe("rollup");
    expect(parent.status).toBe("running");
    expect(parent.attempt).toBe(1);

    const slow = await p.createRun(alice, {
      harness: "stub",
      repo: "app",
      parentRunId: parent.id,
      createdByRunId: parent.id,
      prompt: "slow",
      activeDeadlineSeconds: 120,
    });
    const parked = await p.jobWait(p.asRun(parent), { runIds: [slow.id] });
    expect(parked.action).toBe("suspended");
    expect(parent.status).toBe("suspended");
    expect(p.notificationsFor(alice.user, ["run-completed"]).some((n) => (n.payload as { runId: string }).runId === parent.id)).toBe(false);
    await p.selfExit(p.asRun(slow), { summary: "slow done" });
    expect(parent.status).toBe("running");
    expect(parent.attempt).toBe(2);
    expect(parent.resumeSuffix).toContain("slow done");
    expect(parent.resumeSuffix).not.toContain("stdout");
  });

  it("6. in-flight SHA pin survives later git-sync generation", async () => {
    const p = plane();
    const { alice } = users(p);
    const first = await p.createRun(alice, { harness: "stub", repo: "app" });
    expect(first.sha).toBe("sha-gen-1");
    p.setRepoSha("app", "sha-gen-2", "gen-2");
    const second = await p.createRun(alice, { harness: "stub", repo: "app" });
    expect(first.sha).toBe("sha-gen-1");
    expect(second.sha).toBe("sha-gen-2");
  });

  it("7. tmpfs cron has no PVC; tmpfs cannot suspend; interactive PVC freed on terminal", async () => {
    const p = plane();
    const { alice, bob } = users(p);
    p.cronCreate(alice, {
      name: "nightly",
      schedule: "0 2 * * *",
      harness: "stub",
      repo: "app",
      prompt: "cron",
      storage: "tmpfs",
      concurrencyPolicy: "Forbid",
    });
    const firing = await p.cronFire(alice, "nightly");
    expect(firing.storage).toBe("tmpfs");
    expect(firing.pvcName).toBeUndefined();
    expect(p.store.pvcs.size).toBe(0);
    expect(p.list(bob, { cron: "nightly" })).toHaveLength(0);
    expect(p.list(alice, { cron: "nightly" }).map((r) => r.id)).toContain(firing.id);

    const child = await p.createRun(alice, {
      harness: "stub",
      repo: "app",
      parentRunId: firing.id,
      createdByRunId: firing.id,
      prompt: "x",
      activeDeadlineSeconds: 120,
    });
    const wait = await p.jobWait(p.asRun(firing), { runIds: [child.id], timeoutSeconds: 120 });
    expect(wait.action).toBe("storage-error");

    const interactive = await p.createRun(alice, { harness: "stub", repo: "app", storage: "pvc" });
    expect(interactive.pvcName).toBeTruthy();
    expect(p.store.pvcs.has(interactive.pvcName!)).toBe(true);
    await p.selfExit(p.asRun(interactive), { summary: "done" });
    expect(interactive.pvcDeleted).toBe(true);
    expect(p.store.pvcs.has(interactive.pvcName!)).toBe(false);
  });

  it("8. parent notified on terminal; logs survive", async () => {
    const p = plane();
    const { alice } = users(p);
    const run = await p.createRun(alice, { harness: "stub", repo: "app", prompt: "x" });
    p.appendLog(run.id, "hello world");
    await p.selfExit(p.asRun(run), { summary: "finished" });
    expect(p.notificationsFor(alice.user, ["run-completed"]).some((n) => (n.payload as { runId: string }).runId === run.id)).toBe(true);
    expect(p.logs(alice, { runId: run.id })[run.id]!.some((l) => l.chunk.includes("hello world"))).toBe(true);
  });

  it("9. cursor auto accepted; auto on claude-code rejected", async () => {
    const p = plane({ bedrock: { enabled: true, region: "us-east-1" } });
    const { alice } = users(p);
    expect(p.modelList("cursor").some((m) => m.id === "auto")).toBe(true);
    const run = await p.createRun(alice, { harness: "cursor", repo: "app", model: "auto" });
    expect(run.resolvedModel).toMatchObject({ id: "auto", provider: "cursor", vendorId: "auto" });
    await expect(p.createRun(alice, { harness: "claude-code", repo: "app", model: "auto" })).rejects.toThrow(/not allowed/);
  });

  it("10. Bedrock env requires bedrock.enabled", async () => {
    const off = plane({ bedrock: { enabled: false, region: "us-east-1" } });
    const { alice } = users(off);
    await expect(off.createRun(alice, { harness: "claude-code", repo: "app", model: "bedrock-sonnet" })).rejects.toThrow(
      /Bedrock not configured/,
    );
    const on = plane({ bedrock: { enabled: true, region: "us-east-1" } });
    const { alice: a2 } = users(on);
    const run = await on.createRun(a2, { harness: "claude-code", repo: "app", model: "bedrock-sonnet" });
    expect(run.resolvedModel).toMatchObject({
      provider: "bedrock",
      vendorId: "us.anthropic.claude-sonnet-4-6",
    });
  });

  it("10b. AgentCore is Job-only and requires a harness or runtime ARN", async () => {
    const off = plane();
    const { alice } = users(off);
    await expect(off.createRun(alice, { harness: "agentcore", repo: "app", prompt: "ping" })).rejects.toThrow(
      /AgentCore not configured/,
    );
    await expect(off.sessionCreate(alice, { harness: "agentcore", repo: "app" })).rejects.toThrow(/Job-only/);
    const on = plane({
      agentcore: {
        enabled: true,
        region: "us-east-1",
        harnessArn: "arn:aws:bedrock-agentcore:us-east-1:1:harness/demo-abcdefghij",
      },
    });
    const { alice: a2 } = users(on);
    const run = await on.createRun(a2, { harness: "agentcore", repo: "app", prompt: "ping", storage: "tmpfs" });
    expect(run.harness).toBe("agentcore");
    expect(run.resolvedModel).toMatchObject({ provider: "agentcore" });
    expect(run.agentcore?.actorId).toBe("alice");
    expect(run.agentcore?.sessionId).toMatch(/^run_/);
    expect(run.agentcore?.sessionId.length).toBeGreaterThanOrEqual(33);
    expect(on.modelList("agentcore").some((m) => m.id === "agentcore")).toBe(true);
    await on.complete(run, "succeeded", {
      summary: "pong",
      usage: { inputTokens: 9, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 },
    });
    expect(on.getRun(run.id).usage.inputTokens).toBe(9);
  });

  it("11. jj mint ACL; no PAT on the run record", async () => {
    const p = plane();
    const { alice, bob } = users(p);
    const run = await p.createRun(alice, { harness: "stub", repo: "app" });
    const minted = await p.mintCred(alice, { repo: "app", op: "push", runId: run.id });
    expect(minted.ephemeral).toBe(true);
    expect(minted.token).toMatch(/^minted-/);
    expect(JSON.stringify(run)).not.toContain("fake-pat");
    await expect(p.mintCred(bob, { repo: "app", op: "push", runId: run.id })).rejects.toThrow(/writer|cannot mint/);
    const fetch = await p.mintCred(alice, { repo: "app", op: "fetch", runId: run.id });
    expect(fetch.token).toBeTruthy();
  });

  it("12. parent-passed skills/MCPs; sibling isolation; forbidden name fails", async () => {
    const p = plane();
    const { alice } = users(p);
    const withExtras = await p.createRun(alice, {
      harness: "stub",
      repo: "app",
      skills: [{ name: "review" }],
      mcpServers: [{ name: "linear" }],
    });
    const sibling = await p.createRun(alice, { harness: "stub", repo: "app" });
    expect(p.injectedFor(withExtras).mcpServers).toEqual(["plane", "party", "jj", "linear"]);
    expect(p.injectedFor(withExtras).skills).toEqual(["review"]);
    expect(p.injectedFor(sibling).mcpServers).toEqual(["plane", "party", "jj"]);
    expect(p.injectedFor(sibling).skills).toEqual([]);
    await expect(p.createRun(alice, { harness: "stub", repo: "app", mcpServers: [{ name: "not-a-server" }] })).rejects.toThrow(
      /unknown mcp|forbidden/,
    );
    await expect(p.createRun(alice, { harness: "stub", repo: "app", mcpServers: [{ name: "clanker" }] })).rejects.toThrow(
      /parent-only/,
    );
  });

  it("13. shared prefix hash; inline skill busts cache; usage recorded; resume keeps hash", async () => {
    const p = plane();
    const { alice } = users(p);
    const a = await p.createRun(alice, { harness: "stub", repo: "app", skills: [{ name: "review" }] });
    const b = await p.createRun(alice, { harness: "stub", repo: "app", skills: [{ name: "review" }] });
    const c = await p.createRun(alice, {
      harness: "stub",
      repo: "app",
      skills: [{ name: "custom", content: "inline" }],
    });
    expect(a.prefixHash).toBe(b.prefixHash);
    expect(c.prefixHash).not.toBe(a.prefixHash);
    expect(c.cacheHint).toBe("inline-skill");
    const parent = await p.createRun(alice, { harness: "stub", repo: "app", storage: "pvc" });
    const child = await p.createRun(alice, {
      harness: "stub",
      repo: "app",
      parentRunId: parent.id,
      createdByRunId: parent.id,
      activeDeadlineSeconds: 90,
    });
    const hash = parent.prefixHash;
    await p.jobWait(p.asRun(parent), { runIds: [child.id] });
    await p.selfExit(p.asRun(child), { summary: "x" });
    expect(parent.attempt).toBe(2);
    expect(parent.prefixHash).toBe(hash);
    await p.selfExit(p.asRun(parent), { summary: "root" });
    expect(p.result(alice, parent.id).usage.cacheReadTokens).toBeGreaterThan(0);
  });

  it("14. mid-task kill, waiter unblocks cancelled, cascade, ACL", async () => {
    const p = plane();
    const { alice, bob } = users(p);
    const parent = await p.createRun(alice, { harness: "stub", repo: "app", storage: "pvc" });
    const child = await p.createRun(alice, {
      harness: "stub",
      repo: "app",
      parentRunId: parent.id,
      createdByRunId: parent.id,
    });
    const grand = await p.createRun(alice, {
      harness: "stub",
      repo: "app",
      parentRunId: child.id,
      createdByRunId: child.id,
    });
    await expect(p.kill(bob, parent.id)).rejects.toBeInstanceOf(PlaneError);
    const wait = p.jobWait(p.asRun(parent), { runIds: [child.id] });
    await p.kill(alice, child.id, "irrelevant", true);
    const result = await wait;
    expect(child.status).toBe("cancelled");
    expect(grand.status).toBe("cancelled");
    expect(child.pvcDeleted).toBe(true);
    expect(result.action).toBe("rollup");
    expect(result.rollup?.children[0]?.status).toBe("cancelled");
  });

  it("15. job.spawn nested party + combined rollup; grandchild folded into child summary", async () => {
    const p = plane();
    const { alice } = users(p);
    const root = await p.createRun(alice, { harness: "stub", repo: "app", prompt: "root", storage: "pvc" });
    const spawned = await p.jobSpawn(p.asRun(root), {
      agents: [
        { id: "one", harness: "stub", prompt: "work one" },
        { id: "two", harness: "stub", prompt: "work two" },
      ],
    });
    expect(Object.keys(spawned.runIds)).toHaveLength(2);
    const one = p.getRun(spawned.runIds.one!);
    const two = p.getRun(spawned.runIds.two!);
    expect(one.jobName).toBeTruthy();
    expect(two.jobName).toBeTruthy();
    expect(one.partyId).toBe(two.partyId);
    expect(one.partyId).not.toBe(root.partyId);
    expect(p.harnessGet("stub").disallowedTools).toContain("Task");
    await p.coordBarrier(p.asRun(one), one.partyId);
    await p.coordBarrier(p.asRun(two), two.partyId);
    const mid = await p.createRun(alice, {
      harness: "stub",
      repo: "app",
      parentRunId: root.id,
      createdByRunId: root.id,
      prompt: "mid",
    });
    const grand = await p.jobRun(p.asRun(mid), { harness: "stub", prompt: "grand" });
    await p.selfExit(p.asRun(p.getRun(grand.runId)), { summary: "grandchild secret log should stay here" });
    await p.selfExit(p.asRun(mid), { summary: "mid includes grandchild only as summary" });
    await p.selfExit(p.asRun(one), { summary: "summary one" });
    await p.selfExit(p.asRun(two), { summary: "summary two" });
    const wait = await p.jobWait(p.asRun(root), { runIds: [one.id, two.id, mid.id] });
    expect(wait.rollup?.combined).toContain("summary one");
    expect(wait.rollup?.combined).toContain("summary two");
    expect(wait.rollup?.combined).toContain("mid includes grandchild");
    expect(wait.rollup?.combined).not.toContain("grandchild secret log");
    await p.selfExit(p.asRun(root), { summary: "top-level from rollup" });
    const result = p.result(alice, root.id);
    expect(result.summary).toBe("top-level from rollup");
    expect(result.children.map((c) => c.runId).sort()).toEqual([one.id, two.id, mid.id].sort());
  });

  it("16. ancestor tail and progress; siblings denied; logs survive complete", async () => {
    const p = plane();
    const { alice, bob } = users(p);
    const root = await p.createRun(alice, { harness: "stub", repo: "app" });
    const spawned = await p.jobSpawn(p.asRun(root), {
      agents: [
        { id: "a", harness: "stub", prompt: "a" },
        { id: "b", harness: "stub", prompt: "b" },
      ],
    });
    const childA = p.getRun(spawned.runIds.a!);
    const childB = p.getRun(spawned.runIds.b!);
    p.appendLog(childA.id, "progress-a");
    p.appendLog(childB.id, "progress-b");
    const logs = p.logs(alice, { runIds: [childA.id, childB.id], tailLines: 10, follow: true });
    expect(logs[childA.id]!.some((l) => l.chunk.includes("progress-a"))).toBe(true);
    const rows = p.progress(p.asRun(root), { depth: "children", follow: true });
    expect(rows.map((r) => r.runId).sort()).toEqual([childA.id, childB.id].sort());
    expect(() => p.logs(p.asRun(childA), { runId: childB.id })).toThrow(PlaneError);
    expect(() => p.logs(bob, { runId: childA.id })).toThrow(PlaneError);
    await p.selfExit(p.asRun(childA), { summary: "a" });
    expect(p.logs(alice, { runId: childA.id })[childA.id]!.length).toBeGreaterThan(0);
    expect(root.resumeSuffix ?? "").not.toContain("progress-a");
  });

  it("17. parallel spawn + after[] unblocks without parent; extras queue", async () => {
    const p = plane({ limits: { maxParallelPerParent: 2 } });
    const { alice } = users(p);
    const root = await p.createRun(alice, { harness: "stub", repo: "app", storage: "pvc" });
    const spawned = await p.jobSpawn(p.asRun(root), {
      agents: [
        { id: "a", harness: "stub", prompt: "a" },
        { id: "b", harness: "stub", prompt: "b" },
        { id: "c", harness: "stub", prompt: "c", after: ["a", "b"] },
      ],
    });
    const a = p.getRun(spawned.runIds.a!);
    const b = p.getRun(spawned.runIds.b!);
    const c = p.getRun(spawned.runIds.c!);
    expect(["ready", "running"]).toContain(a.status);
    expect(["ready", "running"]).toContain(b.status);
    expect(c.status).toBe("blocked");
    await p.jobWait(p.asRun(root), { runIds: [a.id, b.id, c.id], timeoutSeconds: 120 });
    expect(root.status).toBe("suspended");
    await p.selfExit(p.asRun(a), { summary: "a" });
    await p.selfExit(p.asRun(b), { summary: "b" });
    expect(c.status).toMatch(/ready|running/);
    expect(root.status).toBe("suspended");
    await p.selfExit(p.asRun(c), { summary: "c after" });
    expect(root.status).toBe("running");
    expect(root.resumeSuffix).toContain("c after");

    const packed = await p.createRun(alice, { harness: "stub", repo: "app" });
    const extra = await p.jobSpawn(p.asRun(packed), {
      agents: [
        { id: "p1", harness: "stub", prompt: "1" },
        { id: "p2", harness: "stub", prompt: "2" },
        { id: "p3", harness: "stub", prompt: "3" },
      ],
    });
    const statuses = Object.values(extra.runIds).map((id) => p.getRun(id).status);
    expect(statuses.filter((s) => s === "queued").length).toBeGreaterThanOrEqual(1);
    expect(p.progress(p.asRun(packed), { depth: "children" }).some((r) => r.queued)).toBe(true);
  });
});
