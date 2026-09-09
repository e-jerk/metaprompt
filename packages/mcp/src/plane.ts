import {
  ALWAYS_ON_MCPS,
  ModelError,
  PARENT_ONLY_MCPS,
  agentcoreActorId,
  agentcoreConfigured,
  agentcoreSessionId,
  isGhTool,
  parseGithubRepoUrl,
  cacheHintFor,
  canInstructRun,
  canKillRun,
  canReadRun,
  canSeeParty,
  canTailRun,
  catalogAllowed,
  combineSummaries,
  computePrefixHash,
  decideWait,
  emptyUsage,
  isTerminal,
  listed,
  modelsForHarness,
  newId,
  partyRole,
  readySpawnKeys,
  resolveModel,
  resumeSuffix,
  stubUsage,
  truncate,
  validateSpawnGraph,
  type CatalogMcp,
  type CatalogSkill,
  type CronSpec,
  type Identity,
  type LogLine,
  type McpRef,
  type MemoryHit,
  type MemoryRecord,
  type MemoryScope,
  type Party,
  type PlaneConfig,
  type ProgressRow,
  type RepoSpec,
  type Run,
  type SkillRef,
  type SpawnAgent,
  type GhTool,
  type StorageKind,
} from "@metaprompt/shared";
import { signRunToken } from "./auth.js";
import { PlaneError } from "./errors.js";
import {
  canUseApp,
  githubAppSpec,
  listAppSpecs,
  mintAppToken,
  type AppAuthDeps,
} from "./app-auth.js";
import {
  assertGithubBody,
  githubApi,
  issueNumber,
  requireGithubToken,
  sanitizeGithubItem,
  sanitizeGithubList,
} from "./github.js";
import { HashEmbedder, InMemoryVectorStore, assertNonSecretMemory, newMemoryId, type VectorMemoryStore } from "./memory.js";
import { LocalRuntime, type Runtime } from "./runtime.js";
import { MemoryStore } from "./store.js";

export type CreateRunInput = {
  harness: string;
  repo?: string;
  model?: string;
  prompt?: string;
  sha?: string;
  assets?: string[];
  partyId?: string;
  party?: string;
  skills?: SkillRef[];
  mcpServers?: McpRef[];
  storage?: StorageKind;
  parentRunId?: string;
  createdByRunId?: string;
  spawnGroupId?: string;
  spawnKey?: string;
  after?: string[];
  cron?: string;
  activeDeadlineSeconds?: number;
  kind?: "job" | "session";
};

export class Plane {
  readonly store = new MemoryStore();
  readonly runtime: Runtime;
  readonly memories: VectorMemoryStore;
  githubFetch: typeof fetch = fetch;
  appAuthFetch: typeof fetch = fetch;
  workloadOidcToken?: string;
  appPrivateKeys: Record<string, string> = {};

  constructor(
    readonly config: PlaneConfig,
    runtime?: Runtime,
    memories?: VectorMemoryStore,
  ) {
    this.runtime = runtime ?? new LocalRuntime(this.store);
    this.memories = memories ?? new InMemoryVectorStore(new HashEmbedder());
  }

  now(): number {
    return Date.now();
  }

  runsById(): Map<string, Run> {
    return this.store.runs;
  }

  getRun(id: string): Run {
    const run = this.store.runs.get(id);
    if (!run) throw new PlaneError(404, `run not found: ${id}`);
    return run;
  }

  notify(user: string, type: string, payload: unknown, sessionId?: string): void {
    this.store.notifications.push({ user, sessionId, type, payload, at: this.now() });
  }

  notificationsFor(user: string, types?: string[]): typeof this.store.notifications {
    return this.store.notifications.filter((n) => n.user === user && (!types || types.includes(n.type)));
  }

  appendLog(runId: string, chunk: string, stream: LogLine["stream"] = "stdout"): LogLine {
    const lines = this.store.logs.get(runId) ?? [];
    const line: LogLine = { seq: lines.length + 1, at: this.now(), stream, chunk };
    lines.push(line);
    this.store.logs.set(runId, lines);
    for (const f of this.store.followers.get(runId) ?? []) {
      if (f.kind === "log") this.notify(f.user, "run-log", { runId, seq: line.seq, chunk }, f.sessionId);
      if (f.kind === "progress" && line.seq % this.config.limits.progressHeartbeatLines === 0) {
        this.notify(f.user, "run-progress", this.progressRow(this.getRun(runId)), f.sessionId);
      }
    }
    return line;
  }

  private wake(run: Run): void {
    const waiters = this.store.waiters.get(run.id) ?? [];
    this.store.waiters.delete(run.id);
    for (const w of waiters) w(run);
  }

  private waitForTerminal(runId: string): Promise<Run> {
    const existing = this.store.runs.get(runId);
    if (existing && isTerminal(existing.status)) return Promise.resolve(existing);
    return new Promise((resolve) => {
      const list = this.store.waiters.get(runId) ?? [];
      list.push(resolve);
      this.store.waiters.set(runId, list);
    });
  }

  private harness(name: string) {
    const h = this.config.harnesses.find((x) => x.name === name);
    if (!h) throw new PlaneError(400, `unknown harness: ${name}`);
    return h;
  }

  private repo(name: string): RepoSpec {
    const r = this.config.repos.find((x) => x.name === name);
    if (!r) throw new PlaneError(400, `unknown repo: ${name}`);
    return r;
  }

  private requireSkill(name: string, identity: Identity): CatalogSkill {
    const s = this.config.skills.find((x) => x.name === name);
    if (!s) throw new PlaneError(400, `unknown skill: ${name}`);
    if (!catalogAllowed(s, identity)) throw new PlaneError(403, `forbidden skill: ${name}`);
    return s;
  }

  private requireMcp(name: string, identity: Identity): CatalogMcp {
    const m = this.config.mcpServers.find((x) => x.name === name);
    if (!m) throw new PlaneError(400, `unknown mcp: ${name}`);
    if (!catalogAllowed(m, identity)) throw new PlaneError(403, `forbidden MCP name: ${name}`);
    return m;
  }

  private runningCount(user: string): number {
    let n = 0;
    for (const r of this.store.runs.values()) {
      if (r.owner === user && ["pending", "ready", "running"].includes(r.status)) n++;
    }
    return n;
  }

  private parallelChildren(parentId: string): number {
    let n = 0;
    for (const r of this.store.runs.values()) {
      if (r.parentRunId === parentId && ["pending", "ready", "running", "queued"].includes(r.status)) n++;
    }
    return n;
  }

  private validateSkills(skills: SkillRef[] | undefined, identity: Identity): SkillRef[] {
    const out = skills ?? [];
    let bytes = 0;
    for (const s of out) {
      if (s.content) bytes += Buffer.byteLength(s.content);
      else if (s.url) {
        /* url skills allowed */
      } else this.requireSkill(s.name, identity);
    }
    if (bytes > this.config.limits.maxSkillBytes) throw new PlaneError(400, "skills exceed tokens.maxSkillBytes");
    return out;
  }

