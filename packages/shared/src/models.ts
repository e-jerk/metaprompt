import type { AgentcoreConfig, BedrockConfig, HarnessAdapter, ModelEntry } from "./types.js";

export class ModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelError";
  }
}

export function resolveModel(input: {
  harness: HarnessAdapter;
  requested?: string;
  models: ModelEntry[];
  defaultByHarness: Record<string, string>;
  bedrock: BedrockConfig;
  agentcore?: AgentcoreConfig;
}): { id: string; provider: string; vendorId?: string } | undefined {
  const id = input.requested ?? input.defaultByHarness[input.harness.name] ?? input.harness.defaultModel;
  if (!id || id === "none") return { id: "none", provider: "none" };
  const entry = input.models.find((m) => m.id === id);
  if (!entry) throw new ModelError(`unknown model: ${id}`);
  if (!entry.harnesses.includes(input.harness.name)) {
    throw new ModelError(`model ${id} is not allowed on harness ${input.harness.name}`);
  }
  if (entry.provider === "bedrock") {
    if (!input.bedrock.enabled) {
      throw new ModelError("Bedrock not configured");
    }
    return { id: entry.id, provider: "bedrock", vendorId: entry.bedrockId };
  }
  if (entry.provider === "agentcore") {
    if (!input.agentcore?.enabled) {
      throw new ModelError("AgentCore not configured");
    }
    return {
      id: entry.id,
      provider: "agentcore",
      vendorId: input.agentcore.harnessArn || input.agentcore.runtimeArn,
    };
  }
  if (entry.provider === "cursor") {
    return { id: entry.id, provider: "cursor", vendorId: entry.cursorModel };
  }
  if (entry.provider === "openai") {
    return { id: entry.id, provider: "openai", vendorId: entry.openaiModel };
  }
  if (entry.provider === "opencode") {
    return { id: entry.id, provider: "opencode", vendorId: entry.opencodeModel ?? `opencode/${entry.id}` };
  }
  return { id: entry.id, provider: entry.provider };
}

export function modelsForHarness(harness: string, models: ModelEntry[]): ModelEntry[] {
  return models.filter((m) => m.harnesses.includes(harness));
}
