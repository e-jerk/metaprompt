import type { AgentcoreConfig } from "./types.js";

export const AGENTCORE_SYSTEM_TEXT =
  "You are a Metaprompt harness running on Amazon Bedrock AgentCore. Spawn children only via the plane MCP (job.spawn). Browser and Code Interpreter are tools, not Metaprompt Jobs.";

export const AGENTCORE_GATEWAY_NAME = "agentcore-gateway";

export function defaultAgentcore(region = "us-east-1"): AgentcoreConfig {
  return {
    enabled: false,
    region,
    attachPlaneMcp: true,
    enableBrowser: false,
    enableCodeInterpreter: false,
    gatewayName: AGENTCORE_GATEWAY_NAME,
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

export type AgentcoreInvokeInput = {
  prompt: string;
  planeUrl?: string;
  planeToken?: string;
  modelId?: string;
  gatewayArn?: string;
  attachPlaneMcp?: boolean;
  enableBrowser?: boolean;
  enableCodeInterpreter?: boolean;
};

export function invokeHarnessBody(input: AgentcoreInvokeInput): Record<string, unknown> {
  const tools: Record<string, unknown>[] = [];
  if (input.attachPlaneMcp !== false && input.planeUrl) {
    const url = `${input.planeUrl.replace(/\/$/, "")}/mcp`;
    tools.push({
      type: "remote_mcp",
      name: "plane",
      config: {
        remoteMcp: {
          url,
          ...(input.planeToken ? { headers: { Authorization: `Bearer ${input.planeToken}` } } : {}),
        },
      },
    });
  }
  if (input.gatewayArn) {
    tools.push({
      type: "agentcore_gateway",
      name: "gateway",
      config: { agentCoreGateway: { gatewayArn: input.gatewayArn } },
    });
  }
  if (input.enableBrowser) {
    tools.push({ type: "agentcore_browser", name: "browser" });
  }
  if (input.enableCodeInterpreter) {
    tools.push({ type: "agentcore_code_interpreter", name: "code" });
  }
  const body: Record<string, unknown> = {
    messages: [{ role: "user", content: [{ text: input.prompt }] }],
    systemPrompt: [{ text: AGENTCORE_SYSTEM_TEXT }],
  };
  if (input.modelId) {
    body.model = { bedrockModelConfig: { modelId: input.modelId } };
  }
  if (tools.length) body.tools = tools;
  return body;
}

export function extractHarnessText(payload: unknown): string {
  const chunks: string[] = [];
  collectText(payload, chunks);
  return chunks.join("");
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