  private validateMcps(
    mcps: McpRef[] | undefined,
    identity: Identity,
    opts: { allowParentOnly?: boolean } = {},
  ): McpRef[] {
    const out = mcps ?? [];
    for (const m of out) {
      if ((PARENT_ONLY_MCPS as readonly string[]).includes(m.name) && !opts.allowParentOnly) {
        throw new PlaneError(
          400,
          `MCP ${m.name} is parent-only (optional laptop Clanker Cloud); do not attach it to Jobs`,
        );
      }
      if (m.url) continue;
      this.requireMcp(m.name, identity);
    }
    return out;
  }

  private pinRepo(input: CreateRunInput, identity: Identity): { repo?: string; sha?: string; generation?: string } {
    if (!input.repo) return {};
    const repo = this.repo(input.repo);
    if (!listed(repo.readers, identity) && !listed(repo.writers, identity) && !identity.admin) {
      throw new PlaneError(403, `not a reader of repo ${repo.name}`);
    }
    if (!repo.currentSha && !input.sha) throw new PlaneError(409, `repo generation missing: ${repo.name}`);
    return {
      repo: repo.name,
      sha: input.sha ?? repo.currentSha,
      generation: repo.currentGeneration,
    };
  }

  private validateAssets(names: string[] | undefined, identity: Identity): string[] {
    const out = names ?? [];
    for (const name of out) {
      const asset = this.config.assets.find((a) => a.name === name);
      if (!asset) throw new PlaneError(400, `unknown asset: ${name}`);
      if (!listed(asset.readers, identity) && !identity.admin) throw new PlaneError(403, `not a reader of asset ${name}`);
    }
    return out;
  }

  async createRun(identity: Identity, input: CreateRunInput): Promise<Run> {
    const harness = this.harness(input.harness);
    if ((input.kind ?? "job") === "session" && harness.name === "stub") {
      throw new PlaneError(400, "sessions require a real harness (session, opencode, cursor, claude-code, or codex)");
    }
    if ((input.kind ?? "job") === "session" && harness.name === "agentcore") {
      throw new PlaneError(400, "agentcore is Job-only; AgentCore sessions stay in AWS (run.create / job.spawn)");
    }
    if (harness.name === "agentcore" && !agentcoreConfigured(this.config.agentcore)) {
      throw new PlaneError(409, "AgentCore not configured");
    }
    const parent = input.parentRunId ? this.getRun(input.parentRunId) : undefined;
    const depth = parent ? parent.depth + 1 : 0;
    if (depth > this.config.limits.maxDepth) throw new PlaneError(400, "max depth exceeded");
    let resolvedModel: ReturnType<typeof resolveModel>;
    try {
      resolvedModel = resolveModel({
        harness,
        requested: input.model,
        models: this.config.models,
        defaultByHarness: this.config.defaultByHarness,
        bedrock: this.config.bedrock,
        agentcore: this.config.agentcore,
      });
    } catch (err) {
      if (err instanceof ModelError) throw new PlaneError(409, err.message);
      throw err;
    }
    const pin = this.pinRepo(input, identity);
    const assets = this.validateAssets(input.assets ?? parent?.assets, identity);
    const skills = this.validateSkills(input.skills, identity);
    const mcpServers = this.validateMcps(input.mcpServers, identity, {
      allowParentOnly: input.kind === "session" && !identity.runId,
    });
    const prefixHash = computePrefixHash({ harness, skills, mcpServers });
    const storage = input.storage ?? (input.cron ? "tmpfs" : "pvc");

    let partyId = input.partyId;
    const partyMode = input.party ?? (input.parentRunId ? "nested" : undefined);
    if (!partyId && partyMode && partyMode !== "nested" && partyMode !== "inherit") partyId = partyMode;
    if (!partyId && partyMode === "inherit" && parent) partyId = parent.partyId;
    if (!partyId) {
      const party = this.createPartyRecord(identity, parent?.partyId);
      partyId = party.id;
      if (input.parentRunId) {
        party.members.push({ subject: `run:${input.parentRunId}`, role: "observer", runId: input.parentRunId });
      }
    } else {
      const party = this.store.parties.get(partyId);
      if (!party) throw new PlaneError(404, `party not found: ${partyId}`);
      if (!canSeeParty(party, identity) && !identity.admin) throw new PlaneError(403, "cannot join party");
    }

    const id = newId("run");
    const after = input.after ?? [];
    const blocked = after.length > 0;
    const overUser = this.runningCount(identity.user) >= this.config.limits.maxRunningPerUser;
    const overParent =
      input.parentRunId !== undefined &&
      this.parallelChildren(input.parentRunId) >= this.config.limits.maxParallelPerParent;
    let status: Run["status"] = "pending";
    if (blocked) status = "blocked";
    else if (overUser || overParent) status = "queued";

    const run: Run = {
      id,
      owner: identity.user,
      harness: harness.name,
      repo: pin.repo,
      sha: pin.sha,
      generation: pin.generation,
      model: input.model ?? resolvedModel?.id,
      resolvedModel,
      prompt: input.prompt,
      status,
      attempt: 1,
      parentRunId: input.parentRunId,
      rootRunId: parent?.rootRunId ?? id,
      depth,
      partyId: partyId!,
      children: [],
      createdByRunId: input.createdByRunId ?? identity.runId,
      storage,
      skills,
      mcpServers,
      assets,
      cron: input.cron,
      kind: input.kind ?? "job",
      share: {},
      usage: emptyUsage(prefixHash),
      prefixHash,
      cacheHint: cacheHintFor(skills, mcpServers),
      spawnGroupId: input.spawnGroupId,
      spawnKey: input.spawnKey,
      after,
      createdAt: this.now(),
      updatedAt: this.now(),
      activeDeadlineSeconds: input.activeDeadlineSeconds,
      ...(harness.name === "agentcore"
        ? { agentcore: { sessionId: agentcoreSessionId(id), actorId: agentcoreActorId(identity.user) } }
        : {}),
    };

    this.store.runs.set(id, run);
    this.store.logs.set(id, []);
    if (parent) {
      parent.children.push(id);
      parent.updatedAt = this.now();
    }
    const party = this.store.parties.get(partyId!)!;
    if (status !== "blocked") {
      party.members.push({
        subject: `run:${id}`,
        role: party.members.some((m) => m.role === "coordinator" && m.runId) ? "member" : "member",
        runId: id,
      });
      if (!party.members.some((m) => m.role === "coordinator" && m.runId) && status !== "queued") {
        const mem = party.members.find((m) => m.runId === id);
        if (mem) mem.role = "coordinator";
      }
    }
    if (status === "pending") await this.admit(run);
    this.appendLog(id, `created harness=${harness.name} status=${status}`, "system");
    return run;
  }

  private async admit(run: Run): Promise<void> {
    if (run.status === "blocked") return;
    if (this.runningCount(run.owner) > this.config.limits.maxRunningPerUser) {
      run.status = "queued";
      return;
    }
    if (run.parentRunId && this.parallelChildren(run.parentRunId) > this.config.limits.maxParallelPerParent) {
      run.status = "queued";
      return;
    }
    const started = await this.runtime.start(run, {
      runToken: this.runToken(run),
      planeUrl: process.env.METAPROMPT_PLANE_URL ?? "http://metaprompt-mcp:3333",
    });
    run.jobName = started.jobName;
    run.pvcName = started.pvcName;
    run.status = "ready";
    run.updatedAt = this.now();
    if (run.prompt && !run.instruction) {
      run.instruction = run.prompt;
      run.status = "running";
    }
  }

