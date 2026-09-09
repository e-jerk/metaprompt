import * as k8s from "@kubernetes/client-node";
import {
  HARNESS_JOB_GROUP,
  HARNESS_JOB_KIND,
  HARNESS_JOB_PLURAL,
  HARNESS_JOB_VERSION,
  type PlaneConfig,
  type Run,
} from "@metaprompt/shared";
import {
  assertNoSecretsInSpec,
  harnessJobManifest,
  harnessJobName,
  jobManifest,
  pvcManifest,
  sessionPodManifest,
  specFromRun,
  tokenSecretManifest,
  type OwnerRef,
} from "./job-spec.js";
import type { Runtime, StartExtras } from "./runtime.js";

export class K8sRuntime implements Runtime {
  private readonly batch: k8s.BatchV1Api;
  private readonly core: k8s.CoreV1Api;
  private readonly custom: k8s.CustomObjectsApi;

  constructor(
    private readonly config: PlaneConfig,
    kc?: k8s.KubeConfig,
  ) {
    const kube = kc ?? new k8s.KubeConfig();
    kube.loadFromDefault();
    this.batch = kube.makeApiClient(k8s.BatchV1Api);
    this.core = kube.makeApiClient(k8s.CoreV1Api);
    this.custom = kube.makeApiClient(k8s.CustomObjectsApi);
  }

  async start(run: Run, extras?: StartExtras): Promise<{ jobName?: string; pvcName?: string }> {
    const ns = this.config.namespace;
    const spec = specFromRun(run, this.config, extras);
    assertNoSecretsInSpec(spec);
    const name = harnessJobName(run.id);
    const cr = harnessJobManifest(run, spec);
    cr.metadata.namespace = ns;

    let owner: OwnerRef | undefined;
    try {
      const created = (await this.custom.createNamespacedCustomObject({
        group: HARNESS_JOB_GROUP,
        version: HARNESS_JOB_VERSION,
        namespace: ns,
        plural: HARNESS_JOB_PLURAL,
        body: cr,
      })) as { metadata?: { uid?: string; name?: string } };
      if (created.metadata?.uid) {
        owner = {
          apiVersion: `${HARNESS_JOB_GROUP}/${HARNESS_JOB_VERSION}`,
          kind: HARNESS_JOB_KIND,
          name: created.metadata.name ?? name,
          uid: created.metadata.uid,
          controller: true,
        };
      }
    } catch (err) {
      if (!isConflict(err) && !isNotFound(err)) throw err;
    }

    try {
      await this.core.createNamespacedSecret({
        namespace: ns,
        body: tokenSecretManifest(spec, extras?.runToken ?? "", owner) as never,
      });
    } catch (err) {
      if (!isConflict(err)) throw err;
    }

    let pvcName: string | undefined;
    if (spec.storage === "pvc") {
      pvcName = pvcManifest(spec).metadata.name;
      try {
        await this.core.createNamespacedPersistentVolumeClaim({
          namespace: ns,
          body: pvcManifest(spec, owner) as never,
        });
      } catch (err) {
        if (!isConflict(err)) throw err;
      }
    }

    if (spec.mode === "session") {
      try {
        await this.core.createNamespacedPod({
          namespace: ns,
          body: sessionPodManifest(spec, owner) as never,
        });
      } catch (err) {
        if (!isConflict(err)) throw err;
      }
    } else {
      try {
        await this.batch.createNamespacedJob({
          namespace: ns,
          body: jobManifest(spec, owner) as never,
        });
      } catch (err) {
        if (!isConflict(err)) throw err;
      }
    }

    if (owner) {
      try {
        await this.custom.patchNamespacedCustomObjectStatus({
          group: HARNESS_JOB_GROUP,
          version: HARNESS_JOB_VERSION,
          namespace: ns,
          plural: HARNESS_JOB_PLURAL,
          name,
          body: {
            apiVersion: `${HARNESS_JOB_GROUP}/${HARNESS_JOB_VERSION}`,
            kind: HARNESS_JOB_KIND,
            metadata: { name },
            status: { phase: "Running", jobName: name, pvcName, message: spec.mode },
          },
        });
      } catch {
        // status is optional
      }
    }

    return { jobName: name, pvcName };
  }

  async stop(run: Run): Promise<void> {
    const ns = this.config.namespace;
    const name = run.jobName ?? harnessJobName(run.id);
    try {
      await this.custom.deleteNamespacedCustomObject({
        group: HARNESS_JOB_GROUP,
        version: HARNESS_JOB_VERSION,
        namespace: ns,
        plural: HARNESS_JOB_PLURAL,
        name,
        propagationPolicy: "Background",
      });
    } catch {
      // CRD missing or already gone
    }
    try {
      await this.batch.deleteNamespacedJob({
        namespace: ns,
        name,
        propagationPolicy: "Background",
      });
    } catch {
      // already gone
    }
    try {
      await this.core.deleteNamespacedPod({ namespace: ns, name, propagationPolicy: "Background" });
    } catch {
      // already gone
    }
  }

  async deletePvc(name: string): Promise<void> {
    try {
      await this.core.deleteNamespacedPersistentVolumeClaim({
        namespace: this.config.namespace,
        name,
      });
    } catch {
      // already gone
    }
  }
}

function isConflict(err: unknown): boolean {
  return statusOf(err) === 409;
}

function isNotFound(err: unknown): boolean {
  return statusOf(err) === 404;
}

function statusOf(err: unknown): number | undefined {
  const e = err as { statusCode?: number; code?: number; body?: { code?: number } };
  return e.statusCode ?? e.code ?? e.body?.code;
}
