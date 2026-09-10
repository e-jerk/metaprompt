export type RunStatus =
  | "blocked"
  | "queued"
  | "pending"
  | "ready"
  | "running"
  | "suspended"
  | "succeeded"
  | "failed"
  | "cancelled";

export const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set([
  "succeeded",
  "failed",
  "cancelled",
]);

export const ACTIVE_STATUSES: ReadonlySet<RunStatus> = new Set([
  "blocked",
  "queued",
  "pending",
  "ready",
  "running",
  "suspended",
]);

export type StorageKind = "pvc" | "tmpfs";
export type RunKind = "job" | "session";
export type PartyRole = "coordinator" | "member" | "observer";
export type PartyMode = "nested" | "inherit" | string;
export type MemoryScope = "user" | "party" | "repo";

export type Identity = {
  user: string;
  groups: string[];
  admin?: boolean;
  runId?: string;
  sessionId?: string;
};

export type SkillRef = {
  name: string;
  url?: string;
  content?: string;
};

export type McpRef = {
  name: string;
  url?: string;
  secretRef?: string;
};

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  prefixHash: string;
};

export type RunShare = Record<string, "read">;

export type Run = {
  id: string;
  owner: string;
  harness: string;
  repo?: string;
  sha?: string;
  generation?: string;
  model?: string;
  resolvedModel?: {
    id: string;
    provider: string;
    vendorId?: string;
  };
  prompt?: string;
  status: RunStatus;
  attempt: number;
  parentRunId?: string;
  rootRunId: string;
  depth: number;
  partyId: string;
  children: string[];
  createdByRunId?: string;
  waitFor?: string[];
  storage: StorageKind;
  pvcName?: string;
  pvcDeleted?: boolean;
  skills: SkillRef[];
  mcpServers: McpRef[];
  assets: string[];
  cron?: string;
  kind: RunKind;
  share: RunShare;
  summary?: string;
  reason?: string;
  usage: Usage;
  prefixHash: string;
  cacheHint?: string;
  spawnGroupId?: string;
  spawnKey?: string;
  after?: string[];
  createdAt: number;
  updatedAt: number;
  activeDeadlineSeconds?: number;
  instruction?: string;
  resumeSuffix?: string;
  jobName?: string;
  agentcore?: {
    sessionId: string;
    actorId: string;
  };
};

export type PartyMember = {
  subject: string;
  role: PartyRole;
  runId?: string;
};

export type PartyEvent = {
  seq: number;
  at: number;
  type: string;
  from: string;
  body: unknown;
};

export type Party = {
  id: string;
  owner: string;
  closed?: boolean;
  members: PartyMember[];
  log: PartyEvent[];
  artifacts: Record<string, { contentType?: string; bytes: string }>;
  parentPartyId?: string;
  createdAt: number;
};

export type LogLine = {
  seq: number;
  at: number;
  stream: "stdout" | "stderr" | "system";
  chunk: string;
};

export type CronSpec = {
  name: string;
  owner: string;
  schedule: string;
  timezone?: string;
  harness: string;
  repo?: string;
  model?: string;
  prompt: string;
  assets?: string[];
  partyId?: string;
  storage: StorageKind;
  skills?: SkillRef[];
  mcpServers?: McpRef[];
  concurrencyPolicy: "Forbid" | "Allow" | "Replace";
  enabled: boolean;
  createdAt: number;
};

export type RepoSpec = {
  name: string;
  url: string;
  ref: string;
  period?: string;
  readers: string[];
  writers: string[];
  currentSha?: string;
  currentGeneration?: string;
};

export type AssetSpec = {
  name: string;
  volume: string;
  mountPath: string;
  readers: string[];
};

export type AssetMount = {
  name: string;
  volume: string;
  mountPath: string;
  readOnly?: boolean;
};

export type GitSyncConfig = {
  enabled: boolean;
  hostPath: string;
};

/** Local-only hostPath mounts for harness login files. Paths only — never file contents. */
export type LocalAuthMount = {
  name: string;
  hostPath: string;
  mountPath: string;
  harnesses: string[];
  readOnly?: boolean;
};

export type LocalAuthConfig = {
  mounts: LocalAuthMount[];
};

export type CatalogSkill = {
  name: string;
  content: string;
  allowedUsers?: string[];
  allowedGroups?: string[];
};

export type CatalogMcp = {
  name: string;
  url: string;
  secretRef?: string;
  allowedUsers?: string[];
  allowedGroups?: string[];
};

export type ModelEntry = {
  id: string;
  provider: "cursor" | "bedrock" | "openai" | "opencode" | "agentcore" | "none";
  cursorModel?: string;
  bedrockId?: string;
  openaiModel?: string;
  opencodeModel?: string;
  harnesses: string[];
};

