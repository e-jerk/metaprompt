#!/usr/bin/env bun
import {
  AGENTCORE_SYSTEM_TEXT,
  DEFAULT_SYSTEM_TEXT,
  agentcoreActorId,
  agentcoreBaggage,
  agentcoreMemoryNamespace,
  agentcoreSessionId,
  catalogMcpsForAgentcore,
  extractHarnessText,
  extractHarnessUsage,
  inlineSkillTexts,
  invokeHarnessBody,
  memoryIdFromArn,
  parseAgentcoreStream,
  skillRefsToHarnessSkills,
  type McpRef,
  type SkillRef,
  type Usage,
} from "@metaprompt/shared";
import { loadAwsCredentials, signAwsRequest, type AwsCredentials } from "./aws-sigv4.js";

export type AgentcoreInvokeResult = {
  text: string;
  usage: Pick<Usage, "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens">;
  sessionId: string;
  actorId: string;
};

export type AgentcoreInvokeEnv = {
  runId: string;
  prompt: string;
  region: string;
  harnessArn?: string;
  runtimeArn?: string;
  qualifier?: string;
  gatewayArn?: string;
  attachPlaneMcp?: boolean;
  enableBrowser?: boolean;
  enableCodeInterpreter?: boolean;
  planeUrl?: string;
  planePublicUrl?: string;
  planeToken?: string;
  modelId?: string;
  owner?: string;
  partyId?: string;
  rootRunId?: string;
  attempt?: number;
  repo?: string;
  memoryArn?: string;
  memoryNamespace?: string;
  awsSkillPaths?: string[];
  maxIterations?: number;
  maxTokens?: number;
  timeoutSeconds?: number;
  allowedTools?: string[];
  skills?: SkillRef[];
  mcpServers?: McpRef[];
};

export function envFromProcess(env: NodeJS.ProcessEnv = process.env): AgentcoreInvokeEnv {
  let modelId: string | undefined;
  const raw = env.METAPROMPT_RESOLVED_MODEL;
  if (raw?.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as { provider?: string; vendorId?: string };
      if (parsed.provider === "bedrock" && parsed.vendorId) modelId = parsed.vendorId;
    } catch {
      /* ignore */
    }
  }
  return {
    runId: env.METAPROMPT_RUN_ID ?? "unknown",
    prompt: env.METAPROMPT_PROMPT ?? "",
    region: env.AWS_REGION ?? "us-east-1",
    harnessArn: emptyToUndef(env.METAPROMPT_AGENTCORE_HARNESS_ARN),
    runtimeArn: emptyToUndef(env.METAPROMPT_AGENTCORE_RUNTIME_ARN),
    qualifier: emptyToUndef(env.METAPROMPT_AGENTCORE_QUALIFIER),
    gatewayArn: emptyToUndef(env.METAPROMPT_AGENTCORE_GATEWAY_ARN),
    attachPlaneMcp: env.METAPROMPT_AGENTCORE_ATTACH_PLANE !== "0",
    enableBrowser: env.METAPROMPT_AGENTCORE_BROWSER === "1",
    enableCodeInterpreter: env.METAPROMPT_AGENTCORE_CODE === "1",
    planeUrl: env.METAPROMPT_PLANE_URL,
    planePublicUrl: emptyToUndef(env.METAPROMPT_PLANE_EXTERNAL_URL) ?? env.METAPROMPT_PLANE_URL,
    planeToken: env.METAPROMPT_RUN_TOKEN,
    modelId,
    owner: env.METAPROMPT_OWNER,
    partyId: emptyToUndef(env.METAPROMPT_PARTY_ID),
    rootRunId: emptyToUndef(env.METAPROMPT_ROOT_RUN_ID),
    attempt: env.METAPROMPT_ATTEMPT ? Number(env.METAPROMPT_ATTEMPT) : undefined,
    repo: emptyToUndef(env.METAPROMPT_REPO),
    memoryArn: emptyToUndef(env.METAPROMPT_AGENTCORE_MEMORY_ARN),
    memoryNamespace: emptyToUndef(env.METAPROMPT_AGENTCORE_MEMORY_NS),
    awsSkillPaths: parseJsonArray(env.METAPROMPT_AGENTCORE_AWS_SKILLS),
    maxIterations: positiveInt(env.METAPROMPT_AGENTCORE_MAX_ITER),
    maxTokens: positiveInt(env.METAPROMPT_AGENTCORE_MAX_TOKENS),
    timeoutSeconds: positiveInt(env.METAPROMPT_AGENTCORE_TIMEOUT),
    allowedTools: parseJsonArray(env.METAPROMPT_AGENTCORE_ALLOWED_TOOLS),
    skills: parseJson<SkillRef[]>(env.METAPROMPT_SKILLS, []),
    mcpServers: parseJson<McpRef[]>(env.METAPROMPT_MCPS, []),
  };
}

