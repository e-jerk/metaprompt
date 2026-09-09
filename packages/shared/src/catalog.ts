import { AGENTCORE_GATEWAY_NAME, defaultAgentcore } from "./agentcore.js";
import type { CatalogMcp, CatalogSkill, HarnessAdapter, ModelEntry, PlaneConfig, PlaneLimits } from "./types.js";

export const DEFAULT_SYSTEM_TEXT = `You are a Metaprompt harness.
Spawn work only via job.run / job.spawn / coord.handoff. Never use vendor Task, Agent, or in-process subagent tools.
If subtasks are independent, call job.spawn once so they run as parallel Kubernetes Jobs.
Use after: [id] or a later job.wait when work depends on prior results.
Use the jj MCP for version control. Do not use git remotes or embed credentials.
Use gh.issue.* and gh.pr.* on the plane for GitHub issues and pull requests. Do not embed PATs. On EKS the plane mints GitHub / app tokens from GitHub App or workload OIDC (app.cred.mint).
Prefer job.progress for periodic checks; do not dump descendant logs into your next prompt.`;

export const DEFAULT_LIMITS: PlaneLimits = {
  maxDepth: 4,
  maxRunningPerUser: 16,
  maxParallelPerParent: 8,
  maxAttempts: 8,
  maxWaitFor: 16,
  suspendWaitSeconds: 60,
  suspendTtlSeconds: 86_400,
  maxSkillBytes: 32_768,
  maxMemoryBytes: 32_768,
  maxSummaryBytes: 2_048,
  maxRollupBytes: 8_192,
  defaultTailLines: 50,
  maxTailLines: 500,
  progressHeartbeatSeconds: 15,
  progressHeartbeatLines: 40,
};

export function defaultHarnesses(imagePrefix = "ghcr.io/e-jerk/metaprompt"): HarnessAdapter[] {
  const common = {
    skillPaths: ["skills", ".cursor/skills", ".grok/skills"],
    mcpConfig: "mcp.json",
    systemText: DEFAULT_SYSTEM_TEXT,
  };
  return [
    {
      name: "stub",
      image: `${imagePrefix}/stub:latest`,
      command: ["node", "/opt/metaprompt/stub.js"],
      resumeCommand: ["node", "/opt/metaprompt/stub.js", "--resume"],
      interactiveCommand: ["bun", "/app/packages/runner/src/stub.ts"],
      disallowedTools: ["Task", "Agent", "subagent"],
      defaultModel: "none",
      ...common,
    },
    {
      name: "opencode",
      image: `${imagePrefix}/opencode:latest`,
      command: ["opencode", "run"],
      resumeCommand: ["opencode", "run", "--resume"],
      interactiveCommand: ["opencode"],
      disallowedTools: ["Task", "Agent", "subagent"],
      defaultModel: "mimo-v2.5-free",
      secrets: ["openai", "opencode"],
      ...common,
    },
    {
      name: "claude-code",
      image: `${imagePrefix}/claude-code:latest`,
      command: ["claude", "-p"],
      resumeCommand: ["claude", "-p", "--resume"],
      interactiveCommand: ["claude"],
      disallowedTools: ["Task", "Agent", "subagent"],
      defaultModel: "bedrock-sonnet",
      secrets: ["anthropic"],
      ...common,
    },
    {
      name: "codex",
      image: `${imagePrefix}/codex:latest`,
      command: ["codex", "exec"],
      resumeCommand: ["codex", "exec", "--resume"],
      interactiveCommand: ["codex"],
      disallowedTools: ["Task", "Agent", "subagent"],
      defaultModel: "gpt-5",
      secrets: ["openai"],
      ...common,
    },
    {
      name: "cursor",
      image: `${imagePrefix}/cursor:latest`,
      command: ["metaprompt-cursor"],
      resumeCommand: ["metaprompt-cursor", "--resume"],
      interactiveCommand: ["metaprompt-cursor"],
      disallowedTools: ["Task", "Agent", "subagent"],
      defaultModel: "auto",
      secrets: ["cursor"],
      ...common,
    },
    {
      name: "session",
      image: `${imagePrefix}/session:latest`,
      command: ["bun", "/app/packages/runner/src/session.ts"],
      resumeCommand: ["bun", "/app/packages/runner/src/session.ts"],
      interactiveCommand: ["bun", "/app/packages/runner/src/mp.ts"],
      disallowedTools: ["Task", "Agent", "subagent"],
      defaultModel: "none",
      secrets: ["openai", "anthropic", "cursor"],
      ...common,
    },
    {
      name: "agentcore",
      image: `${imagePrefix}/runner:latest`,
      command: ["bun", "/app/packages/runner/src/agentcore.ts"],
      resumeCommand: ["bun", "/app/packages/runner/src/agentcore.ts"],
      disallowedTools: ["Task", "Agent", "subagent"],
      defaultModel: "agentcore",
      ...common,
    },
  ];
}