export type HarnessAdapter = {
  name: string;
  image: string;
  command: string[];
  resumeCommand: string[];
  interactiveCommand?: string[];
  skillPaths: string[];
  mcpConfig: string;
  disallowedTools: string[];
  systemText: string;
  defaultModel: string;
  secrets?: string[];
};

export type PlaneLimits = {
  maxDepth: number;
  maxRunningPerUser: number;
  maxParallelPerParent: number;
  maxAttempts: number;
  maxWaitFor: number;
  suspendWaitSeconds: number;
  suspendTtlSeconds: number;
  maxSkillBytes: number;
  maxMemoryBytes: number;
  maxSummaryBytes: number;
  maxRollupBytes: number;
  defaultTailLines: number;
  maxTailLines: number;
  progressHeartbeatSeconds: number;
  progressHeartbeatLines: number;
};

export type BedrockConfig = {
  enabled: boolean;
  region: string;
};

/** Amazon Bedrock AgentCore (Harness, Runtime, Gateway, Memory). Sibling of InvokeModel Bedrock. */
export type AgentcoreConfig = {
  enabled: boolean;
  region: string;
  harnessArn?: string;
  runtimeArn?: string;
  qualifier?: string;
  gatewayUrl?: string;
  gatewayArn?: string;
  gatewayName?: string;
  /** URL AgentCore (in AWS) can reach. ClusterIP is not enough. */
  planeExternalUrl?: string;
  memoryArn?: string;
  /** Namespace prefix template. `{actorId}` is substituted. Default `/actors/{actorId}`. */
  memoryNamespace?: string;
  awsSkillPaths?: string[];
  maxIterations?: number;
  maxTokens?: number;
  timeoutSeconds?: number;
  allowedTools?: string[];
  attachPlaneMcp?: boolean;
  enableBrowser?: boolean;
  enableCodeInterpreter?: boolean;
};

export type OidcConfig = {
  provider: string;
  issuer: string;
  audience: string;
  jwksUri?: string;
  enterprise?: string;
  allowedOrgs?: string[];
  adminOrgs?: string[];
  map?: { user?: string; groups?: string[] };
};

export type StaticUser = {
  user: string;
  token: string;
  groups: string[];
  admin?: boolean;
};

export type PlaneConfig = {
  namespace: string;
  limits: PlaneLimits;
  bedrock: BedrockConfig;
  agentcore: AgentcoreConfig;
  oidc?: OidcConfig;
  staticUsers: StaticUser[];
  runTokenSecret: string;
  harnesses: HarnessAdapter[];
  models: ModelEntry[];
  defaultByHarness: Record<string, string>;
  repos: RepoSpec[];
  assets: AssetSpec[];
  gitSync?: GitSyncConfig;
  localAuth?: LocalAuthConfig;
  skills: CatalogSkill[];
  mcpServers: CatalogMcp[];
  vcsSecrets: Record<string, { token?: string; sshKey?: string }>;
  /** Optional GitHub API override (GitHub Enterprise). Default is derived from the repo URL. */
  github?: GithubConfig;
  /** Workload OIDC / GitHub App clients the plane mints tokens for. Keys stay in env/Secrets, never on Jobs. */
  oidcApps?: OidcAppsConfig;
};

export type GithubConfig = {
  apiUrl?: string;
  appId?: string;
  installationId?: string;
};

export type AppAuthGrant = "github-app" | "token-exchange" | "jwt-bearer";

export type AppAuthSpec = {
  name: string;
  grant: AppAuthGrant;
  appId?: string;
  installationId?: string;
  tokenUrl?: string;
  audience?: string;
  scope?: string;
  clientId?: string;
  allowedUsers?: string[];
  allowedGroups?: string[];
};

export type OidcAppsConfig = {
  /** Projected SA token or IRSA web identity. Default: in-cluster SA token. */
  tokenFile?: string;
  apps: AppAuthSpec[];
};

export type ProgressRow = {
  runId: string;
  parentRunId?: string;
  status: RunStatus;
  attempt: number;
  queued?: boolean;
  lastSeq: number;
  lastAt?: number;
  lastLines: string[];
  summary?: string;
};

export type RollupChild = {
  runId: string;
  harness: string;
  status: RunStatus;
  summary?: string;
  usage: Usage;
};

export type SummaryRollup = {
  parentRunId: string;
  children: RollupChild[];
  combined: string;
};

export type MemoryRecord = {
  id: string;
  scope: MemoryScope;
  owner: string;
  partyId?: string;
  repo?: string;
  text: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
};

export type MemoryHit = MemoryRecord & { score: number };

export type SpawnAgent = {
  id?: string;
  harness: string;
  prompt: string;
  model?: string;
  repo?: string;
  assets?: string[];
  skills?: SkillRef[];
  mcpServers?: McpRef[];
  after?: string[];
  storage?: StorageKind;
};

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function isActive(status: RunStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}
