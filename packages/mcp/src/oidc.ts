import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Identity, OidcConfig } from "@metaprompt/shared";
import { PlaneError } from "./errors.js";

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function verifyOidc(config: OidcConfig, token: string): Promise<Identity> {
  const jwksUri = config.jwksUri || `${config.issuer.replace(/\/$/, "")}/.well-known/jwks.json`;
  let jwks = jwksCache.get(jwksUri);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUri));
    jwksCache.set(jwksUri, jwks);
  }
  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(token, jwks, {
      issuer: config.issuer,
      audience: config.audience,
    });
    payload = result.payload as Record<string, unknown>;
  } catch (err) {
    throw new PlaneError(401, `oidc verify failed: ${(err as Error).message}`);
  }
  if (config.enterprise && payload.enterprise !== config.enterprise) {
    throw new PlaneError(403, "enterprise claim mismatch");
  }
  const org = String(payload.repository_owner ?? payload.org ?? "");
  if (config.allowedOrgs?.length && org && !config.allowedOrgs.includes(org)) {
    throw new PlaneError(403, "org not allowed");
  }
  const userClaim = config.map?.user ?? "actor";
  const user = String(payload[userClaim] ?? payload.sub ?? "");
  if (!user) throw new PlaneError(401, "oidc token missing user claim");
  const groupClaims = config.map?.groups ?? ["repository", "repository_owner", "job_workflow_ref"];
  const groups = groupClaims
    .map((c) => payload[c])
    .filter((v): v is string => typeof v === "string");
  const admin = Boolean(config.adminOrgs?.includes(org));
  return { user, groups, admin, sessionId: `oidc:${user}` };
}
