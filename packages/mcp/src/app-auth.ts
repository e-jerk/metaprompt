import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { importPKCS8, SignJWT } from "jose";
import type { AppAuthSpec, GithubConfig, Identity, OidcAppsConfig } from "@metaprompt/shared";
import { catalogAllowed } from "@metaprompt/shared";
import { PlaneError } from "./errors.js";

export const TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";
export const JWT_BEARER_ASSERTION = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
export const SUBJECT_TOKEN_JWT = "urn:ietf:params:oauth:token-type:jwt";

export type MintedAppToken = {
  token: string;
  expiresAt?: number;
  source: "github-app" | "oidc";
  username?: string;
};

export type AppAuthDeps = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  readWorkloadToken?: () => string | undefined;
  privateKey?: string;
  apiBase?: string;
};

const cache = new Map<string, { token: string; exp: number; source: MintedAppToken["source"]; username?: string }>();

export function githubAppSpec(github?: GithubConfig, apps?: AppAuthSpec[]): AppAuthSpec | undefined {
  const named = apps?.find((a) => a.name === "github");
  if (named) return named;
  if (github?.appId && github.installationId) {
    return { name: "github", grant: "github-app", appId: github.appId, installationId: github.installationId };
  }
  return undefined;
}

export function listAppSpecs(oidcApps?: OidcAppsConfig, github?: GithubConfig): AppAuthSpec[] {
  const apps = [...(oidcApps?.apps ?? [])];
  if (github?.appId && github.installationId && !apps.some((a) => a.name === "github")) {
    apps.unshift({ name: "github", grant: "github-app", appId: github.appId, installationId: github.installationId });
  }
  return apps;
}

export function canUseApp(identity: Identity, spec: AppAuthSpec): boolean {
  if (!spec.allowedUsers && !spec.allowedGroups) return true;
  return catalogAllowed(spec, identity);
}

export function readWorkloadOidcToken(tokenFile?: string): string | undefined {
  if (process.env.METAPROMPT_OIDC_TOKEN) return process.env.METAPROMPT_OIDC_TOKEN;
  const path =
    tokenFile ||
    process.env.METAPROMPT_OIDC_TOKEN_FILE ||
    process.env.AWS_WEB_IDENTITY_TOKEN_FILE ||
    "/var/run/secrets/kubernetes.io/serviceaccount/token";
  try {
    const token = readFileSync(path, "utf8").trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

export function readAppPrivateKey(name: string, override?: string): string | undefined {
  if (override) return override;
  const envName = `METAPROMPT_APP_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_PRIVATE_KEY`;
  const fromNamed = process.env[envName] || process.env[`${envName}_FILE`];
  if (name === "github") {
    return process.env.METAPROMPT_GITHUB_APP_PRIVATE_KEY || readKeyFile(process.env.METAPROMPT_GITHUB_APP_PRIVATE_KEY_FILE) || fromNamed;
  }
  return process.env[envName] || readKeyFile(process.env[`${envName}_FILE`]);
}

function readKeyFile(path: string | undefined): string | undefined {
  if (!path) return undefined;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

export async function mintAppToken(spec: AppAuthSpec, deps: AppAuthDeps = {}): Promise<MintedAppToken> {
  const now = deps.now ?? Date.now;
  const cached = cache.get(spec.name);
  if (cached && cached.exp - 60_000 > now()) {
    return { token: cached.token, expiresAt: cached.exp, source: cached.source, username: cached.username };
  }
  const minted =
    spec.grant === "github-app"
      ? await mintGithubAppToken(spec, deps)
      : await exchangeOidc(spec, deps);
  cache.set(spec.name, { token: minted.token, exp: minted.expiresAt ?? now() + 3_000_000, source: minted.source, username: minted.username });
  return minted;
}

export function clearAppTokenCache(): void {
  cache.clear();
}

export async function mintGithubAppJwt(appId: string, pem: string, now = Date.now()): Promise<string> {
  const pkcs8 = toPkcs8(pem);
  const key = await importPKCS8(pkcs8, "RS256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt(Math.floor(now / 1000) - 30)
    .setExpirationTime(Math.floor(now / 1000) + 540)
    .setIssuer(appId)
    .sign(key);
}

function toPkcs8(pem: string): string {
  if (pem.includes("BEGIN PRIVATE KEY")) return pem;
  const key = createPrivateKey(pem);
  return key.export({ type: "pkcs8", format: "pem" }).toString();
}

async function mintGithubAppToken(spec: AppAuthSpec, deps: AppAuthDeps): Promise<MintedAppToken> {
  if (!spec.appId || !spec.installationId) throw new PlaneError(409, "GitHub App id and installationId required");
  const pem = readAppPrivateKey(spec.name, deps.privateKey);
  if (!pem) throw new PlaneError(409, "GitHub App private key not configured");
  const jwt = await mintGithubAppJwt(spec.appId, pem, deps.now?.() ?? Date.now());
  const api = (deps.apiBase || "https://api.github.com").replace(/\/$/, "");
  const url = `${api}/app/installations/${spec.installationId}/access_tokens`;
  const res = await (deps.fetchImpl ?? fetch)(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${jwt}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "metaprompt",
    },
  });
  const text = await res.text();
  if (!res.ok) throw new PlaneError(409, `GitHub App token mint failed (${res.status})`);
  const body = JSON.parse(text) as { token?: string; expires_at?: string };
  if (!body.token) throw new PlaneError(409, "GitHub App token mint returned no token");
  return {
    token: body.token,
    expiresAt: body.expires_at ? Date.parse(body.expires_at) : undefined,
    source: "github-app",
    username: "x-access-token",
  };
}

async function exchangeOidc(spec: AppAuthSpec, deps: AppAuthDeps): Promise<MintedAppToken> {
  if (!spec.tokenUrl) throw new PlaneError(409, `app ${spec.name} missing tokenUrl`);
  const subject = deps.readWorkloadToken?.() ?? readWorkloadOidcToken();
  if (!subject) throw new PlaneError(409, "workload OIDC token not available (EKS SA / IRSA)");
  const params = new URLSearchParams();
  if (spec.grant === "jwt-bearer") {
    params.set("grant_type", "client_credentials");
    params.set("client_assertion_type", JWT_BEARER_ASSERTION);
    params.set("client_assertion", subject);
    if (spec.clientId) params.set("client_id", spec.clientId);
  } else {
    params.set("grant_type", TOKEN_EXCHANGE_GRANT);
    params.set("subject_token", subject);
    params.set("subject_token_type", SUBJECT_TOKEN_JWT);
    if (spec.clientId) params.set("client_id", spec.clientId);
  }
  if (spec.audience) params.set("audience", spec.audience);
  if (spec.scope) params.set("scope", spec.scope);
  const res = await (deps.fetchImpl ?? fetch)(spec.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: params,
  });
  const text = await res.text();
  if (!res.ok) throw new PlaneError(409, `OIDC token exchange failed for ${spec.name} (${res.status})`);
  const body = JSON.parse(text) as { access_token?: string; token?: string; expires_in?: number };
  const token = body.access_token || body.token;
  if (!token) throw new PlaneError(409, `OIDC token exchange for ${spec.name} returned no token`);
  const expiresAt = body.expires_in ? Date.now() + body.expires_in * 1000 : undefined;
  return { token, expiresAt, source: "oidc" };
}
