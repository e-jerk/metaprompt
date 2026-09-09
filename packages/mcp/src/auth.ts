import { createHmac, timingSafeEqual } from "node:crypto";
import { identityFromStatic, parseBearer, type Identity, type PlaneConfig } from "@metaprompt/shared";
import { PlaneError } from "./errors.js";
import { verifyOidc } from "./oidc.js";

export type RunTokenClaims = {
  typ: "run";
  user: string;
  groups: string[];
  runId: string;
  admin?: boolean;
};

export function signRunToken(secret: string, claims: RunTokenClaims): string {
  const payload = Buffer.from(JSON.stringify({ ...claims, exp: Date.now() + 86_400_000 })).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyRunToken(secret: string, token: string): RunTokenClaims {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) throw new PlaneError(401, "invalid run token");
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new PlaneError(401, "invalid run token");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as RunTokenClaims & { exp: number };
  if (claims.typ !== "run") throw new PlaneError(401, "invalid run token");
  if (claims.exp < Date.now()) throw new PlaneError(401, "run token expired");
  return claims;
}

export async function authenticate(config: PlaneConfig, authorization?: string): Promise<Identity> {
  const token = parseBearer(authorization);
  if (!token) throw new PlaneError(401, "missing bearer token");
  const staticUser = config.staticUsers.find((u) => u.token === token);
  if (staticUser) return identityFromStatic(staticUser);
  try {
    const run = verifyRunToken(config.runTokenSecret, token);
    return {
      user: run.user,
      groups: run.groups,
      admin: run.admin,
      runId: run.runId,
      sessionId: `run:${run.runId}`,
    };
  } catch {
    // fall through to OIDC
  }
  if (config.oidc) return verifyOidc(config.oidc, token);
  throw new PlaneError(401, "unauthorized");
}