  async instruct(identity: Identity, runId: string, prompt: string): Promise<Run> {
    const run = this.getRun(runId);
    const party = this.store.parties.get(run.partyId);
    if (!canInstructRun(run, identity, party)) throw new PlaneError(403, "cannot instruct run");
    if (run.status !== "ready" && run.status !== "running") {
      throw new PlaneError(409, `cannot instruct run in status ${run.status}`);
    }
    run.instruction = prompt;
    run.prompt = run.prompt ?? prompt;
    run.status = "running";
    run.updatedAt = this.now();
    this.appendLog(runId, `instruction received (${prompt.length} chars)`, "system");
    return run;
  }

  async wait(identity: Identity, runId: string): Promise<Run> {
    const run = this.getRun(runId);
    if (!canReadRun(run, identity, this.runsById())) throw new PlaneError(403, "cannot read run");
    if (isTerminal(run.status)) return run;
    return this.waitForTerminal(runId);
  }

  async get(identity: Identity, runId: string, summaryTree = false): Promise<Run & { childrenDetail?: unknown }> {
    const run = this.getRun(runId);
    if (!canReadRun(run, identity, this.runsById())) throw new PlaneError(403, "cannot read run");
    if (!summaryTree) return run;
    return { ...run, childrenDetail: this.childSummaries(run) };
  }

  result(identity: Identity, runId: string) {
    const run = this.getRun(runId);
    if (!canReadRun(run, identity, this.runsById())) throw new PlaneError(403, "cannot read run");
    return {
      runId: run.id,
      status: run.status,
      summary: run.summary,
      reason: run.reason,
      usage: run.usage,
      children: this.childSummaries(run),
      resumeSuffix: run.resumeSuffix,
    };
  }

