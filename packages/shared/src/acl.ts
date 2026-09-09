import type { Identity, Party, PartyRole, Run } from "./types.js";

export function subjectKey(identity: Identity): string {
  return `user:${identity.user}`;
}

export function identitySubjects(identity: Identity): string[] {
  return [subjectKey(identity), ...identity.groups.map((g) => (g.startsWith("group:") ? g : `group:${g}`))];
}

export function isAdmin(identity: Identity): boolean {
  return Boolean(identity.admin);
}

export function ownsRun(run: Run, identity: Identity): boolean {
  return isAdmin(identity) || run.owner === identity.user;
}

export function isAncestorOf(ancestorId: string, run: Run, byId: Map<string, Run>): boolean {
  if (run.id === ancestorId) return true;
  let cursor: Run | undefined = run;
  const seen = new Set<string>();
  while (cursor?.parentRunId) {
    if (seen.has(cursor.id)) break;
    seen.add(cursor.id);
    if (cursor.parentRunId === ancestorId) return true;
    cursor = byId.get(cursor.parentRunId);
  }
  return run.rootRunId === ancestorId && ancestorId !== run.id;
}

export function canReadRun(run: Run, identity: Identity, byId: Map<string, Run>): boolean {
  if (isAdmin(identity)) return true;
  if (identity.runId) {
    if (identity.runId === run.id) return true;
    if (isAncestorOf(identity.runId, run, byId)) return true;
  } else if (run.owner === identity.user) {
    return true;
  }
  const subjects = identitySubjects(identity);
  return subjects.some((s) => run.share[s] === "read");
}

export function canTailRun(run: Run, identity: Identity, byId: Map<string, Run>): boolean {
  if (canReadRun(run, identity, byId)) return true;
  if (identity.runId && isAncestorOf(identity.runId, run, byId)) return true;
  if (!identity.runId && run.owner === identity.user) return true;
  if (identity.runId) {
    const callerRun = byId.get(identity.runId);
    if (callerRun && isAncestorOf(callerRun.id, run, byId)) return true;
  }
  // Human owner of any ancestor
  if (!identity.runId) {
    let cursor: Run | undefined = run;
    const seen = new Set<string>();
    while (cursor) {
      if (seen.has(cursor.id)) break;
      seen.add(cursor.id);
      if (cursor.owner === identity.user) return true;
      cursor = cursor.parentRunId ? byId.get(cursor.parentRunId) : undefined;
    }
  }
  return false;
}

export function canInstructRun(run: Run, identity: Identity, party?: Party): boolean {
  if (isAdmin(identity)) return true;
  if (party && partyRole(party, identity) === "coordinator") return true;
  if (!identity.runId && run.owner === identity.user) return true;
  return false;
}

export function canKillRun(run: Run, identity: Identity, party?: Party): boolean {
  if (canInstructRun(run, identity, party)) return true;
  if (identity.runId && run.createdByRunId === identity.runId) return true;
  return false;
}

export function partyRole(party: Party, identity: Identity): PartyRole | undefined {
  if (isAdmin(identity)) return "coordinator";
  const subjects = new Set(identitySubjects(identity));
  if (identity.runId) subjects.add(`run:${identity.runId}`);
  const hits = party.members.filter(
    (m) => subjects.has(m.subject) || m.subject === `user:${identity.user}` || (identity.runId && m.runId === identity.runId),
  );
  if (hits.some((h) => h.role === "coordinator")) return "coordinator";
  if (hits.some((h) => h.role === "member")) return "member";
  if (hits.some((h) => h.role === "observer")) return "observer";
  return undefined;
}

export function canSeeParty(party: Party, identity: Identity): boolean {
  return partyRole(party, identity) !== undefined;
}

export function listed(list: string[], identity: Identity): boolean {
  if (list.includes("public") || list.includes("*")) return true;
  const subjects = identitySubjects(identity);
  return list.some((entry) => subjects.includes(entry) || entry === identity.user || entry === `user:${identity.user}`);
}

export function catalogAllowed(
  entry: { allowedUsers?: string[]; allowedGroups?: string[] },
  identity: Identity,
): boolean {
  if (!entry.allowedUsers && !entry.allowedGroups) return true;
  if (isAdmin(identity)) return true;
  if (entry.allowedUsers?.includes(identity.user)) return true;
  if (entry.allowedGroups?.some((g) => identity.groups.includes(g) || identity.groups.includes(`group:${g}`))) {
    return true;
  }
  return false;
}