function emptyToUndef(value: string | undefined): string | undefined {
  return value ? value : undefined;
}

function positiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function parseJsonArray(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : undefined;
  } catch {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
}

export function agentcoreEndpoint(region: string): string {
  return `https://bedrock-agentcore.${region}.amazonaws.com`;
}

export function harnessInvokeUrl(input: Pick<AgentcoreInvokeEnv, "region" | "harnessArn" | "qualifier">): URL {
  if (!input.harnessArn) throw new Error("METAPROMPT_AGENTCORE_HARNESS_ARN is required for harness mode");
  const url = new URL(`${agentcoreEndpoint(input.region)}/harnesses/invoke`);
  url.searchParams.set("harnessArn", input.harnessArn);
  if (input.qualifier) url.searchParams.set("qualifier", input.qualifier);
  return url;
}

export function runtimeInvokeUrl(input: Pick<AgentcoreInvokeEnv, "region" | "runtimeArn" | "qualifier">): URL {
  if (!input.runtimeArn) throw new Error("METAPROMPT_AGENTCORE_RUNTIME_ARN is required for runtime mode");
  const url = new URL(
    `${agentcoreEndpoint(input.region)}/runtimes/${encodeURIComponent(input.runtimeArn)}/invocations`,
  );
  if (input.qualifier) url.searchParams.set("qualifier", input.qualifier);
  return url;
}

export function memoryEventUrl(region: string, memoryId: string): URL {
  return new URL(`${agentcoreEndpoint(region)}/memories/${encodeURIComponent(memoryId)}/events`);
}

export function memoryRetrieveUrl(region: string, memoryId: string): URL {
  return new URL(`${agentcoreEndpoint(region)}/memories/${encodeURIComponent(memoryId)}/retrieve`);
}

function invokeHeaders(input: AgentcoreInvokeEnv, sessionId: string): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json",
    "x-amzn-bedrock-agentcore-runtime-session-id": sessionId,
    ...(input.owner ? { "x-amzn-bedrock-agentcore-runtime-user-id": input.owner } : {}),
    baggage: agentcoreBaggage({
      runId: input.runId,
      partyId: input.partyId,
      rootRunId: input.rootRunId,
      attempt: input.attempt,
    }),
    traceparent: traceparent(),
  };
}

function traceparent(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `00-${hex.slice(0, 32)}-${hex.slice(32, 48)}-01`;
}

