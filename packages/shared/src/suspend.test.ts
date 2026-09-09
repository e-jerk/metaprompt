import { describe, expect, it } from "bun:test";
import { DEFAULT_LIMITS } from "./catalog.js";
import { decideWait } from "./suspend.js";
import type { Run } from "./types.js";

const child = { status: "running", activeDeadlineSeconds: undefined } as Run;

describe("wait policy", () => {
  it("stays in grace under 60s", () => {
    const d = decideWait({
      outstanding: [child],
      storage: "pvc",
      limits: DEFAULT_LIMITS,
      elapsedMs: 1_000,
    });
    expect(d.action).toBe("grace");
  });

  it("eager-suspends when timeout or deadline exceeds 60s", () => {
    const d = decideWait({
      outstanding: [{ ...child, activeDeadlineSeconds: 120 } as Run],
      storage: "pvc",
      limits: DEFAULT_LIMITS,
    });
    expect(d).toEqual({ action: "suspend", reason: "eager" });
  });

  it("fails tmpfs instead of suspending", () => {
    const d = decideWait({
      outstanding: [child],
      storage: "tmpfs",
      limits: DEFAULT_LIMITS,
      timeoutSeconds: 120,
    });
    expect(d.action).toBe("storage-error");
  });
});
