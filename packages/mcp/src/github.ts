import {
  githubPath,
  parseGithubRepoUrl,
  sanitizeIssue,
  sanitizePr,
  sanitizeReview,
  type GithubRepoRef,
} from "@metaprompt/shared";
import { PlaneError } from "./errors.js";
import { assertNonSecretMemory } from "./memory.js";

export type GithubCall = {
  token: string;
  ref: GithubRepoRef;
  method: string;
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
  fetchImpl?: typeof fetch;
};

export function requireGithubToken(token: string | undefined, repo: string): string {
  if (!token || token.startsWith("-----BEGIN")) {
    throw new PlaneError(409, `GitHub token not configured for repo ${repo}`);
  }
  return token;
}

export async function githubApi(call: GithubCall): Promise<unknown> {
  const url = new URL(githubPath(call.ref, call.path));
  for (const [key, value] of Object.entries(call.query ?? {})) {
    if (value) url.searchParams.set(key, value);
  }
  const res = await (call.fetchImpl ?? fetch)(url, {
    method: call.method,
    headers: {
      authorization: `Bearer ${call.token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "metaprompt",
      ...(call.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: call.body !== undefined ? JSON.stringify(call.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new PlaneError(res.status === 401 || res.status === 403 ? 403 : 409, `GitHub ${res.status}: ${text.slice(0, 240)}`);
  }
  if (!text) return {};
  return JSON.parse(text) as unknown;
}

export function sanitizeGithubList(kind: "issue" | "pr", payload: unknown): Record<string, unknown>[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .map((row) => (kind === "pr" ? sanitizePr(row) : sanitizeIssue(row)));
}

export function sanitizeGithubItem(kind: "issue" | "pr" | "review", payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") return {};
  const row = payload as Record<string, unknown>;
  if (kind === "pr") return sanitizePr(row);
  if (kind === "review") return sanitizeReview(row);
  return sanitizeIssue(row);
}

export function assertGithubBody(body: string | undefined): void {
  if (body) assertNonSecretMemory(body);
}

export function issueNumber(args: Record<string, unknown>): number {
  const n = Number(args.number ?? args.issue ?? args.pr);
  if (!Number.isInteger(n) || n <= 0) throw new PlaneError(400, "number required");
  return n;
}
