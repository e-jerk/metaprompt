import { generateKeyPairSync } from "node:crypto";
import { defaultConfig, identityFromStatic, type Identity } from "@metaprompt/shared";
import { describe, expect, it } from "bun:test";
import { clearAppTokenCache } from "./app-auth.js";
import { PlaneError } from "./errors.js";
import { Plane } from "./plane.js";

function users(plane: Plane): { alice: Identity; bob: Identity } {
  return {
    alice: identityFromStatic(plane.config.staticUsers[1]!),
    bob: identityFromStatic(plane.config.staticUsers[2]!),
  };
}

describe("github issues and PRs", () => {
  it("lists and creates issues via the plane token, never returning the PAT", async () => {
    const p = new Plane(defaultConfig());
    const { alice } = users(p);
    const calls: Array<{ url: string; method: string; body: string; auth: string }> = [];
    p.githubFetch = async (url, init) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: String(url),
        method: String(init?.method ?? "GET"),
        body: String(init?.body ?? ""),
        auth: headers.get("authorization") ?? "",
      });
      if (String(url).endsWith("/issues") && init?.method === "POST") {
        return Response.json({
          number: 4,
          title: "gap",
          state: "open",
          body: "fix it",
          html_url: "https://github.com/e-jerk/metaprompt/issues/4",
          user: { login: "alice" },
          labels: [],
        });
      }
      return Response.json([
        {
          number: 1,
          title: "open bug",
          state: "open",
          user: { login: "bob" },
          html_url: "https://github.com/e-jerk/metaprompt/issues/1",
        },
      ]);
    };
    const listed = (await p.github(alice, "gh.issue.list", { repo: "app" })) as Array<{ number: number }>;
    expect(listed[0]?.number).toBe(1);
    const created = (await p.github(alice, "gh.issue.create", {
      repo: "app",
      title: "gap",
      body: "fix it",
    })) as { number: number };
    expect(created.number).toBe(4);
    expect(calls[0]!.url).toBe("https://api.github.com/repos/e-jerk/metaprompt/issues?state=open&per_page=20");
    expect(calls[1]!.method).toBe("POST");
    expect(JSON.stringify(created)).not.toContain("fake-pat");
    expect(JSON.stringify(listed)).not.toContain("fake-pat-not-for-jobs");
  });

  it("denies writers-only actions to readers and rejects secret bodies", async () => {
    const p = new Plane(defaultConfig());
    const { bob } = users(p);
    p.githubFetch = async () => Response.json([]);
    await expect(p.github(bob, "gh.issue.create", { repo: "app", title: "nope" })).rejects.toBeInstanceOf(PlaneError);
    const alice = identityFromStatic(p.config.staticUsers[1]!);
    await expect(
      p.github(alice, "gh.pr.create", {
        repo: "app",
        title: "feat",
        head: "topic",
        body: "token ghp_abcdefghijklmnopqrstuvwxyz012345",
      }),
    ).rejects.toThrow(/secret/);
  });

  it("opens and merges a PR with repo ACL", async () => {
    const p = new Plane(defaultConfig());
    const { alice } = users(p);
    p.githubFetch = async (url, init) => {
      if (String(init?.method) === "POST") {
        return Response.json({
          number: 9,
          title: "feat",
          state: "open",
          head: { ref: "topic" },
          base: { ref: "main" },
          html_url: "https://github.com/e-jerk/metaprompt/pull/9",
        });
      }
      if (String(init?.method) === "PUT") {
        return Response.json({ merged: true, message: "ok" });
      }
      return Response.json({
        number: 9,
        title: "feat",
        state: "open",
        head: { ref: "topic" },
        base: { ref: "main" },
      });
    };
    const pr = (await p.github(alice, "gh.pr.create", {
      repo: "app",
      title: "feat",
      head: "topic",
    })) as { number: number; head: string };
    expect(pr.number).toBe(9);
    expect(pr.head).toBe("topic");
    const merged = (await p.github(alice, "gh.pr.merge", { repo: "app", number: 9, method: "squash" })) as {
      merged?: boolean;
    };
    expect(merged.merged).toBe(true);
  });

  it("defaults repo from the run token", async () => {
    const p = new Plane(defaultConfig());
    const alice = identityFromStatic(p.config.staticUsers[1]!);
    const run = await p.createRun(alice, { harness: "stub", repo: "app", prompt: "x", storage: "tmpfs" });
    let seen = "";
    p.githubFetch = async (url) => {
      seen = String(url);
      return Response.json([]);
    };
    await p.github(p.asRun(run), "gh.pr.list", {});
    expect(seen).toContain("/repos/e-jerk/metaprompt/pulls");
  });

  it("uses a GitHub App installation token instead of the repo PAT", async () => {
    clearAppTokenCache();
    const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const p = new Plane(
      defaultConfig({
        github: { appId: "1", installationId: "2" },
      }),
    );
    const { alice } = users(p);
    p.appPrivateKeys.github = pem;
    p.appAuthFetch = async () => Response.json({ token: "ghs_from_app", expires_at: "2099-01-01T00:00:00Z" });
    let auth = "";
    p.githubFetch = async (_url, init) => {
      auth = new Headers(init?.headers).get("authorization") ?? "";
      return Response.json([]);
    };
    await p.github(alice, "gh.issue.list", { repo: "app" });
    expect(auth).toBe("Bearer ghs_from_app");
    const minted = await p.mintCred(alice, {
      repo: "app",
      op: "push",
      runId: (await p.createRun(alice, { harness: "stub", repo: "app", storage: "tmpfs" })).id,
    });
    expect(minted.token).toBe("ghs_from_app");
    expect(minted.username).toBe("x-access-token");
    expect(minted.source).toBe("github-app");
    expect(JSON.stringify(p.store.minted)).not.toContain("ghs_from_app");
    expect(p.appList(alice)).toEqual([{ name: "github", grant: "github-app" }]);
  });
});
