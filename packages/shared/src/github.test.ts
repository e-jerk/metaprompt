import { describe, expect, it } from "bun:test";
import { githubPath, isGhTool, parseGithubRepoUrl, sanitizeIssue, sanitizePr } from "./github.js";

describe("github repo parse", () => {
  it("parses github.com HTTPS and SSH", () => {
    const https = parseGithubRepoUrl("https://github.com/e-jerk/metaprompt.git");
    expect(https).toEqual({
      host: "github.com",
      owner: "e-jerk",
      name: "metaprompt",
      apiBase: "https://api.github.com",
    });
    expect(parseGithubRepoUrl("git@github.com:e-jerk/metaprompt.git").owner).toBe("e-jerk");
    expect(githubPath(https, "/issues")).toBe("https://api.github.com/repos/e-jerk/metaprompt/issues");
  });

  it("parses GitHub Enterprise and honors apiUrl override", () => {
    const ghe = parseGithubRepoUrl("https://ghe.example.com/eng/app.git");
    expect(ghe.apiBase).toBe("https://ghe.example.com/api/v3");
    expect(parseGithubRepoUrl(ghe.host + "/eng/app", "https://ghe.example.com/api/v3").apiBase).toBe(
      "https://ghe.example.com/api/v3",
    );
  });

  it("sanitizes issue/PR payloads without embedding objects", () => {
    expect(
      sanitizeIssue({
        number: 7,
        title: "bug",
        state: "open",
        body: "x",
        html_url: "https://github.com/e-jerk/metaprompt/issues/7",
        user: { login: "alice" },
        labels: [{ name: "bug" }],
        pull_request: {},
      }),
    ).toMatchObject({ number: 7, user: "alice", labels: ["bug"], pullRequest: true });
    expect(
      sanitizePr({
        number: 3,
        title: "feat",
        head: { ref: "topic" },
        base: { ref: "main" },
        merged: false,
      }),
    ).toMatchObject({ head: "topic", base: "main" });
    expect(isGhTool("gh.pr.merge")).toBe(true);
    expect(isGhTool("jj.status")).toBe(false);
  });
});
