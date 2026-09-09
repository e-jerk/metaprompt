import type { AgentcoreConfig, McpRef, SkillRef, Usage } from "./types.js";

export const AGENTCORE_SYSTEM_TEXT =
  "You are a Metaprompt harness running on Amazon Bedrock AgentCore. The agent loop and filesystem are the AgentCore microVM, not the Kubernetes Job. Spawn children only via the plane MCP (job.spawn). Coordinate with coord.* and memory.* on that same plane. Manage GitHub issues and pull requests with gh.issue.* and gh.pr.* (the plane holds the token). Browser and Code Interpreter are AgentCore tools, not Metaprompt Jobs. Do not use vendor Task, Agent, or subagent tools. Tail descendants with job.progress.";

export const AGENTCORE_GATEWAY_NAME = "agentcore-gateway";
export const AGENTCORE_DEFAULT_MEMORY_NAMESPACE = "/actors/{actorId}";

export function defaultAgentcore(region = "us-east-1"): AgentcoreConfig {
  return {
    enabled: false,
    region,
    attachPlaneMcp: true,
    enableBrowser: false,
    enableCodeInterpreter: false,
    gatewayName: AGENTCORE_GATEWAY_NAME,
    memoryNamespace: AGENTCORE_DEFAULT_MEMORY_NAMESPACE,
  };
}

export function agentcoreConfigured(cfg?: AgentcoreConfig): boolean {
  return Boolean(cfg?.enabled && (cfg.harnessArn || cfg.runtimeArn));
}

export function agentcoreMode(cfg?: AgentcoreConfig): "harness" | "runtime" | undefined {
  if (!cfg?.enabled) return undefined;
  if (cfg.harnessArn) return "harness";
  if (cfg.runtimeArn) return "runtime";
  return undefined;
}

/** InvokeHarness / InvokeAgentRuntime require a session id of at least 33 characters. */
export function agentcoreSessionId(runId: string): string {
  const base = runId.replace(/[^a-zA-Z0-9-_]/g, "-");
  if (base.length >= 33) return base.slice(0, 100);
  return base.padEnd(33, "0");
}

/** actorId for AgentCore Memory isolation. Pattern is alphanumeric plus - _ / : */
export function agentcoreActorId(owner: string): string {
  const cleaned = owner
    .replace(/[^a-zA-Z0-9-_/:]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_/]+/, "")
    .replace(/[-_/]+$/, "")
    .slice(0, 255);
  if (!cleaned) return "user";
  if (!/^[a-zA-Z0-9]/.test(cleaned)) return `u${cleaned}`.slice(0, 255);
  return cleaned;
}

export function memoryIdFromArn(arn: string): string {
  const marker = "memory/";
  const idx = arn.lastIndexOf(marker);
  return idx >= 0 ? arn.slice(idx + marker.length) : arn;
}

export function agentcoreMemoryNamespace(actorId: string, template?: string): string {
  return (template || AGENTCORE_DEFAULT_MEMORY_NAMESPACE).replaceAll("{actorId}", actorId);
}

export function agentcoreBaggage(input: {
  runId: string;
  partyId?: string;
  rootRunId?: string;
  attempt?: number;
}): string {
  const parts = [`mp.run=${input.runId}`];
  if (input.partyId) parts.push(`mp.party=${input.partyId}`);
  if (input.rootRunId) parts.push(`mp.root=${input.rootRunId}`);
  if (input.attempt != null) parts.push(`mp.attempt=${input.attempt}`);
  return parts.join(",");
}

export function mcpUrl(planeUrl: string): string {
  const base = planeUrl.replace(/\/$/, "");
  return base.endsWith("/mcp") ? base : `${base}/mcp`;
}

export type HarnessSkill =
  | { awsSkills: { paths?: string[] } }
  | { git: { url: string; path?: string } }
  | { s3: { uri: string } }
  | { path: string };

