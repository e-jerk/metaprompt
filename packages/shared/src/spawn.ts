import type { SpawnAgent } from "./types.js";

export class SpawnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpawnError";
  }
}

export function validateSpawnGraph(agents: SpawnAgent[]): Map<string, SpawnAgent> {
  const keys = agents.map((a, i) => a.id ?? `agent_${i}`);
  const seen = new Set<string>();
  const byKey = new Map<string, SpawnAgent>();
  for (let i = 0; i < agents.length; i++) {
    const key = keys[i]!;
    if (seen.has(key)) throw new SpawnError(`duplicate spawn id: ${key}`);
    seen.add(key);
    byKey.set(key, { ...agents[i]!, id: key });
  }
  for (const agent of byKey.values()) {
    for (const pred of agent.after ?? []) {
      if (!byKey.has(pred)) throw new SpawnError(`unknown after id: ${pred}`);
    }
  }
  if (hasCycle(byKey)) throw new SpawnError("spawn after[] contains a cycle");
  return byKey;
}

function hasCycle(byKey: Map<string, SpawnAgent>): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visited.has(id)) return false;
    if (visiting.has(id)) return true;
    visiting.add(id);
    for (const pred of byKey.get(id)?.after ?? []) {
      if (visit(pred)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const id of byKey.keys()) {
    if (visit(id)) return true;
  }
  return false;
}

export function readySpawnKeys(
  byKey: Map<string, SpawnAgent>,
  terminalKeys: Set<string>,
): string[] {
  const ready: string[] = [];
  for (const [key, agent] of byKey) {
    const after = agent.after ?? [];
    if (after.length === 0 || after.every((p) => terminalKeys.has(p))) ready.push(key);
  }
  return ready;
}