  list(identity: Identity, filter?: { cron?: string }): Run[] {
    const out: Run[] = [];
    for (const run of this.store.runs.values()) {
      if (filter?.cron && run.cron !== filter.cron) continue;
      if (canReadRun(run, identity, this.runsById())) out.push(run);
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  share(identity: Identity, runId: string, subjects: string[], role: "read"): Run {
    const run = this.getRun(runId);
    if (!canInstructRun(run, identity, this.store.parties.get(run.partyId))) {
      throw new PlaneError(403, "cannot share run");
    }
    for (const s of subjects) run.share[s] = role;
    const party = this.store.parties.get(run.partyId);
    if (party) {
      for (const s of subjects) {
        if (!party.members.some((m) => m.subject === s)) {
          party.members.push({ subject: s, role: "observer" });
        }
      }
    }
    return run;
  }

  unshare(identity: Identity, runId: string, subjects: string[]): Run {
    const run = this.getRun(runId);
    if (!canInstructRun(run, identity, this.store.parties.get(run.partyId))) {
      throw new PlaneError(403, "cannot unshare run");
    }
    for (const s of subjects) delete run.share[s];
    return run;
  }

  logs(
    identity: Identity,
    args: { runId?: string; runIds?: string[]; since?: number; tailLines?: number; follow?: boolean },
  ) {
    const ids = args.runIds ?? (args.runId ? [args.runId] : []);
    if (!ids.length) throw new PlaneError(400, "runId or runIds required");
    const tail = Math.min(args.tailLines ?? this.config.limits.defaultTailLines, this.config.limits.maxTailLines);
    const out: Record<string, LogLine[]> = {};
    for (const id of ids) {
      const run = this.getRun(id);
      if (!canTailRun(run, identity, this.runsById())) throw new PlaneError(403, `cannot tail run ${id}`);
      const lines = this.store.logs.get(id) ?? [];
      const sliced = args.since ? lines.filter((l) => l.seq > args.since!) : lines.slice(-tail);
      out[id] = sliced;
      if (args.follow) {
        const list = this.store.followers.get(id) ?? [];
        list.push({ user: identity.user, sessionId: identity.sessionId, kind: "log" });
        this.store.followers.set(id, list);
      }
    }
    return out;
  }

  progress(
    identity: Identity,
    args: { runIds?: string[]; depth?: "children" | "tree"; follow?: boolean },
  ): ProgressRow[] {
    const seeds = args.runIds?.length
      ? args.runIds.map((id) => this.getRun(id))
      : identity.runId
        ? this.childrenOf(identity.runId)
        : [];
    if (args.runIds?.length) {
      for (const run of seeds) {
        if (!canTailRun(run, identity, this.runsById())) throw new PlaneError(403, `cannot progress run ${run.id}`);
      }
    }
    const collected: Run[] = [];
    const walk = (run: Run) => {
      collected.push(run);
      if (args.depth === "tree") {
        for (const c of this.childrenOf(run.id)) walk(c);
      }
    };
    if (args.runIds?.length) {
      for (const r of seeds) {
        if (args.depth === "tree") walk(r);
        else collected.push(r);
      }
    } else if (identity.runId) {
      for (const c of this.childrenOf(identity.runId)) {
        if (args.depth === "tree") walk(c);
        else collected.push(c);
      }
    } else {
      throw new PlaneError(400, "runIds required for non-run callers");
    }
    const rows = collected.map((r) => {
      if (!canTailRun(r, identity, this.runsById())) throw new PlaneError(403, `cannot progress run ${r.id}`);
      if (args.follow) {
        const list = this.store.followers.get(r.id) ?? [];
        list.push({ user: identity.user, sessionId: identity.sessionId, kind: "progress" });
        this.store.followers.set(r.id, list);
      }
      return this.progressRow(r);
    });
    return rows;
  }

  private progressRow(run: Run): ProgressRow {
    const lines = this.store.logs.get(run.id) ?? [];
    const last = lines.slice(-5);
    return {
      runId: run.id,
      parentRunId: run.parentRunId,
      status: run.status,
      attempt: run.attempt,
      queued: run.status === "queued" || run.status === "blocked",
      lastSeq: lines.at(-1)?.seq ?? 0,
      lastAt: lines.at(-1)?.at,
      lastLines: last.map((l) => l.chunk),
      summary: run.summary,
    };
  }

  childrenOf(parentId: string): Run[] {
    return [...this.store.runs.values()].filter((r) => r.parentRunId === parentId);
  }

  private childSummaries(run: Run) {
    return this.childrenOf(run.id)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((c) => ({
        runId: c.id,
        harness: c.harness,
        status: c.status,
        summary: c.summary,
        usage: c.usage,
      }));
  }

  async jobRun(identity: Identity, args: CreateRunInput & { party?: string }): Promise<{ runId: string; partyId: string }> {
    const parentId = identity.runId;
    if (!parentId) throw new PlaneError(400, "job.run requires a run token");
    const parent = this.getRun(parentId);
    const run = await this.createRun(identity, {
      ...args,
      repo: args.repo ?? parent.repo,
      sha: args.sha ?? parent.sha,
      parentRunId: parent.id,
      createdByRunId: parent.id,
      party: args.party ?? "nested",
      partyId: args.party && args.party !== "nested" && args.party !== "inherit" ? args.party : args.partyId,
    });
    return { runId: run.id, partyId: run.partyId };
  }

  async jobSpawn(
    identity: Identity,
    args: { agents: SpawnAgent[]; party?: string },
  ): Promise<{ partyId: string; runIds: Record<string, string> }> {
    const parentId = identity.runId;
    if (!parentId) throw new PlaneError(400, "job.spawn requires a run token");
    const parent = this.getRun(parentId);
    const graph = validateSpawnGraph(args.agents);
    const spawnGroupId = newId("spawn");
    let partyId: string | undefined;
    if (args.party === "inherit") partyId = parent.partyId;
    else if (args.party && args.party !== "nested") partyId = args.party;
    else {
      const party = this.createPartyRecord(identity, parent.partyId);
      party.members.push({ subject: `run:${parent.id}`, role: "observer", runId: parent.id });
      partyId = party.id;
    }
    const runIds: Record<string, string> = {};
    const created: Run[] = [];
    for (const [key, agent] of graph) {
      const run = await this.createRun(identity, {
        harness: agent.harness,
        prompt: agent.prompt,
        model: agent.model,
        repo: agent.repo ?? parent.repo,
        sha: parent.sha,
        assets: agent.assets ?? parent.assets,
        skills: agent.skills,
        mcpServers: agent.mcpServers,
        storage: agent.storage ?? parent.storage,
        parentRunId: parent.id,
        createdByRunId: parent.id,
        partyId,
        party: "inherit",
        spawnGroupId,
        spawnKey: key,
        after: agent.after,
      });
      runIds[key] = run.id;
      created.push(run);
    }
    const first = created.find((r) => r.status !== "blocked");
    if (first) {
      const party = this.store.parties.get(partyId!)!;
      for (const m of party.members) {
        if (m.runId === first.id) m.role = "coordinator";
      }
    }
    return { partyId: partyId!, runIds };
  }

  async jobWait(
    identity: Identity,
    args: { runIds: string[]; timeoutSeconds?: number },
  ): Promise<{ action: "rollup" | "suspended" | "storage-error"; rollup?: ReturnType<typeof combineSummaries>; message?: string }> {
    if (!identity.runId) throw new PlaneError(400, "job.wait requires a run token");
    const parent = this.getRun(identity.runId);
    if (args.runIds.length > this.config.limits.maxWaitFor) throw new PlaneError(400, "max waitFor fan-out");
    const outstanding = args.runIds.map((id) => {
      const r = this.getRun(id);
      if (!canReadRun(r, identity, this.runsById()) && r.createdByRunId !== parent.id) {
        throw new PlaneError(403, `cannot wait on ${id}`);
      }
      return r;
    });
    const decision = decideWait({
      outstanding,
      timeoutSeconds: args.timeoutSeconds,
      storage: parent.storage,
      limits: this.config.limits,
    });
    if (decision.action === "storage-error") {
      return { action: "storage-error", message: decision.message };
    }
    if (decision.action === "suspend") {
      await this.selfSuspend(identity, { waitFor: args.runIds, reason: decision.reason });
      return { action: "suspended" };
    }
    const children = await Promise.all(args.runIds.map((id) => this.waitForTerminal(id)));
    const rollup = combineSummaries(
      parent.id,
      children,
      this.config.limits.maxSummaryBytes,
      this.config.limits.maxRollupBytes,
    );
    parent.resumeSuffix = resumeSuffix(rollup);
    return { action: "rollup", rollup };
  }

  async selfSuspend(identity: Identity, args: { waitFor: string[]; reason?: string }): Promise<Run> {
    if (!identity.runId) throw new PlaneError(400, "self.suspend requires a run token");
    const run = this.getRun(identity.runId);
    if (run.storage === "tmpfs") throw new PlaneError(400, "tmpfs run cannot suspend; pass storage: pvc");
    if (!args.waitFor.length) throw new PlaneError(400, "waitFor must be non-empty");
    if (args.waitFor.length > this.config.limits.maxWaitFor) throw new PlaneError(400, "max waitFor fan-out");
    for (const id of args.waitFor) {
      const child = this.getRun(id);
      if (child.createdByRunId !== run.id && !canReadRun(child, identity, this.runsById())) {
        throw new PlaneError(403, `cannot wait on ${id}`);
      }
    }
    run.waitFor = args.waitFor;
    run.status = "suspended";
    run.reason = args.reason;
    run.updatedAt = this.now();
    this.appendLog(run.id, `suspended waitFor=${args.waitFor.join(",")}`, "system");
    this.notify(run.owner, "run-suspended", { runId: run.id, waitFor: args.waitFor }, identity.sessionId);
    await this.runtime.stop(run);
    if (args.waitFor.every((id) => isTerminal(this.getRun(id).status))) {
      await this.resumeIfReady(run);
    }
    return run;
  }

  async selfExit(
    identity: Identity,
    args: { status?: "succeeded" | "failed"; summary?: string },
  ): Promise<Run> {
    if (!identity.runId) throw new PlaneError(400, "self.exit requires a run token");
    const run = this.getRun(identity.runId);
    const status = args.status ?? "succeeded";
    const summary = args.summary
      ? truncate(args.summary, this.config.limits.maxSummaryBytes)
      : truncate(run.instruction ?? run.prompt ?? "done", this.config.limits.maxSummaryBytes);
    return this.complete(run, status, { summary });
  }

  async complete(
    run: Run,
    status: "succeeded" | "failed" | "cancelled",
    extra?: {
      summary?: string;
      reason?: string;
      usage?: Partial<Pick<Run["usage"], "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens">>;
    },
  ): Promise<Run> {
    if (isTerminal(run.status) && run.status === status) return run;
    run.status = status;
    run.summary = extra?.summary ?? run.summary;
    run.reason = extra?.reason ?? run.reason;
    if (extra?.usage) {
      run.usage = {
        ...run.usage,
        inputTokens: finiteTokens(extra.usage.inputTokens, run.usage.inputTokens),
        outputTokens: finiteTokens(extra.usage.outputTokens, run.usage.outputTokens),
        cacheReadTokens: finiteTokens(extra.usage.cacheReadTokens, run.usage.cacheReadTokens),
        cacheWriteTokens: finiteTokens(extra.usage.cacheWriteTokens, run.usage.cacheWriteTokens),
        prefixHash: run.prefixHash,
      };
    } else if (run.harness === "stub") run.usage = stubUsage(run.prefixHash);
    run.updatedAt = this.now();
    this.appendLog(run.id, `complete ${status}${run.summary ? ` — ${run.summary}` : ""}`, "system");
    // Only delete the Job on cancel. Succeeded/failed Jobs stay until ttlSecondsAfterFinished.
    if (status === "cancelled") {
      await this.runtime.stop(run);
    }
    if (run.pvcName && run.storage === "pvc") {
      await this.runtime.deletePvc(run.pvcName);
      this.store.pvcs.delete(run.pvcName);
      run.pvcDeleted = true;
    }
    const type = status === "cancelled" ? "run-killed" : "run-completed";
    this.notify(run.owner, type, {
      runId: run.id,
      status,
      summary: run.summary,
      reason: run.reason,
      children: this.childSummaries(run),
    });
    this.wake(run);
    await this.onChildTerminal(run);
    return run;
  }

  private async onChildTerminal(run: Run): Promise<void> {
    if (run.spawnGroupId && run.spawnKey) {
      await this.unblockSpawnGroup(run.spawnGroupId);
    }
    await this.admitQueued();
    if (run.parentRunId) {
      const parent = this.store.runs.get(run.parentRunId);
      if (parent?.status === "suspended" && parent.waitFor?.length) {
        await this.resumeIfReady(parent);
      }
    }
  }

  private async unblockSpawnGroup(groupId: string): Promise<void> {
    const members = [...this.store.runs.values()].filter((r) => r.spawnGroupId === groupId);
    const keyToRun = new Map(members.map((m) => [m.spawnKey!, m]));
    const terminalKeys = new Set(
      members.filter((m) => isTerminal(m.status) && m.spawnKey).map((m) => m.spawnKey!),
    );
    const graph = new Map(
      members
        .filter((m) => m.spawnKey)
        .map((m) => [m.spawnKey!, { id: m.spawnKey, harness: m.harness, prompt: m.prompt ?? "", after: m.after }]),
    );
    for (const key of readySpawnKeys(graph, terminalKeys)) {
      const r = keyToRun.get(key);
      if (r && r.status === "blocked") {
        r.status = "pending";
        const party = this.store.parties.get(r.partyId);
        party?.members.push({ subject: `run:${r.id}`, role: "member", runId: r.id });
        await this.admit(r);
      }
    }
  }

  private async admitQueued(): Promise<void> {
    for (const run of this.store.runs.values()) {
      if (run.status === "queued") {
        run.status = "pending";
        await this.admit(run);
      }
    }
  }

  private async resumeIfReady(run: Run): Promise<void> {
    if (run.status !== "suspended" || !run.waitFor?.length) return;
    if (!run.waitFor.every((id) => isTerminal(this.getRun(id).status))) return;
    if (run.attempt >= this.config.limits.maxAttempts) {
      await this.complete(run, "failed", { reason: "max attempts" });
      return;
    }
    const children = run.waitFor.map((id) => this.getRun(id));
    const rollup = combineSummaries(
      run.id,
      children,
      this.config.limits.maxSummaryBytes,
      this.config.limits.maxRollupBytes,
    );
    run.resumeSuffix = resumeSuffix(rollup);
    run.attempt += 1;
    run.status = "running";
    run.waitFor = undefined;
    run.updatedAt = this.now();
    this.appendLog(run.id, `resumed attempt=${run.attempt}`, "system");
    this.notify(run.owner, "run-resumed", { runId: run.id, attempt: run.attempt, rollup }, run.id);
    const started = await this.runtime.start(run, {
      runToken: this.runToken(run),
      planeUrl: process.env.METAPROMPT_PLANE_URL ?? "http://metaprompt-mcp:3333",
    });
    run.jobName = started.jobName;
    if (started.pvcName) run.pvcName = started.pvcName;
  }

  async kill(identity: Identity, runId: string, reason?: string, cascade = false): Promise<Run> {
    const run = this.getRun(runId);
    const party = this.store.parties.get(run.partyId);
    if (!canKillRun(run, identity, party)) throw new PlaneError(403, "cannot kill run");
    if (isTerminal(run.status)) return run;
    await this.runtime.stop(run);
    await this.complete(run, "cancelled", { reason: reason ?? "killed", summary: reason ?? "killed" });
    if (cascade) {
      for (const child of this.descendants(run.id)) {
        if (!isTerminal(child.status)) {
          await this.complete(child, "cancelled", { reason: `cascade from ${run.id}`, summary: "cascade kill" });
        }
      }
    }
    return run;
  }

  descendants(runId: string): Run[] {
    const out: Run[] = [];
    const walk = (id: string) => {
      for (const c of this.childrenOf(id)) {
        out.push(c);
        walk(c.id);
      }
    };
    walk(runId);
    return out;
  }

  asRun(run: Run): Identity {
    return {
      user: run.owner,
      groups: [],
      runId: run.id,
      sessionId: `run:${run.id}`,
    };
  }

  runToken(run: Run): string {
    return signRunToken(this.config.runTokenSecret, {
      typ: "run",
      user: run.owner,
      groups: [],
      runId: run.id,
    });
  }

  createPartyRecord(identity: Identity, parentPartyId?: string): Party {
    const party: Party = {
      id: newId("party"),
      owner: identity.user,
      members: [{ subject: `user:${identity.user}`, role: "coordinator" }],
      log: [],
      artifacts: {},
      parentPartyId,
      createdAt: this.now(),
    };
    this.store.parties.set(party.id, party);
    return party;
  }

  partyCreate(identity: Identity): Party {
    return this.createPartyRecord(identity);
  }

  partyGet(identity: Identity, partyId: string): Party {
    const party = this.store.parties.get(partyId);
    if (!party) throw new PlaneError(404, "party not found");
    if (!canSeeParty(party, identity)) throw new PlaneError(403, "cannot read party");
    return party;
  }

  partyList(identity: Identity): Party[] {
    return [...this.store.parties.values()].filter((p) => canSeeParty(p, identity));
  }

  partyAdd(identity: Identity, partyId: string, subject: string, role: Party["members"][number]["role"]): Party {
    const party = this.partyGet(identity, partyId);
    if (partyRole(party, identity) !== "coordinator") throw new PlaneError(403, "coordinator required");
    party.members.push({ subject, role });
    return party;
  }

  partyClose(identity: Identity, partyId: string): Party {
    const party = this.partyGet(identity, partyId);
    if (partyRole(party, identity) !== "coordinator") throw new PlaneError(403, "coordinator required");
    party.closed = true;
    return party;
  }

  coordPost(identity: Identity, partyId: string, body: unknown): Party["log"][number] {
    const party = this.partyGet(identity, partyId);
    const role = partyRole(party, identity);
    if (!role || role === "observer") throw new PlaneError(403, "member required");
    const ev = {
      seq: party.log.length + 1,
      at: this.now(),
      type: "post",
      from: identity.runId ?? identity.user,
      body,
    };
    party.log.push(ev);
    return ev;
  }

  coordInbox(identity: Identity, partyId: string, since?: number) {
    const party = this.partyGet(identity, partyId);
    return since ? party.log.filter((e) => e.seq > since) : party.log;
  }

  coordMembers(identity: Identity, partyId: string) {
    return this.partyGet(identity, partyId).members;
  }

  async coordBarrier(identity: Identity, partyId: string, members?: string[]): Promise<{ arrived: string[] }> {
    const party = this.partyGet(identity, partyId);
    const role = partyRole(party, identity);
    if (!role || role === "observer") throw new PlaneError(403, "member required");
    const ev = {
      seq: party.log.length + 1,
      at: this.now(),
      type: "barrier",
      from: identity.runId ?? identity.user,
      body: { members },
    };
    party.log.push(ev);
    return { arrived: [identity.runId ?? identity.user] };
  }

  async coordHandoff(identity: Identity, args: CreateRunInput & { partyId?: string; message?: string }) {
    const partyId = args.partyId ?? (identity.runId ? this.getRun(identity.runId).partyId : undefined);
    if (!partyId) throw new PlaneError(400, "partyId required");
    const party = this.partyGet(identity, partyId);
    party.log.push({
      seq: party.log.length + 1,
      at: this.now(),
      type: "handoff",
      from: identity.runId ?? identity.user,
      body: { message: args.message, harness: args.harness },
    });
    if (identity.runId) {
      return this.jobRun(identity, { ...args, party: args.partyId ? args.partyId : "nested" });
    }
    const run = await this.createRun(identity, { ...args, partyId });
    return { runId: run.id, partyId: run.partyId };
  }

  coordArtifactPut(identity: Identity, partyId: string, name: string, bytes: string, contentType?: string) {
    const party = this.partyGet(identity, partyId);
    const role = partyRole(party, identity);
    if (!role || role === "observer") throw new PlaneError(403, "member required");
    party.artifacts[name] = { bytes, contentType };
    return { name };
  }

  coordArtifactGet(identity: Identity, partyId: string, name: string) {
    const party = this.partyGet(identity, partyId);
    const art = party.artifacts[name];
    if (!art) throw new PlaneError(404, "artifact not found");
    return { name, ...art };
  }

  cronCreate(identity: Identity, spec: Omit<CronSpec, "owner" | "createdAt" | "enabled"> & { enabled?: boolean }): CronSpec {
    if (this.store.crons.has(spec.name)) throw new PlaneError(409, "cron exists");
    const cron: CronSpec = {
      ...spec,
      owner: identity.user,
      storage: spec.storage ?? "tmpfs",
      concurrencyPolicy: spec.concurrencyPolicy ?? "Forbid",
      enabled: spec.enabled ?? true,
      createdAt: this.now(),
    };
    this.store.crons.set(cron.name, cron);
    return cron;
  }

  cronGet(identity: Identity, name: string): CronSpec {
    const c = this.store.crons.get(name);
    if (!c) throw new PlaneError(404, "cron not found");
    if (c.owner !== identity.user && !identity.admin) throw new PlaneError(403, "cannot read cron");
    return c;
  }

  cronList(identity: Identity): CronSpec[] {
    return [...this.store.crons.values()].filter((c) => c.owner === identity.user || identity.admin);
  }

  cronDelete(identity: Identity, name: string): void {
    this.cronGet(identity, name);
    this.store.crons.delete(name);
  }

  cronEnable(identity: Identity, name: string, enabled: boolean): CronSpec {
    const c = this.cronGet(identity, name);
    c.enabled = enabled;
    return c;
  }

  async cronFire(identity: Identity, name: string): Promise<Run> {
    const cron = this.cronGet(identity, name);
    if (!cron.enabled) throw new PlaneError(409, "cron disabled");
    return this.createRun(identity, {
      harness: cron.harness,
      repo: cron.repo,
      model: cron.model,
      prompt: cron.prompt,
      assets: cron.assets,
      partyId: cron.partyId,
      storage: cron.storage,
      skills: cron.skills,
      mcpServers: cron.mcpServers,
      cron: cron.name,
    });
  }

  harnessList() {
    return this.config.harnesses.map((h) => ({
      name: h.name,
      defaultModel: this.config.defaultByHarness[h.name] ?? h.defaultModel,
      models: modelsForHarness(h.name, this.config.models).map((m) => m.id),
      disallowedTools: h.disallowedTools,
      image: h.image,
    }));
  }

  harnessGet(name: string) {
    const listedH = this.harnessList().find((h) => h.name === name);
    if (!listedH) throw new PlaneError(404, "harness not found");
    return listedH;
  }

  modelList(harness?: string) {
    return harness ? modelsForHarness(harness, this.config.models) : this.config.models;
  }

  skillList(identity: Identity) {
    return this.config.skills.filter((s) => catalogAllowed(s, identity)).map((s) => ({ name: s.name }));
  }

  mcpList(identity: Identity) {
    return this.config.mcpServers.filter((m) => catalogAllowed(m, identity)).map((m) => ({ name: m.name }));
  }

  repoList(identity: Identity) {
    return this.config.repos
      .filter((r) => listed(r.readers, identity) || listed(r.writers, identity) || identity.admin)
      .map((r) => ({ name: r.name, ref: r.ref, currentSha: r.currentSha }));
  }

  assetList(identity: Identity) {
    return this.config.assets
      .filter((a) => listed(a.readers, identity) || identity.admin)
      .map((a) => ({ name: a.name, mountPath: a.mountPath }));
  }

  sessionAttachInfo(run: Run, shell = false) {
    const namespace = this.config.namespace;
    const context = process.env.METAPROMPT_KUBE_CONTEXT ?? "metaprompt";
    const podName = run.jobName ?? `mp-${run.id}`;
    const inner = shell ? "/bin/bash" : "/workspace/.mp/attach";
    return {
      namespace,
      context,
      podName,
      container: "harness",
      command: `kubectl --context ${context} -n ${namespace} exec -it ${podName} -c harness -- ${inner}`,
    };
  }

  async sessionCreate(
    identity: Identity,
    args: {
      harness?: string;
      repo?: string;
      model?: string;
      skills?: SkillRef[];
      mcpServers?: McpRef[];
      storage?: StorageKind;
      assets?: string[];
    },
  ) {
    if (identity.runId) throw new PlaneError(400, "session.create is parent-only; Jobs use job.spawn");
    const harness = args.harness ?? "session";
    const run = await this.createRun(identity, {
      harness,
      repo: args.repo,
      model: args.model,
      skills: args.skills,
      mcpServers: args.mcpServers,
      storage: args.storage ?? "pvc",
      assets: args.assets,
      prompt: "interactive session",
      kind: "session",
    });
    return {
      runId: run.id,
      partyId: run.partyId,
      harness: run.harness,
      model: run.resolvedModel ?? { id: run.model },
      podName: run.jobName,
      namespace: this.config.namespace,
      attach: this.sessionAttachInfo(run),
      shell: this.sessionAttachInfo(run, true),
    };
  }

  sessionList(identity: Identity) {
    return this.list(identity).filter((r) => r.kind === "session");
  }

  async sessionGet(identity: Identity, runId: string) {
    const run = await this.get(identity, runId);
    if (run.kind !== "session") throw new PlaneError(400, "not a session");
    return { ...run, attach: this.sessionAttachInfo(run), shell: this.sessionAttachInfo(run, true) };
  }

  async sessionDelete(identity: Identity, runId: string) {
    const run = this.getRun(runId);
    if (run.kind !== "session") throw new PlaneError(400, "not a session");
    return this.kill(identity, runId, "session closed");
  }

  private memoryMaxBytes(): number {
    return this.config.limits.maxMemoryBytes ?? this.config.limits.maxSkillBytes;
  }

  private assertMemoryText(text: string): string {
    if (!text || !text.trim()) throw new PlaneError(400, "memory text is empty");
    if (Buffer.byteLength(text) > this.memoryMaxBytes()) {
      throw new PlaneError(400, "memory text exceeds maxMemoryBytes");
    }
    assertNonSecretMemory(text);
    return text;
  }

  private canReadMemory(identity: Identity, row: MemoryRecord): boolean {
    if (row.scope === "user") return row.owner === identity.user;
    if (row.scope === "party") {
      if (!row.partyId) return false;
      const party = this.store.parties.get(row.partyId);
      if (!party) return false;
      return canSeeParty(party, identity);
    }
    if (row.scope === "repo") {
      if (!row.repo) return false;
      const repo = this.repo(row.repo);
      return listed(repo.readers, identity) || listed(repo.writers, identity) || Boolean(identity.admin);
    }
    return false;
  }

  private canWriteMemory(
    identity: Identity,
    scope: MemoryScope,
    args: { partyId?: string; repo?: string },
  ): void {
    if (scope === "user") return;
    if (scope === "party") {
      if (!args.partyId) throw new PlaneError(400, "partyId required for party memory");
      const party = this.partyGet(identity, args.partyId);
      const role = partyRole(party, identity);
      if (!role || role === "observer") throw new PlaneError(403, "party member required to put memory");
      return;
    }
    if (scope === "repo") {
      if (!args.repo) throw new PlaneError(400, "repo required for repo memory");
      const repo = this.repo(args.repo);
      if (!listed(repo.writers, identity) && !identity.admin) {
        throw new PlaneError(403, "repo writer required to put memory");
      }
      return;
    }
    throw new PlaneError(400, `unknown memory scope: ${scope}`);
  }

  private canDeleteMemory(identity: Identity, row: MemoryRecord): boolean {
    if (row.scope === "user") return row.owner === identity.user;
    if (row.scope === "party") {
      if (!row.partyId) return false;
      const party = this.store.parties.get(row.partyId);
      if (!party) return false;
      if (!canSeeParty(party, identity)) return false;
      return partyRole(party, identity) === "coordinator" || row.owner === identity.user;
    }
    if (row.scope === "repo") {
      if (!row.repo) return false;
      const repo = this.repo(row.repo);
      return listed(repo.writers, identity) || Boolean(identity.admin);
    }
    return false;
  }

  async memoryPut(
    identity: Identity,
    args: {
      scope: MemoryScope;
      text: string;
      partyId?: string;
      repo?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<MemoryRecord> {
    const scope = args.scope;
    if (scope !== "user" && scope !== "party" && scope !== "repo") {
      throw new PlaneError(400, "scope must be user, party, or repo");
    }
    const text = this.assertMemoryText(args.text);
    if (args.metadata) assertNonSecretMemory(JSON.stringify(args.metadata));
    this.canWriteMemory(identity, scope, args);
    const embedding = await this.memories.embedder.embed(text);
    const row = {
      id: newMemoryId(),
      scope,
      owner: identity.user,
      partyId: scope === "party" ? args.partyId : undefined,
      repo: scope === "repo" ? args.repo : undefined,
      text,
      metadata: args.metadata,
      embedding,
      createdAt: this.now(),
    };
    await this.memories.put(row);
    const { embedding: _embedding, ...record } = row;
    return record;
  }

  async memorySearch(
    identity: Identity,
    args: { query: string; scope?: MemoryScope; partyId?: string; repo?: string; limit?: number },
  ): Promise<MemoryHit[]> {
    const query = args.query?.trim();
    if (!query) throw new PlaneError(400, "query is required");
    if (args.scope === "party" && args.partyId) this.partyGet(identity, args.partyId);
    if (args.scope === "repo" && args.repo) {
      const repo = this.repo(args.repo);
      if (!listed(repo.readers, identity) && !listed(repo.writers, identity) && !identity.admin) {
        throw new PlaneError(403, "not a reader of repo");
      }
    }
    const vec = await this.memories.embedder.embed(query);
    const limit = Math.min(Math.max(args.limit ?? 8, 1), 50);
    const filterOwner = args.scope === "user" ? identity.user : undefined;
    const hits = await this.memories.search(vec, {
      scope: args.scope,
      owner: filterOwner,
      partyId: args.partyId,
      repo: args.repo,
      limit: Math.max(limit * 4, 32),
    });
    return hits.filter((hit) => this.canReadMemory(identity, hit)).slice(0, limit);
  }

  async memoryGet(identity: Identity, id: string): Promise<MemoryRecord> {
    const row = await this.memories.get(id);
    if (!row) throw new PlaneError(404, "memory not found");
    if (!this.canReadMemory(identity, row)) throw new PlaneError(403, "cannot read memory");
    const { embedding: _embedding, ...record } = row;
    return record;
  }

  async memoryDelete(identity: Identity, id: string): Promise<{ ok: true }> {
    const row = await this.memories.get(id);
    if (!row) throw new PlaneError(404, "memory not found");
    if (!this.canDeleteMemory(identity, row)) throw new PlaneError(403, "cannot delete memory");
    await this.memories.delete(id);
    return { ok: true };
  }

  async github(identity: Identity, tool: string, args: Record<string, unknown>): Promise<unknown> {
    if (!isGhTool(tool)) throw new PlaneError(404, `unknown tool: ${tool}`);
    const write = !tool.endsWith(".list") && !tool.endsWith(".get");
    const ctx = await this.githubContext(identity, args.repo ? String(args.repo) : undefined, write);
    const fetchImpl = this.githubFetch;
    const call = (method: string, path: string, body?: unknown, query?: Record<string, string | undefined>) =>
      githubApi({ token: ctx.token, ref: ctx.ref, method, path, body, query, fetchImpl });
    switch (tool as GhTool) {
      case "gh.issue.list":
        return sanitizeGithubList(
          "issue",
          await call("GET", "/issues", undefined, {
            state: args.state ? String(args.state) : "open",
            labels: args.labels ? String(args.labels) : undefined,
            per_page: "20",
          }),
        );
      case "gh.issue.get":
        return sanitizeGithubItem("issue", await call("GET", `/issues/${issueNumber(args)}`));
      case "gh.issue.create": {
        const title = String(args.title ?? "").trim();
        if (!title) throw new PlaneError(400, "title required");
        assertGithubBody(args.body ? String(args.body) : undefined);
        return sanitizeGithubItem(
          "issue",
          await call("POST", "/issues", {
            title,
            body: args.body ? String(args.body) : undefined,
            labels: Array.isArray(args.labels) ? args.labels.map(String) : undefined,
          }),
        );
      }
      case "gh.issue.comment": {
        const body = String(args.body ?? "").trim();
        if (!body) throw new PlaneError(400, "body required");
        assertGithubBody(body);
        const created = await call("POST", `/issues/${issueNumber(args)}/comments`, { body });
        return sanitizeGithubItem("review", created as Record<string, unknown>);
      }
      case "gh.issue.update": {
        if (args.body) assertGithubBody(String(args.body));
        return sanitizeGithubItem(
          "issue",
          await call("PATCH", `/issues/${issueNumber(args)}`, {
            ...(args.title ? { title: String(args.title) } : {}),
            ...(args.body ? { body: String(args.body) } : {}),
            ...(args.state ? { state: String(args.state) } : {}),
          }),
        );
      }
      case "gh.pr.list":
        return sanitizeGithubList(
          "pr",
          await call("GET", "/pulls", undefined, {
            state: args.state ? String(args.state) : "open",
            per_page: "20",
          }),
        );
      case "gh.pr.get":
        return sanitizeGithubItem("pr", await call("GET", `/pulls/${issueNumber(args)}`));
      case "gh.pr.create": {
        const title = String(args.title ?? "").trim();
        const head = String(args.head ?? "").trim();
        const base = String(args.base ?? ctx.repo.ref ?? "main").trim();
        if (!title || !head) throw new PlaneError(400, "title and head required");
        assertGithubBody(args.body ? String(args.body) : undefined);
        return sanitizeGithubItem(
          "pr",
          await call("POST", "/pulls", {
            title,
            head,
            base,
            body: args.body ? String(args.body) : undefined,
          }),
        );
      }
      case "gh.pr.review": {
        const event = String(args.event ?? args.action ?? "COMMENT").toUpperCase();
        if (!["APPROVE", "REQUEST_CHANGES", "COMMENT"].includes(event)) {
          throw new PlaneError(400, "event must be APPROVE, REQUEST_CHANGES, or COMMENT");
        }
        assertGithubBody(args.body ? String(args.body) : undefined);
        return sanitizeGithubItem(
          "review",
          await call("POST", `/pulls/${issueNumber(args)}/reviews`, {
            event,
            body: args.body ? String(args.body) : undefined,
          }),
        );
      }
      case "gh.pr.merge":
        return sanitizeGithubItem(
          "pr",
          await call("PUT", `/pulls/${issueNumber(args)}/merge`, {
            merge_method: String(args.method ?? args.mergeMethod ?? "squash"),
          }),
        );
      default:
        throw new PlaneError(404, `unknown tool: ${tool}`);
    }
  }

  private async githubContext(identity: Identity, repoName: string | undefined, write: boolean) {
    const name = repoName || (identity.runId ? this.getRun(identity.runId).repo : undefined);
    if (!name) throw new PlaneError(400, "repo required");
    const repo = this.repo(name);
    const writer = listed(repo.writers, identity) || Boolean(identity.admin);
    const reader = listed(repo.readers, identity) || writer;
    if (write && !writer) throw new PlaneError(403, `not a writer of repo ${name}`);
    if (!write && !reader) throw new PlaneError(403, `not a reader of repo ${name}`);
    let ref;
    try {
      ref = parseGithubRepoUrl(repo.url, this.config.github?.apiUrl);
    } catch (err) {
      throw new PlaneError(400, err instanceof Error ? err.message : "invalid repo url");
    }
    const minted = await this.tryMintGithub(identity);
    return { repo, ref, token: minted?.token ?? requireGithubToken(this.config.vcsSecrets[name]?.token, name) };
  }

  private appAuthDeps(name: string): AppAuthDeps {
    return {
      fetchImpl: this.appAuthFetch,
      privateKey: this.appPrivateKeys[name],
      readWorkloadToken: this.workloadOidcToken ? () => this.workloadOidcToken : undefined,
      apiBase: this.config.github?.apiUrl,
    };
  }

  private async tryMintGithub(identity: Identity) {
    const spec = githubAppSpec(this.config.github, this.config.oidcApps?.apps);
    if (!spec || !canUseApp(identity, spec)) return undefined;
    return mintAppToken(spec, this.appAuthDeps("github"));
  }

  appList(identity: Identity): Array<{ name: string; grant: string }> {
    return listAppSpecs(this.config.oidcApps, this.config.github)
      .filter((spec) => canUseApp(identity, spec))
      .map((spec) => ({ name: spec.name, grant: spec.grant }));
  }

  async appCredMint(identity: Identity, args: { name: string; repo?: string; scope?: string }) {
    const spec = listAppSpecs(this.config.oidcApps, this.config.github).find((a) => a.name === args.name);
    if (!spec) throw new PlaneError(404, `unknown app: ${args.name}`);
    if (!canUseApp(identity, spec)) throw new PlaneError(403, `cannot use app ${args.name}`);
    if (spec.name === "github" || spec.grant === "github-app") {
      const repoName = args.repo || (identity.runId ? this.getRun(identity.runId).repo : undefined);
      if (repoName) {
        const repo = this.repo(repoName);
        if (!listed(repo.readers, identity) && !listed(repo.writers, identity) && !identity.admin) {
          throw new PlaneError(403, `not a reader of repo ${repoName}`);
        }
      }
    }
    const minted = await mintAppToken({ ...spec, scope: args.scope ?? spec.scope }, this.appAuthDeps(spec.name));
    this.store.minted.push({
      repo: args.repo ?? spec.name,
      op: "app",
      runId: identity.runId ?? "user",
      token: `minted-app-${spec.name}`,
      at: this.now(),
    });
    return {
      token: minted.token,
      ephemeral: true,
      expiresAt: minted.expiresAt,
      username: minted.username,
      source: minted.source,
    };
  }

  async mintCred(identity: Identity, args: { repo: string; op: "fetch" | "push"; runId: string }) {
    const repo = this.repo(args.repo);
    const run = this.getRun(args.runId);
    if (run.owner !== identity.user && !identity.admin && identity.runId !== run.id) {
      throw new PlaneError(403, "cannot mint for this run");
    }
    const writer = listed(repo.writers, identity) || identity.admin;
    const reader = listed(repo.readers, identity) || writer;
    if (args.op === "fetch" && !reader) throw new PlaneError(403, "jj.git.fetch needs reader");
    if (args.op === "push" && !writer) throw new PlaneError(403, "jj.git.push needs writer");
    const minted = await this.tryMintGithub(identity);
    if (minted) {
      this.store.minted.push({
        repo: args.repo,
        op: args.op,
        runId: args.runId,
        token: `minted-${args.op}-${newId("cred")}`,
        at: this.now(),
      });
      return {
        token: minted.token,
        username: minted.username ?? "x-access-token",
        ephemeral: true,
        expiresAt: minted.expiresAt,
        source: minted.source,
      };
    }
    const secret = this.config.vcsSecrets[args.repo];
    if (!secret?.token && !secret?.sshKey) {
      const token = `minted-${args.op}-${args.runId}`;
      this.store.minted.push({ repo: args.repo, op: args.op, runId: args.runId, token, at: this.now() });
      return { token, ephemeral: true, source: "placeholder" as const };
    }
    const token = `minted-${args.op}-${newId("cred")}`;
    this.store.minted.push({ repo: args.repo, op: args.op, runId: args.runId, token, at: this.now() });
    return { token, ephemeral: true, source: "placeholder" as const };
  }

  setRepoSha(name: string, sha: string, generation: string): void {
    const repo = this.repo(name);
    repo.currentSha = sha;
    repo.currentGeneration = generation;
  }

  alwaysOnMcps(): readonly string[] {
    return ALWAYS_ON_MCPS;
  }

  injectedFor(run: Run): { skills: string[]; mcpServers: string[] } {
    return {
      skills: run.skills.map((s) => s.name),
      mcpServers: [...ALWAYS_ON_MCPS, ...run.mcpServers.map((m) => m.name)],
    };
  }
}

function finiteTokens(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}
