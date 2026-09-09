import type { Run, SummaryRollup, Usage } from "./types.js";

export function emptyUsage(prefixHash: string): Usage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    prefixHash,
  };
}

export function stubUsage(prefixHash: string): Usage {
  return {
    inputTokens: 120,
    outputTokens: 40,
    cacheReadTokens: 80,
    cacheWriteTokens: 20,
    prefixHash,
  };
}

export function truncate(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return text;
  return buf.subarray(0, Math.max(0, maxBytes - 15)).toString("utf8") + "…[truncated]";
}

export function combineSummaries(
  parentRunId: string,
  children: Run[],
  maxSummaryBytes: number,
  maxRollupBytes: number,
): SummaryRollup {
  const sorted = [...children].sort((a, b) => a.id.localeCompare(b.id));
  const rows = sorted.map((c) => ({
    runId: c.id,
    harness: c.harness,
    status: c.status,
    summary: c.summary ? truncate(c.summary, maxSummaryBytes) : undefined,
    usage: c.usage,
  }));
  const combined = truncate(
    rows
      .map((r) => `- ${r.harness} ${r.runId}: ${r.status}${r.summary ? ` — ${r.summary}` : ""}`)
      .join("\n"),
    maxRollupBytes,
  );
  return { parentRunId, children: rows, combined };
}

export function resumeSuffix(rollup: SummaryRollup): string {
  return `waitFor rollup (summaries only, not logs):\n${rollup.combined}`;
}
