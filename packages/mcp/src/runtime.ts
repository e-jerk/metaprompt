import type { Run } from "@metaprompt/shared";
import type { MemoryStore } from "./store.js";

export type StartExtras = {
  runToken?: string;
  planeUrl?: string;
};

export interface Runtime {
  start(run: Run, extras?: StartExtras): Promise<{ jobName?: string; pvcName?: string }>;
  stop(run: Run): Promise<void>;
  deletePvc(name: string): Promise<void>;
}

export class LocalRuntime implements Runtime {
  constructor(private readonly store: MemoryStore) {}

  async start(run: Run, _extras?: StartExtras): Promise<{ jobName?: string; pvcName?: string }> {
    const jobName = `mp-${run.id}`;
    let pvcName: string | undefined;
    if (run.storage === "pvc") {
      pvcName = `mp-pvc-${run.id}`;
      this.store.pvcs.add(pvcName);
    }
    return { jobName, pvcName };
  }

  async stop(_run: Run): Promise<void> {}

  async deletePvc(name: string): Promise<void> {
    this.store.pvcs.delete(name);
  }
}