export function skillRefsToHarnessSkills(
  skills: SkillRef[],
  awsSkillPaths?: string[],
): HarnessSkill[] {
  const out: HarnessSkill[] = [];
  if (awsSkillPaths?.length) out.push({ awsSkills: { paths: awsSkillPaths } });
  for (const skill of skills) {
    const url = skill.url?.trim();
    if (!url) continue;
    if (url.startsWith("s3://")) {
      out.push({ s3: { uri: url } });
      continue;
    }
    if (/^https?:\/\//i.test(url)) {
      const parsed = parseGitSkillUrl(url);
      out.push({ git: parsed });
    }
  }
  return out;
}

export function inlineSkillTexts(skills: SkillRef[], maxBytes = 16_384): string[] {
  const texts: string[] = [];
  let used = 0;
  for (const skill of skills) {
    if (!skill.content?.trim()) continue;
    const block = `Skill ${skill.name}:\n${skill.content.trim()}`;
    const next = used + new TextEncoder().encode(block).length;
    if (next > maxBytes) break;
    texts.push(block);
    used = next;
  }
  return texts;
}

function parseGitSkillUrl(url: string): { url: string; path?: string } {
  const hashIdx = url.indexOf("#");
  const hashPath = hashIdx >= 0 ? url.slice(hashIdx + 1) || undefined : undefined;
  const withoutHash = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  const qIdx = withoutHash.indexOf("?");
  if (qIdx < 0) return { url: withoutHash, ...(hashPath ? { path: hashPath } : {}) };
  const base = withoutHash.slice(0, qIdx);
  const query = withoutHash.slice(qIdx + 1);
  let pathFromQuery: string | undefined;
  const kept: string[] = [];
  for (const part of query.split("&")) {
    const eq = part.indexOf("=");
    const key = decodeURIComponent(eq >= 0 ? part.slice(0, eq) : part);
    const value = decodeURIComponent(eq >= 0 ? part.slice(eq + 1) : "");
    if (key === "path") pathFromQuery = value || undefined;
    else if (part) kept.push(part);
  }
  const cleaned = kept.length ? `${base}?${kept.join("&")}` : base;
  const path = pathFromQuery || hashPath;
  return { url: cleaned, ...(path ? { path } : {}) };
}

export type AgentcoreRemoteMcp = {
  name: string;
  url: string;
  token?: string;
};

export type AgentcoreInvokeInput = {
  prompt: string;
  planeUrl?: string;
  planeToken?: string;
  modelId?: string;
  gatewayArn?: string;
  attachPlaneMcp?: boolean;
  enableBrowser?: boolean;
  enableCodeInterpreter?: boolean;
  actorId?: string;
  systemTexts?: string[];
  skills?: HarnessSkill[];
  mcpServers?: AgentcoreRemoteMcp[];
  maxIterations?: number;
  maxTokens?: number;
  timeoutSeconds?: number;
  allowedTools?: string[];
};

export function invokeHarnessBody(input: AgentcoreInvokeInput): Record<string, unknown> {
  const tools: Record<string, unknown>[] = [];
  if (input.attachPlaneMcp !== false && input.planeUrl) {
    tools.push(remoteMcpTool("plane", mcpUrl(input.planeUrl), input.planeToken));
  }
  const seen = new Set(tools.map((t) => String(t.name ?? "")));
  for (const mcp of input.mcpServers ?? []) {
    const name = sanitizeToolName(mcp.name);
    if (!mcp.url || seen.has(name) || name === "plane" || name === "jj") continue;
    seen.add(name);
    tools.push(remoteMcpTool(name, mcp.url, mcp.token));
  }
  if (input.gatewayArn) {
    tools.push({
      type: "agentcore_gateway",
      name: "gateway",
      config: { agentCoreGateway: { arn: input.gatewayArn } },
    });
  }
  if (input.enableBrowser) {
    tools.push({ type: "agentcore_browser", name: "browser" });
  }
  if (input.enableCodeInterpreter) {
    tools.push({ type: "agentcore_code_interpreter", name: "code" });
  }
  const systemTexts = [AGENTCORE_SYSTEM_TEXT, ...(input.systemTexts ?? [])].filter(Boolean);
  const body: Record<string, unknown> = {
    messages: [{ role: "user", content: [{ text: input.prompt }] }],
    systemPrompt: systemTexts.map((text) => ({ text })),
  };
  if (input.actorId) body.actorId = input.actorId;
  if (input.modelId) body.model = { bedrockModelConfig: { modelId: input.modelId } };
  if (input.skills?.length) body.skills = input.skills;
  if (input.maxIterations && input.maxIterations > 0) body.maxIterations = input.maxIterations;
  if (input.maxTokens && input.maxTokens > 0) body.maxTokens = input.maxTokens;
  if (input.timeoutSeconds && input.timeoutSeconds > 0) body.timeoutSeconds = input.timeoutSeconds;
  if (input.allowedTools?.length) body.allowedTools = input.allowedTools;
  if (tools.length) body.tools = tools;
  return body;
}

