import { createHash } from "node:crypto";
import type { HarnessAdapter, McpRef, SkillRef } from "./types.js";

export const ALWAYS_ON_MCPS = ["plane", "party", "jj"] as const;

/** Optional laptop-only names (e.g. Clanker Cloud). Never inject into Job prefixes even if an operator adds them to their catalog. */
export const PARENT_ONLY_MCPS = ["clanker"] as const;

export const ALWAYS_ON_SCHEMAS: Record<(typeof ALWAYS_ON_MCPS)[number], string> = {
  plane: "control-plane MCP: harness, run, party, cron, repo, model, skill, mcp, jj, memory",
  party: "party/child MCP: instruction, job.run/spawn/wait/kill/logs/progress, self, coord",
  jj: "jj MCP: status/diff/log/new/describe/squash/rebase/bookmark, git.fetch, git.push",
};

export function catalogSkillNames(skills: SkillRef[]): string[] {
  return skills.filter((s) => !s.content && !s.url).map((s) => s.name).sort();
}

export function catalogMcpNames(mcps: McpRef[]): string[] {
  return mcps.filter((m) => !m.url).map((m) => m.name).sort();
}

export function cacheHintFor(skills: SkillRef[], mcps: McpRef[]): string | undefined {
  if (skills.some((s) => s.content)) return "inline-skill";
  if (mcps.some((m) => m.url)) return "inline-mcp";
  if (skills.some((s) => s.url)) return "url-skill";
  return undefined;
}

export function stablePrefixText(input: {
  harness: HarnessAdapter;
  skills: SkillRef[];
  mcpServers: McpRef[];
}): string {
  const skillNames = catalogSkillNames(input.skills);
  const mcpNames = catalogMcpNames(input.mcpServers);
  const alwaysOn = ALWAYS_ON_MCPS.slice()
    .sort()
    .map((name) => `${name}:${ALWAYS_ON_SCHEMAS[name]}`)
    .join("\n");
  return [
    input.harness.systemText,
    alwaysOn,
    `skills:${skillNames.join(",")}`,
    `mcps:${mcpNames.join(",")}`,
  ].join("\n---\n");
}

export function prefixHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export function computePrefixHash(input: {
  harness: HarnessAdapter;
  skills: SkillRef[];
  mcpServers: McpRef[];
}): string {
  return prefixHash(stablePrefixText(input));
}