export async function invokeAgentcore(
  input: AgentcoreInvokeEnv,
  deps: {
    fetchImpl?: typeof fetch;
    credentials?: AwsCredentials;
    onText?: (chunk: string) => void;
  } = {},
): Promise<AgentcoreInvokeResult> {
  if (!input.prompt) throw new Error("prompt is required");
  const fetchImpl = deps.fetchImpl ?? fetch;
  const credentials = deps.credentials ?? (await loadAwsCredentials());
  const sessionId = agentcoreSessionId(input.runId);
  const actorId = agentcoreActorId(input.owner ?? "user");
  const memoryHits = input.memoryArn
    ? await retrieveMemory(input, actorId, credentials, fetchImpl).catch(() => [] as string[])
    : [];
  if (input.harnessArn) {
    const url = harnessInvokeUrl(input);
    const body = JSON.stringify(
      invokeHarnessBody({
        prompt: input.prompt,
        planeUrl: input.planePublicUrl ?? input.planeUrl,
        planeToken: input.planeToken,
        modelId: input.modelId,
        gatewayArn: input.gatewayArn,
        attachPlaneMcp: input.attachPlaneMcp,
        enableBrowser: input.enableBrowser,
        enableCodeInterpreter: input.enableCodeInterpreter,
        actorId,
        systemTexts: [DEFAULT_SYSTEM_TEXT, ...inlineSkillTexts(input.skills ?? []), ...memoryHits],
        skills: skillRefsToHarnessSkills(input.skills ?? [], input.awsSkillPaths),
        mcpServers: await mintCatalogMcpAuth(catalogMcpsForAgentcore(input.mcpServers ?? []), input, fetchImpl),
        maxIterations: input.maxIterations,
        maxTokens: input.maxTokens,
        timeoutSeconds: input.timeoutSeconds,
        allowedTools: input.allowedTools,
      }),
    );
    const headers = signAwsRequest({
      method: "POST",
      url,
      region: input.region,
      service: "bedrock-agentcore",
      credentials,
      headers: invokeHeaders(input, sessionId),
      body,
    });
    const res = await fetchImpl(url, { method: "POST", headers, body });
    const text = await res.text();
    if (!res.ok) throw new Error(`InvokeHarness failed (${res.status}): ${text.slice(0, 500)}`);
    return finishInvoke(text, sessionId, actorId, deps.onText);
  }
  if (input.runtimeArn) {
    const url = runtimeInvokeUrl(input);
    const body = JSON.stringify({
      prompt: input.prompt,
      system: [DEFAULT_SYSTEM_TEXT, AGENTCORE_SYSTEM_TEXT].join("\n"),
      actorId,
    });
    const headers = signAwsRequest({
      method: "POST",
      url,
      region: input.region,
      service: "bedrock-agentcore",
      credentials,
      headers: invokeHeaders(input, sessionId),
      body,
    });
    const res = await fetchImpl(url, { method: "POST", headers, body });
    const text = await res.text();
    if (!res.ok) throw new Error(`InvokeAgentRuntime failed (${res.status}): ${text.slice(0, 500)}`);
    return finishInvoke(text, sessionId, actorId, deps.onText);
  }
  throw new Error("AgentCore harnessArn or runtimeArn is required");
}

function finishInvoke(
  raw: string,
  sessionId: string,
  actorId: string,
  onText?: (chunk: string) => void,
): AgentcoreInvokeResult {
  const events = parseAgentcoreStream(raw);
  const text = extractHarnessText(events.length ? events : raw) || raw.trim();
  if (text) onText?.(text);
  return { text, usage: extractHarnessUsage(events), sessionId, actorId };
}

export async function retrieveMemory(
  input: Pick<AgentcoreInvokeEnv, "region" | "memoryArn" | "memoryNamespace" | "prompt">,
  actorId: string,
  credentials: AwsCredentials,
  fetchImpl: typeof fetch,
): Promise<string[]> {
  if (!input.memoryArn) return [];
  const memoryId = memoryIdFromArn(input.memoryArn);
  const url = memoryRetrieveUrl(input.region, memoryId);
  const body = JSON.stringify({
    namespace: agentcoreMemoryNamespace(actorId, input.memoryNamespace),
    searchCriteria: { searchQuery: input.prompt.slice(0, 1024), topK: 5 },
  });
  const headers = signAwsRequest({
    method: "POST",
    url,
    region: input.region,
    service: "bedrock-agentcore",
    credentials,
    headers: { "content-type": "application/json", accept: "application/json" },
    body,
  });
  const res = await fetchImpl(url, { method: "POST", headers, body });
  if (!res.ok) return [];
  const payload = (await res.json()) as {
    memoryRecordSummaries?: Array<{ content?: { text?: string } | string }>;
  };
  const hits = (payload.memoryRecordSummaries ?? [])
    .map((row) => (typeof row.content === "string" ? row.content : row.content?.text ?? ""))
    .filter(Boolean)
    .slice(0, 5);
  return hits.length ? [`AgentCore memory:\n${hits.join("\n")}`] : [];
}

