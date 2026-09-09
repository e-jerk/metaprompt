import type { Identity } from "@metaprompt/shared";
import { PlaneError } from "./errors.js";
import type { Plane } from "./plane.js";

export const TOOL_NAMES = [
  "harness.list",
  "harness.get",
  "model.list",
  "skill.list",
  "mcp.list",
  "repo.list",
  "asset.list",
  "party.create",
  "party.get",
  "party.list",
  "party.add",
  "party.close",
  "coord.post",
  "coord.inbox",
  "coord.wait",
  "coord.signal",
  "coord.barrier",
  "coord.handoff",
  "coord.members",
  "coord.artifact.put",
  "coord.artifact.get",
  "run.create",
  "run.instruct",
  "run.wait",
  "run.kill",
  "run.cancel",
  "run.logs",
  "run.result",
  "run.list",
  "run.get",
  "run.share",
  "run.unshare",
  "job.run",
  "job.spawn",
  "job.wait",
  "job.kill",
  "job.logs",
  "job.progress",
  "self.suspend",
  "self.exit",
  "cron.create",
  "cron.list",
  "cron.get",
  "cron.delete",
  "cron.enable",
  "jj.status",
  "jj.diff",
  "jj.log",
  "jj.new",
  "jj.describe",
  "jj.squash",
  "jj.rebase",
  "jj.bookmark",
  "jj.git.fetch",
  "jj.git.push",
  "vcs.cred.mint",
  "memory.put",
  "memory.search",
  "memory.get",
  "memory.delete",
  "session.create",
  "session.list",
  "session.get",
  "session.attach",
  "session.delete",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export function toolDefs(): { name: string; description: string; inputSchema: Record<string, unknown> }[] {
  return TOOL_NAMES.map((name) => ({
    name,
    description: name,
    inputSchema: { type: "object", additionalProperties: true },
  }));
}

export async function callTool(plane: Plane, identity: Identity, name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "harness.list":
      return plane.harnessList();
    case "harness.get":
      return plane.harnessGet(String(args.name));
    case "model.list":
      return plane.modelList(args.harness ? String(args.harness) : undefined);
    case "skill.list":
      return plane.skillList(identity);
    case "mcp.list":
      return plane.mcpList(identity);
    case "repo.list":
      return plane.repoList(identity);
    case "asset.list":
      return plane.assetList(identity);
    case "party.create":
      return plane.partyCreate(identity);
    case "party.get":
      return plane.partyGet(identity, String(args.partyId));
    case "party.list":
      return plane.partyList(identity);
    case "party.add":
      return plane.partyAdd(identity, String(args.partyId), String(args.subject), args.role as "coordinator" | "member" | "observer");
    case "party.close":
      return plane.partyClose(identity, String(args.partyId));
    case "coord.post":
      return plane.coordPost(identity, String(args.partyId ?? partyOf(plane, identity)), args.body ?? args.message);
    case "coord.inbox":
      return plane.coordInbox(identity, String(args.partyId ?? partyOf(plane, identity)), args.since as number | undefined);
    case "coord.wait":
    case "coord.signal":
      return { ok: true };
    case "coord.barrier":
      return plane.coordBarrier(identity, String(args.partyId ?? partyOf(plane, identity)), args.members as string[] | undefined);
    case "coord.handoff":
      return plane.coordHandoff(identity, args as never);
    case "coord.members":
      return plane.coordMembers(identity, String(args.partyId ?? partyOf(plane, identity)));
    case "coord.artifact.put":
      return plane.coordArtifactPut(identity, String(args.partyId ?? partyOf(plane, identity)), String(args.name), String(args.bytes), args.contentType as string | undefined);
    case "coord.artifact.get":
      return plane.coordArtifactGet(identity, String(args.partyId ?? partyOf(plane, identity)), String(args.name));
    case "run.create":
      return plane.createRun(identity, args as never);
    case "run.instruct":
      return plane.instruct(identity, String(args.runId), String(args.prompt ?? args.instruction));
    case "run.wait":
      return plane.wait(identity, String(args.runId));
    case "run.kill":
    case "run.cancel":
    case "job.kill":
      return plane.kill(identity, String(args.runId), args.reason as string | undefined, Boolean(args.cascade));
    case "run.logs":
    case "job.logs":
      return plane.logs(identity, args as never);
    case "run.result":
      return plane.result(identity, String(args.runId));
    case "run.list":
      return plane.list(identity, args.cron ? { cron: String(args.cron) } : undefined);
    case "run.get":
      return plane.get(identity, String(args.runId), Boolean(args.summaryTree));
    case "run.share":
      return plane.share(identity, String(args.runId), args.subjects as string[], "read");
    case "run.unshare":
      return plane.unshare(identity, String(args.runId), args.subjects as string[]);
    case "job.run":
      return plane.jobRun(identity, args as never);
    case "job.spawn":
      return plane.jobSpawn(identity, args as never);
    case "job.wait":
      return plane.jobWait(identity, args as never);
    case "job.progress":
      return plane.progress(identity, args as never);
    case "self.suspend":
      return plane.selfSuspend(identity, args as never);
    case "self.exit":
      return plane.selfExit(identity, args as never);
    case "cron.create":
      return plane.cronCreate(identity, args as never);
    case "cron.list":
      return plane.cronList(identity);
    case "cron.get":
      return plane.cronGet(identity, String(args.name));
    case "cron.delete":
      plane.cronDelete(identity, String(args.name));
      return { ok: true };
    case "cron.enable":
      return plane.cronEnable(identity, String(args.name), args.enabled !== false);
    case "jj.status":
    case "jj.diff":
    case "jj.log":
      return { ok: true, tool: name, proxy: identity.runId ?? null };
    case "jj.new":
    case "jj.describe":
    case "jj.squash":
    case "jj.rebase":
    case "jj.bookmark":
      return { ok: true, tool: name };
    case "jj.git.fetch":
      return plane.mintCred(identity, { repo: String(args.repo), op: "fetch", runId: String(args.runId ?? identity.runId) });
    case "jj.git.push":
      return plane.mintCred(identity, { repo: String(args.repo), op: "push", runId: String(args.runId ?? identity.runId) });
    case "vcs.cred.mint":
      return plane.mintCred(identity, args as never);
    case "memory.put":
      return plane.memoryPut(identity, {
        scope: args.scope as "user" | "party" | "repo",
        text: String(args.text ?? ""),
        partyId: args.partyId ? String(args.partyId) : undefined,
        repo: args.repo ? String(args.repo) : undefined,
        metadata: args.metadata && typeof args.metadata === "object" ? (args.metadata as Record<string, unknown>) : undefined,
      });
    case "memory.search":
      return plane.memorySearch(identity, {
        query: String(args.query ?? ""),
        scope: args.scope ? (args.scope as "user" | "party" | "repo") : undefined,
        partyId: args.partyId ? String(args.partyId) : undefined,
        repo: args.repo ? String(args.repo) : undefined,
        limit: args.limit !== undefined ? Number(args.limit) : undefined,
      });
    case "memory.get":
      return plane.memoryGet(identity, String(args.id));
    case "memory.delete":
      return plane.memoryDelete(identity, String(args.id));
    case "session.create":
      return plane.sessionCreate(identity, args as never);
    case "session.list":
      return plane.sessionList(identity);
    case "session.get":
      return plane.sessionGet(identity, String(args.runId));
    case "session.attach":
      return plane.sessionAttachInfo(
        await plane.sessionGet(identity, String(args.runId)),
        Boolean(args.shell),
      );
    case "session.delete":
      return plane.sessionDelete(identity, String(args.runId));
    default:
      throw new PlaneError(404, `unknown tool: ${name}`);
  }
}

function partyOf(plane: Plane, identity: Identity): string {
  if (!identity.runId) throw new PlaneError(400, "partyId required");
  return plane.getRun(identity.runId).partyId;
}