function remoteMcpTool(name: string, url: string, token?: string): Record<string, unknown> {
  return {
    type: "remote_mcp",
    name,
    config: {
      remoteMcp: {
        url,
        ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      },
    },
  };
}

function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 64) || "mcp";
}

export function catalogMcpsForAgentcore(mcps: McpRef[], gatewayName = AGENTCORE_GATEWAY_NAME): AgentcoreRemoteMcp[] {
  return mcps
    .filter((m) => m.url && m.name !== gatewayName && m.name !== "jj")
    .map((m) => ({ name: m.name, url: m.url! }));
}

export function extractHarnessText(payload: unknown): string {
  const chunks: string[] = [];
  collectText(payload, chunks);
  return chunks.join("");
}

export function extractHarnessUsage(payload: unknown): Pick<Usage, "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens"> {
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  collectUsage(payload, usage);
  return usage;
}

function collectUsage(
  value: unknown,
  out: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number },
): void {
  if (value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) collectUsage(item, out);
    return;
  }
  if (typeof value !== "object") return;
  const rec = value as Record<string, unknown>;
  const fromMeta =
    rec.metadata && typeof rec.metadata === "object"
      ? (rec.metadata as { usage?: unknown }).usage
      : undefined;
  addUsage(fromMeta ?? rec.usage, out);
  if (rec.events) collectUsage(rec.events, out);
  if (rec.stream) collectUsage(rec.stream, out);
}

function addUsage(
  usage: unknown,
  out: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number },
): void {
  if (!usage || typeof usage !== "object") return;
  const rec = usage as Record<string, unknown>;
  if (!("inputTokens" in rec || "outputTokens" in rec || "cacheReadInputTokens" in rec)) return;
  out.inputTokens += num(rec.inputTokens);
  out.outputTokens += num(rec.outputTokens);
  out.cacheReadTokens += num(rec.cacheReadInputTokens ?? rec.cacheReadTokens);
  out.cacheWriteTokens += num(rec.cacheWriteInputTokens ?? rec.cacheWriteTokens);
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function collectText(value: unknown, out: string[]): void {
  if (value == null) return;
  if (typeof value === "string") {
    if (value && !looksLikeJsonBlob(value)) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, out);
    return;
  }
  if (typeof value !== "object") return;
  const rec = value as Record<string, unknown>;
  const delta = rec.delta;
  if (delta && typeof delta === "object") {
    const text = (delta as { text?: unknown }).text;
    if (typeof text === "string") out.push(text);
  }
  if (typeof rec.text === "string" && rec.role !== "user") out.push(rec.text);
  if (rec.contentBlockDelta || rec.messageStart || rec.messageStop || rec.metadata) {
    collectText(rec.contentBlockDelta, out);
    return;
  }
  if (rec.stream) collectText(rec.stream, out);
  if (rec.events) collectText(rec.events, out);
  if (rec.result) collectText(rec.result, out);
  if (rec.output) collectText(rec.output, out);
  if (rec.response) collectText(rec.response, out);
  if (rec.content) collectText(rec.content, out);
}

function looksLikeJsonBlob(value: string): boolean {
  const t = value.trim();
  return t.startsWith("{") || t.startsWith("[");
}

export function parseAgentcoreStream(raw: string): unknown[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.includes("data: ")) {
    const parts: unknown[] = [];
    for (const line of trimmed.split(/\r?\n/)) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") continue;
      try {
        parts.push(JSON.parse(data));
      } catch {
        parts.push(data);
      }
    }
    return parts;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [trimmed];
  }
}