export async function createMemoryEvent(
  input: Pick<AgentcoreInvokeEnv, "region" | "memoryArn" | "runId" | "partyId" | "prompt">,
  result: AgentcoreInvokeResult,
  credentials: AwsCredentials,
  fetchImpl: typeof fetch,
): Promise<void> {
  if (!input.memoryArn) return;
  const memoryId = memoryIdFromArn(input.memoryArn);
  const url = memoryEventUrl(input.region, memoryId);
  const body = JSON.stringify({
    actorId: result.actorId,
    sessionId: result.sessionId,
    eventTimestamp: Math.floor(Date.now() / 1000),
    payload: [
      { conversational: { content: { text: input.prompt.slice(0, 8000) }, role: "USER" } },
      { conversational: { content: { text: result.text.slice(0, 8000) }, role: "ASSISTANT" } },
    ],
    metadata: {
      "metaprompt.run": { stringValue: input.runId },
      ...(input.partyId ? { "metaprompt.party": { stringValue: input.partyId } } : {}),
    },
  });
  const headers = signAwsRequest({
    method: "POST",
    url,
    region: input.region,
    service: "bedrock-agentcore",
    credentials,
    headers: { "content-type": "application/json", accept: "application/json" },
    body,
  });
  const res = await fetchImpl(url, { method: "POST", headers, body });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CreateEvent failed (${res.status}): ${text.slice(0, 300)}`);
  }
}

export async function mintCatalogMcpAuth(
  mcps: Array<{ name: string; url: string; token?: string }>,
  input: Pick<AgentcoreInvokeEnv, "planeUrl" | "planeToken">,
  fetchImpl: typeof fetch = fetch,
): Promise<Array<{ name: string; url: string; token?: string }>> {
  if (!input.planeUrl || !input.planeToken || !mcps.length) return mcps;
  const out: Array<{ name: string; url: string; token?: string }> = [];
  for (const mcp of mcps) {
    try {
      const res = await fetchImpl(`${input.planeUrl.replace(/\/$/, "")}/mcp`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.planeToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "app.cred.mint", arguments: { name: mcp.name } },
        }),
      });
      if (!res.ok) {
        out.push(mcp);
        continue;
      }
      const json = (await res.json()) as { result?: { content?: { text?: string }[] } };
      const text = json.result?.content?.[0]?.text;
      const parsed = text ? (JSON.parse(text) as { token?: string }) : {};
      out.push(parsed.token ? { ...mcp, token: parsed.token } : mcp);
    } catch {
      out.push(mcp);
    }
  }
  return out;
}

export async function completePlaneRun(
  input: Pick<AgentcoreInvokeEnv, "runId" | "planeUrl" | "planeToken" | "prompt">,
  result: AgentcoreInvokeResult,
  status: "succeeded" | "failed",
  reason?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!input.planeUrl) return;
  const url = `${input.planeUrl.replace(/\/$/, "")}/internal/runs/${input.runId}/complete`;
  await fetchImpl(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.planeToken ?? ""}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      status,
      summary: (result.text || input.prompt || "agentcore").slice(0, 2000),
      reason,
      usage: result.usage,
    }),
  });
}

export async function putPartyMemory(
  input: Pick<AgentcoreInvokeEnv, "planeUrl" | "planeToken" | "partyId" | "runId">,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!input.planeUrl || !input.partyId || !text.trim()) return;
  const url = `${input.planeUrl.replace(/\/$/, "")}/mcp`;
  await fetchImpl(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.planeToken ?? ""}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "memory.put",
        arguments: {
          scope: "party",
          partyId: input.partyId,
          text: text.slice(0, 4000),
          metadata: { source: "agentcore", runId: input.runId },
        },
      },
    }),
  });
}

export async function appendPlaneLog(
  input: Pick<AgentcoreInvokeEnv, "runId" | "planeUrl" | "planeToken">,
  chunk: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!input.planeUrl || !chunk) return;
  await fetchImpl(`${input.planeUrl.replace(/\/$/, "")}/internal/runs/${input.runId}/logs`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.planeToken ?? ""}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ chunk, stream: "stdout" }),
  });
}

async function main() {
  const input = envFromProcess();
  const credentials = await loadAwsCredentials();
  try {
    const result = await invokeAgentcore(input, {
      credentials,
      onText: (chunk) => {
        process.stdout.write(chunk.endsWith("\n") ? chunk : `${chunk}\n`);
      },
    });
    await appendPlaneLog(input, result.text.slice(0, 8000)).catch(() => undefined);
    await createMemoryEvent(input, result, credentials, fetch).catch((err) => {
      console.error(err instanceof Error ? err.message : err);
    });
    await putPartyMemory(input, result.text).catch(() => undefined);
    await completePlaneRun(input, result, "succeeded");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    await completePlaneRun(
      input,
      {
        text: "",
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        sessionId: agentcoreSessionId(input.runId),
        actorId: agentcoreActorId(input.owner ?? "user"),
      },
      "failed",
      message.slice(0, 500),
    ).catch(() => undefined);
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
