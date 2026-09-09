import { defaultConfig, identityFromStatic, type Identity } from "@metaprompt/shared";
import { describe, expect, it } from "bun:test";
import { PlaneError } from "./errors.js";
import { assertNoSecretsInSpec, specFromRun } from "./job-spec.js";
import { Plane } from "./plane.js";

function users(plane: Plane): { alice: Identity; bob: Identity } {
  const [, alice, bob] = plane.config.staticUsers;
  return { alice: identityFromStatic(alice!), bob: identityFromStatic(bob!) };
}

describe("root sessions", () => {
  it("creates an exec-able session with attach command and rejects Jobs creating one", async () => {
    const p = new Plane(defaultConfig({ bedrock: { enabled: false, region: "us-east-1" } }));
    const { alice } = users(p);
    const session = await p.sessionCreate(alice, { repo: "app", storage: "tmpfs" });
    expect(session.harness).toBe("session");
    expect(session.podName).toMatch(/^mp-run_/);
    expect(session.attach.command).toContain("kubectl");
    expect(session.attach.command).toContain("exec -it");
    expect(session.attach.command).toContain("/workspace/.mp/attach");
    expect(session.shell.command).toContain("/bin/bash");
    const run = p.getRun(session.runId);
    expect(run.kind).toBe("session");
    const listed = p.sessionList(alice);
    expect(listed.map((r) => r.id)).toContain(session.runId);

    const job = await p.createRun(alice, { harness: "stub", repo: "app", prompt: "child", storage: "tmpfs" });
    await expect(p.sessionCreate(p.asRun(job), { harness: "session" })).rejects.toThrow(/parent-only/);
    await expect(p.sessionCreate(alice, { harness: "stub" })).rejects.toThrow(/real harness/);
  });

  it("HarnessJob spec carries party/repo/model and never a run token", async () => {
    const p = new Plane(defaultConfig({ bedrock: { enabled: false, region: "us-east-1" } }));
    const { alice } = users(p);
    const session = await p.sessionCreate(alice, { harness: "session", repo: "app", storage: "pvc" });
    const run = p.getRun(session.runId);
    const spec = specFromRun(run, p.config, { runToken: "secret-run-token", planeUrl: "http://plane" });
    expect(spec.mode).toBe("session");
    expect(spec.partyId).toBe(run.partyId);
    expect(spec.repo).toBe("app");
    expect(spec.tokenSecretRef.name).toContain("token");
    expect(spec.lowerdir).toBe("/repos/app/current");
    expect(spec.childMcpPort).toBe(3334);
    expect(spec.gitSync?.enabled).toBe(false);
    expect(JSON.stringify(spec)).not.toContain("secret-run-token");
    expect(() => assertNoSecretsInSpec(spec)).not.toThrow();
    await expect(p.sessionGet(users(p).bob, session.runId)).rejects.toBeInstanceOf(PlaneError);
  });
});
