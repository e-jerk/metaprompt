export const GH_ISSUE_TOOLS = [
  "gh.issue.list",
  "gh.issue.get",
  "gh.issue.create",
  "gh.issue.comment",
  "gh.issue.update",
] as const;

export const GH_PR_TOOLS = [
  "gh.pr.list",
  "gh.pr.get",
  "gh.pr.create",
  "gh.pr.review",
  "gh.pr.merge",
] as const;

export const GH_TOOLS = [...GH_ISSUE_TOOLS, ...GH_PR_TOOLS] as const;

export type GhTool = (typeof GH_TOOLS)[number];

export type GithubRepoRef = {
  host: string;
  owner: string;
  name: string;
  apiBase: string;
};

export function isGhTool(name: string): name is GhTool {
  return (GH_TOOLS as readonly string[]).includes(name);
}

export function parseGithubRepoUrl(url: string, apiUrlOverride?: string): GithubRepoRef {
  const raw = url.trim();
  let host = "github.com";
  let owner = "";
  let repo = "";
  const ssh = raw.match(/^git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/i);
  if (ssh) {
    host = ssh[1]!;
    owner = ssh[2]!;
    repo = ssh[3]!;
  } else {
    const withoutProto = raw.replace(/^https?:\/\//i, "");
    const slash = withoutProto.indexOf("/");
    if (slash < 0) throw new Error(`cannot parse GitHub repo from url`);
    host = withoutProto.slice(0, slash).replace(/^www\./, "");
    const rest = withoutProto.slice(slash + 1).replace(/\.git$/i, "").split("/");
    owner = rest[0] ?? "";
    repo = rest[1] ?? "";
  }
  if (!owner || !repo) throw new Error("cannot parse GitHub owner/name from repo url");
  const apiBase = (apiUrlOverride || (host === "github.com" ? "https://api.github.com" : `https://${host}/api/v3`)).replace(
    /\/$/,
    "",
  );
  return { host, owner, name: repo, apiBase };
}

export function githubPath(ref: GithubRepoRef, suffix: string): string {
  const path = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `${ref.apiBase}/repos/${ref.owner}/${ref.name}${path}`;
}

export function sanitizeIssue(raw: Record<string, unknown>): Record<string, unknown> {
  const user = raw.user && typeof raw.user === "object" ? (raw.user as { login?: string }).login : undefined;
  const labels = Array.isArray(raw.labels)
    ? raw.labels.map((l) => (typeof l === "string" ? l : (l as { name?: string }).name)).filter(Boolean)
    : [];
  return {
    number: raw.number,
    title: raw.title,
    state: raw.state,
    body: typeof raw.body === "string" ? raw.body.slice(0, 8000) : "",
    user,
    htmlUrl: raw.html_url,
    labels,
    pullRequest: Boolean(raw.pull_request),
  };
}

export function sanitizePr(raw: Record<string, unknown>): Record<string, unknown> {
  const head = raw.head && typeof raw.head === "object" ? (raw.head as { ref?: string }).ref : undefined;
  const base = raw.base && typeof raw.base === "object" ? (raw.base as { ref?: string }).ref : undefined;
  return {
    ...sanitizeIssue(raw),
    draft: raw.draft,
    merged: raw.merged,
    mergeable: raw.mergeable,
    head,
    base,
  };
}

export function sanitizeReview(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    id: raw.id,
    state: raw.state,
    body: typeof raw.body === "string" ? raw.body.slice(0, 4000) : "",
    htmlUrl: raw.html_url,
  };
}
