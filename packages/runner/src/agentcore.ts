#!/usr/bin/env bun
import {
  AGENTCORE_SYSTEM_TEXT,
  agentcoreSessionId,
  extractHarnessText,
  invokeHarnessBody,
} from "@metaprompt/shared";
import { loadAwsCredentials, signAwsRequest } from "./aws-sigv4.js";

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
  planeToken?: string;
  modelId?: string;
  owner?: string;
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
    planeToken: env.METAPROMPT_RUN_TOKEN,
    modelId,
    owner: env.METAPROMPT_OWNER,
  };
}

function emptyToUndef(value: string | undefined): string | undefined {
  return value ? value : undefined;
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

export async function invokeAgentcore(
  input: AgentcoreInvokeEnv,
  deps: {
    fetchImpl?: typeof fetch;
    credentials?: Awaited<ReturnType<typeof loadAwsCredentials>>;
  } = {},
): Promise<string> {
  if (!input.prompt) throw new Error("prompt is required");
  const fetchImpl = deps.fetchImpl ?? fetch;
  const credentials = deps.credentials ?? (await loadAwsCredentials());
  const sessionId = agentcoreSessionId(input.runId);
  if (input.harnessArn) {
    const url = harnessInvokeUrl(input);
    const body = JSON.stringify(invokeHarnessBody({
      prompt: input.prompt,
      planeUrl: input.planeUrl,
      planeToken: input.planeToken,
      modelId: input.modelId,
      gatewayArn: input.gatewayArn,
      attachPlaneMcp: input.attachPlaneMcp,
      enableBrowser: input.enableBrowser,
      enableCodeInterpreter: input.enableCodeInterpreter,
    }));
    const headers = signAwsRequest({
      method: "POST",
      url,
      region: input.region,
      service: "bedrock-agentcore",
      credentials,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-amzn-bedrock-agentcore-runtime-session-id": sessionId,
        ...(input.owner ? { "x-amzn-bedrock-agentcore-runtime-user-id": input.owner } : {}),
      },
      body,
    });
    const res = await fetchImpl(url, { method: "POST", headers, body });
    const text = await res.text();
    if (!res.ok) throw new Error(`InvokeHarness failed (${res.status}): ${text.slice(0, 500)}`);
    return extractTextResponse(text) || text;
  }
  if (input.runtimeArn) {
    const url = runtimeInvokeUrl(input);
    const body = JSON.stringify({ prompt: input.prompt, system: AGENTCORE_SYSTEM_TEXT });
    const headers = signAwsRequest({
      method: "POST",
      url,
      region: input.region,
      service: "bedrock-agentcore",
      credentials,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-amzn-bedrock-agentcore-runtime-session-id": sessionId,
        ...(input.owner ? { "x-amzn-bedrock-agentcore-runtime-user-id": input.owner } : {}),
      },
      body,
    });
    const res = await fetchImpl(url, { method: "POST", headers, body });
    const text = await res.text();
    if (!res.ok) throw new Error(`InvokeAgentRuntime failed (${res.status}): ${text.slice(0, 500)}`);
    return extractTextResponse(text) || text;
  }
  throw new Error("AgentCore harnessArn or runtimeArn is required");
}

function extractTextResponse(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
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
    return extractHarnessText(parts);
  }
  try {
    return extractHarnessText(JSON.parse(trimmed));
  } catch {
    return trimmed;
  }
}

async function main() {
  const input = envFromProcess();
  const text = await invokeAgentcore(input);
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
