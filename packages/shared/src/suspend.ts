import type { PlaneLimits, Run, StorageKind } from "./types.js";

export type WaitDecision =
  | { action: "return"; reason: "already-terminal" }
  | { action: "grace"; ms: number }
  | { action: "suspend"; reason: "eager" | "timeout" }
  | { action: "storage-error"; message: string };

export function decideWait(input: {
  outstanding: Run[];
  timeoutSeconds?: number;
  storage: StorageKind;
  limits: PlaneLimits;
  elapsedMs?: number;
}): WaitDecision {
  if (input.outstanding.every((r) => ["succeeded", "failed", "cancelled"].includes(r.status))) {
    return { action: "return", reason: "already-terminal" };
  }
  const threshold = input.limits.suspendWaitSeconds;
  const eager =
    (input.timeoutSeconds !== undefined && input.timeoutSeconds > threshold) ||
    input.outstanding.some((r) => (r.activeDeadlineSeconds ?? 0) > threshold);
  if (eager || (input.elapsedMs !== undefined && input.elapsedMs >= threshold * 1000)) {
    if (input.storage === "tmpfs") {
      return {
        action: "storage-error",
        message: "tmpfs run cannot auto-suspend; pass storage: pvc",
      };
    }
    return { action: "suspend", reason: eager ? "eager" : "timeout" };
  }
  return { action: "grace", ms: threshold * 1000 - (input.elapsedMs ?? 0) };
}
