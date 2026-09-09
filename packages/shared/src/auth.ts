import type { Identity, StaticUser } from "./types.js";

export function identityFromStatic(user: StaticUser): Identity {
  return {
    user: user.user,
    groups: user.groups,
    admin: user.admin,
    sessionId: `static:${user.user}`,
  };
}

export function parseBearer(header?: string): string | undefined {
  if (!header) return undefined;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return undefined;
  return token;
}