export const DEFAULT_MODELS: ModelEntry[] = [
  { id: "auto", provider: "cursor", cursorModel: "auto", harnesses: ["cursor"] },
  { id: "composer-2.5", provider: "cursor", cursorModel: "composer-2.5", harnesses: ["cursor"] },
  {
    id: "bedrock-sonnet",
    provider: "bedrock",
    bedrockId: "us.anthropic.claude-sonnet-4-6",
    harnesses: ["claude-code", "opencode", "agentcore"],
  },
  {
    id: "bedrock-opus",
    provider: "bedrock",
    bedrockId: "us.anthropic.claude-opus-4-6",
    harnesses: ["claude-code", "opencode", "agentcore"],
  },
  { id: "agentcore", provider: "agentcore", harnesses: ["agentcore"] },
  { id: "gpt-5", provider: "openai", openaiModel: "gpt-5", harnesses: ["codex"] },
  {
    id: "mimo-v2.5-free",
    provider: "opencode",
    opencodeModel: "opencode/mimo-v2.5-free",
    harnesses: ["opencode"],
  },
  {
    id: "deepseek-v4-flash-free",
    provider: "opencode",
    opencodeModel: "opencode/deepseek-v4-flash-free",
    harnesses: ["opencode"],
  },
  {
    id: "big-pickle",
    provider: "opencode",
    opencodeModel: "opencode/big-pickle",
    harnesses: ["opencode"],
  },
  { id: "none", provider: "none", harnesses: ["stub", "session"] },
];

export const DEFAULT_BY_HARNESS: Record<string, string> = {
  cursor: "auto",
  "claude-code": "bedrock-sonnet",
  opencode: "mimo-v2.5-free",
  codex: "gpt-5",
  stub: "none",
  session: "none",
  agentcore: "agentcore",
};

export const DEFAULT_SKILLS: CatalogSkill[] = [
  {
    name: "metaprompt-build",
    content: "See skills/metaprompt-build/SKILL.md",
  },
  {
    name: "metaprompt-install-local",
    content: "See skills/metaprompt-install-local/SKILL.md",
  },
  {
    name: "metaprompt-install-eks",
    content: "See skills/metaprompt-install-eks/SKILL.md",
  },
  {
    name: "metaprompt-install-clanker",
    content: "Optional. See skills/metaprompt-install-clanker/SKILL.md. Metaprompt works without Clanker Cloud.",
  },
  {
    name: "metaprompt-clanker-workspace",
    content: "Optional. See skills/metaprompt-clanker-workspace/SKILL.md. Metaprompt works without a Clanker subscription.",
  },
  {
    name: "review",
    content: "Review the current change set. Summarize risks. Do not spawn in-process agents.",
  },
];

/** Default catalog has no Clanker entry. Metaprompt works without a Clanker subscription. */
export const DEFAULT_MCPS: CatalogMcp[] = [
  { name: "linear", url: "https://mcp.linear.app/mcp" },
  { name: "docs", url: "https://example.com/mcp" },
];

function catalogMcps(overrides: Partial<PlaneConfig>): CatalogMcp[] {
  const servers = [...(overrides.mcpServers ?? DEFAULT_MCPS)];
  const ac = overrides.agentcore;
  const name = ac?.gatewayName ?? AGENTCORE_GATEWAY_NAME;
  if (ac?.gatewayUrl && !servers.some((m) => m.name === name || m.url === ac.gatewayUrl)) {
    servers.push({ name, url: ac.gatewayUrl });
  }
  return servers;
}

export function defaultConfig(overrides: Partial<PlaneConfig> = {}): PlaneConfig {
  const region = overrides.agentcore?.region ?? overrides.bedrock?.region ?? "us-east-1";
  return {
    namespace: "metaprompt",
    limits: { ...DEFAULT_LIMITS, ...overrides.limits },
    bedrock: overrides.bedrock ?? { enabled: false, region },
    agentcore: { ...defaultAgentcore(region), ...overrides.agentcore },
    oidc: overrides.oidc,
    staticUsers: overrides.staticUsers ?? [
      { user: "local-dev", token: "local-dev-token", groups: ["eng"], admin: true },
      { user: "alice", token: "alice-token", groups: ["eng"] },
      { user: "bob", token: "bob-token", groups: ["eng"] },
    ],
    runTokenSecret: overrides.runTokenSecret ?? "dev-run-token-secret",
    harnesses: overrides.harnesses ?? defaultHarnesses(),
    models: overrides.models ?? DEFAULT_MODELS,
    defaultByHarness: overrides.defaultByHarness ?? DEFAULT_BY_HARNESS,
    repos: overrides.repos ?? [
      {
        name: "app",
        url: "https://github.com/e-jerk/metaprompt.git",
        ref: "main",
        readers: ["public"],
        writers: ["group:eng-leads", "user:alice"],
        currentSha: "sha-gen-1",
        currentGeneration: "gen-1",
      },
    ],
    assets: overrides.assets ?? [
      {
        name: "eval-set",
        volume: "pvc:eval-set-ro",
        mountPath: "/assets/eval-set",
        readers: ["group:eng", "public"],
      },
    ],
    skills: overrides.skills ?? DEFAULT_SKILLS,
    mcpServers: catalogMcps(overrides),
    vcsSecrets: overrides.vcsSecrets ?? { app: { token: "fake-pat-not-for-jobs" } },
    github: overrides.github,
    oidcApps: overrides.oidcApps ?? { apps: [] },
    gitSync: overrides.gitSync ?? { enabled: false, hostPath: "/var/lib/metaprompt/repos" },
  };
}
