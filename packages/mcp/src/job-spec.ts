import {
  HARNESS_JOB_API_VERSION,
  HARNESS_JOB_KIND,
  type AssetMount,
  type AssetSpec,
  type HarnessJob,
  type HarnessJobSpec,
  type PlaneConfig,
  type Run,
} from "@metaprompt/shared";
import type { StartExtras } from "./runtime.js";

export const TOKEN_SECRET_KEY = "run-token";

export function sanitizeLabel(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 63);
}

export function dnsName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 63);
}

export function harnessJobName(runId: string): string {
  return dnsName(`mp-${runId}`);
}

export function pvcNameFor(runId: string): string {
  return dnsName(`mp-pvc-${runId}`);
}

export function tokenSecretName(runId: string): string {
  return dnsName(`mp-token-${runId}`);
}

export function runLabels(run: Pick<Run, "id" | "owner" | "harness" | "rootRunId" | "parentRunId" | "cron" | "depth">): Record<string, string> {
  return {
    "app.kubernetes.io/part-of": "metaprompt",
    "app.kubernetes.io/managed-by": "metaprompt-harnessjob",
    "metaprompt/run": run.id,
    "metaprompt/owner": sanitizeLabel(run.owner),
    "metaprompt/harness": run.harness,
    "metaprompt/root": run.rootRunId,
    ...(run.parentRunId ? { "metaprompt/parent": run.parentRunId } : {}),
    ...(run.cron ? { "metaprompt/cron": sanitizeLabel(run.cron) } : {}),
    "metaprompt/depth": String(run.depth),
  };
}

export function specFromRun(run: Run, config: PlaneConfig, extras?: StartExtras): HarnessJobSpec {
  const harness = config.harnesses.find((h) => h.name === run.harness);
  return {
    runId: run.id,
    owner: run.owner,
    harness: run.harness,
    image: harness?.image ?? `ghcr.io/e-jerk/metaprompt/${run.harness}:latest`,
    prompt: run.prompt ?? run.instruction,
    repo: run.repo,
    sha: run.sha,
    generation: run.generation,
    model: run.resolvedModel?.id ?? run.model,
    resolvedModel: run.resolvedModel,
    partyId: run.partyId,
    parentRunId: run.parentRunId,
    rootRunId: run.rootRunId,
    createdByRunId: run.createdByRunId,
    depth: run.depth,
    attempt: run.attempt,
    storage: run.storage,
    skills: run.skills,
    mcpServers: run.mcpServers,
    assets: run.assets,
    spawnGroupId: run.spawnGroupId,
    spawnKey: run.spawnKey,
    cron: run.cron,
    prefixHash: run.prefixHash,
    cacheHint: run.cacheHint,
    planeUrl: extras?.planeUrl ?? process.env.METAPROMPT_PLANE_URL ?? "http://metaprompt-mcp:3333",
    serviceAccountName: process.env.METAPROMPT_JOB_SA ?? "metaprompt-job",
    pullPolicy: process.env.METAPROMPT_JOB_PULL_POLICY || "IfNotPresent",
    storageClass: process.env.METAPROMPT_STORAGE_CLASS || undefined,
    pvcSize: process.env.METAPROMPT_PVC_SIZE ?? "2Gi",
    activeDeadlineSeconds: run.activeDeadlineSeconds,
    mode: run.kind === "session" ? "session" : "job",
    secretRefs: harness?.secrets,
    tokenSecretRef: { name: tokenSecretName(run.id), key: TOKEN_SECRET_KEY },
    assetMounts: resolveAssetMounts(run.assets, config.assets),
    gitSync: {
      enabled: Boolean(config.gitSync?.enabled || process.env.METAPROMPT_GITSYNC === "1"),
      hostPath: process.env.METAPROMPT_GITSYNC_HOSTPATH ?? config.gitSync?.hostPath ?? "/var/lib/metaprompt/repos",
    },
    localAuthMounts: (config.localAuth?.mounts ?? [])
      .filter((m) => m.harnesses.includes(run.harness) || m.harnesses.includes("*"))
      .map((m) => ({
        name: m.name,
        hostPath: m.hostPath,
        mountPath: m.mountPath,
        readOnly: m.readOnly !== false,
      })),
    lowerdir: run.repo ? `/repos/${run.repo}/current` : "/repos/current",
    childMcpPort: Number(process.env.METAPROMPT_CHILD_MCP_PORT ?? 3334),
    ...(run.harness === "agentcore"
      ? {
          agentcore: {
            region: config.agentcore.region,
            harnessArn: config.agentcore.harnessArn,
            runtimeArn: config.agentcore.runtimeArn,
            qualifier: config.agentcore.qualifier,
            gatewayArn: config.agentcore.gatewayArn,
            planeUrl:
              config.agentcore.planeExternalUrl ||
              process.env.METAPROMPT_PLANE_EXTERNAL_URL ||
              extras?.planeUrl ||
              process.env.METAPROMPT_PLANE_URL ||
              "http://metaprompt-mcp:3333",
            memoryArn: config.agentcore.memoryArn,
            memoryNamespace: config.agentcore.memoryNamespace,
            sessionId: run.agentcore?.sessionId,
            actorId: run.agentcore?.actorId,
            awsSkillPaths: config.agentcore.awsSkillPaths,
            maxIterations: config.agentcore.maxIterations,
            maxTokens: config.agentcore.maxTokens,
            timeoutSeconds: config.agentcore.timeoutSeconds,
            allowedTools: config.agentcore.allowedTools,
            attachPlaneMcp: config.agentcore.attachPlaneMcp,
            enableBrowser: config.agentcore.enableBrowser,
            enableCodeInterpreter: config.agentcore.enableCodeInterpreter,
          },
        }
      : {}),
  };
}

export type ParsedVolume =
  | { type: "pvc"; name: string }
  | { type: "hostPath"; path: string }
  | { type: "configMap"; name: string }
  | { type: "secret"; name: string }
  | { type: "emptyDir"; medium?: "Memory" };

export function parseAssetVolume(volume: string): ParsedVolume {
  const [kind, ...rest] = volume.split(":");
  const value = rest.join(":");
  if (kind === "pvc" && value) return { type: "pvc", name: value };
  if (kind === "hostPath" && value) return { type: "hostPath", path: value };
  if ((kind === "configMap" || kind === "configmap") && value) return { type: "configMap", name: value };
  if (kind === "secret" && value) return { type: "secret", name: value };
  if (kind === "emptyDir") return { type: "emptyDir", medium: value === "Memory" ? "Memory" : undefined };
  throw new Error(`unsupported asset volume: ${volume}`);
}

export function resolveAssetMounts(names: string[], catalog: AssetSpec[]): AssetMount[] {
  const out: AssetMount[] = [];
  for (const name of names) {
    const spec = catalog.find((a) => a.name === name);
    if (!spec) continue;
    out.push({ name: spec.name, volume: spec.volume, mountPath: spec.mountPath, readOnly: true });
  }
  return out;
}

export function envFromSpec(spec: HarnessJobSpec): Record<string, { value?: string; secret?: { name: string; key: string } }> {
  const str = (value: string | undefined) => value ?? "";
  return {
    METAPROMPT_RUN_ID: { value: spec.runId },
    METAPROMPT_RUN_TOKEN: { secret: spec.tokenSecretRef },
    METAPROMPT_PLANE_URL: { value: spec.planeUrl },
    METAPROMPT_HARNESS: { value: spec.harness },
    METAPROMPT_STORAGE: { value: spec.storage },
    METAPROMPT_PROMPT: { value: str(spec.prompt) },
    METAPROMPT_OWNER: { value: spec.owner },
    METAPROMPT_PARTY_ID: { value: spec.partyId },
    METAPROMPT_PARENT_RUN_ID: { value: str(spec.parentRunId) },
    METAPROMPT_ROOT_RUN_ID: { value: spec.rootRunId },
    METAPROMPT_CREATED_BY_RUN_ID: { value: str(spec.createdByRunId) },
    METAPROMPT_REPO: { value: str(spec.repo) },
    METAPROMPT_SHA: { value: str(spec.sha) },
    METAPROMPT_GENERATION: { value: str(spec.generation) },
    METAPROMPT_MODEL: { value: str(spec.model) },
    METAPROMPT_RESOLVED_MODEL: { value: spec.resolvedModel ? JSON.stringify(spec.resolvedModel) : "" },
    METAPROMPT_SPAWN_KEY: { value: str(spec.spawnKey) },
    METAPROMPT_SPAWN_GROUP: { value: str(spec.spawnGroupId) },
    METAPROMPT_DEPTH: { value: String(spec.depth) },
    METAPROMPT_ATTEMPT: { value: String(spec.attempt) },
    METAPROMPT_PREFIX_HASH: { value: spec.prefixHash },
    METAPROMPT_CACHE_HINT: { value: str(spec.cacheHint) },
    METAPROMPT_CRON: { value: str(spec.cron) },
    METAPROMPT_ASSETS: { value: JSON.stringify(spec.assets) },
    METAPROMPT_SKILLS: { value: JSON.stringify(spec.skills) },
    METAPROMPT_MCPS: { value: JSON.stringify(spec.mcpServers) },
    METAPROMPT_KIND: { value: spec.mode },
    METAPROMPT_LOWERDIR: { value: spec.lowerdir ?? "/repos/current" },
    METAPROMPT_CHILD_MCP_URL: { value: `http://127.0.0.1:${spec.childMcpPort ?? 3334}` },
    METAPROMPT_CHILD_MCP_PORT: { value: String(spec.childMcpPort ?? 3334) },
    ...(spec.localAuthMounts?.some((m) => m.mountPath.includes("cursor") || m.name.includes("cursor"))
      ? { AGENT_CLI_CREDENTIAL_STORE: { value: "file" } }
      : {}),
    ...(spec.agentcore
      ? {
          AWS_REGION: { value: spec.agentcore.region },
          METAPROMPT_AGENTCORE: { value: "1" },
          METAPROMPT_AGENTCORE_HARNESS_ARN: { value: str(spec.agentcore.harnessArn) },
          METAPROMPT_AGENTCORE_RUNTIME_ARN: { value: str(spec.agentcore.runtimeArn) },
          METAPROMPT_AGENTCORE_QUALIFIER: { value: str(spec.agentcore.qualifier) },
          METAPROMPT_AGENTCORE_GATEWAY_ARN: { value: str(spec.agentcore.gatewayArn) },
          METAPROMPT_PLANE_EXTERNAL_URL: { value: str(spec.agentcore.planeUrl) },
          METAPROMPT_AGENTCORE_MEMORY_ARN: { value: str(spec.agentcore.memoryArn) },
          METAPROMPT_AGENTCORE_MEMORY_NS: { value: str(spec.agentcore.memoryNamespace) },
          METAPROMPT_AGENTCORE_AWS_SKILLS: { value: JSON.stringify(spec.agentcore.awsSkillPaths ?? []) },
          METAPROMPT_AGENTCORE_MAX_ITER: { value: spec.agentcore.maxIterations ? String(spec.agentcore.maxIterations) : "" },
          METAPROMPT_AGENTCORE_MAX_TOKENS: { value: spec.agentcore.maxTokens ? String(spec.agentcore.maxTokens) : "" },
          METAPROMPT_AGENTCORE_TIMEOUT: { value: spec.agentcore.timeoutSeconds ? String(spec.agentcore.timeoutSeconds) : "" },
          METAPROMPT_AGENTCORE_ALLOWED_TOOLS: { value: JSON.stringify(spec.agentcore.allowedTools ?? []) },
          METAPROMPT_AGENTCORE_ATTACH_PLANE: { value: spec.agentcore.attachPlaneMcp === false ? "0" : "1" },
          METAPROMPT_AGENTCORE_BROWSER: { value: spec.agentcore.enableBrowser ? "1" : "0" },
          METAPROMPT_AGENTCORE_CODE: { value: spec.agentcore.enableCodeInterpreter ? "1" : "0" },
        }
      : {}),
  };
}

export function k8sEnvFromSpec(spec: HarnessJobSpec): Array<Record<string, unknown>> {
  return Object.entries(envFromSpec(spec)).map(([name, src]) => {
    if (src.secret) {
      return {
        name,
        valueFrom: { secretKeyRef: { name: src.secret.name, key: src.secret.key } },
      };
    }
    return { name, value: src.value ?? "" };
  });
}

export function harnessJobManifest(run: Run, spec: HarnessJobSpec): HarnessJob {
  return {
    apiVersion: HARNESS_JOB_API_VERSION,
    kind: HARNESS_JOB_KIND,
    metadata: {
      name: harnessJobName(run.id),
      labels: runLabels(run),
    },
    spec,
  };
}

export function tokenSecretManifest(spec: HarnessJobSpec, token: string, ownerRef?: OwnerRef) {
  return {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: spec.tokenSecretRef.name,
      labels: {
        "app.kubernetes.io/part-of": "metaprompt",
        "metaprompt/run": spec.runId,
      },
      ...(ownerRef ? { ownerReferences: [ownerRef] } : {}),
    },
    type: "Opaque",
    stringData: { [spec.tokenSecretRef.key]: token },
  };
}

export type OwnerRef = {
  apiVersion: string;
  kind: string;
  name: string;
  uid: string;
  controller?: boolean;
  blockOwnerDeletion?: boolean;
};

export function pvcManifest(spec: HarnessJobSpec, ownerRef?: OwnerRef) {
  return {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      name: pvcNameFor(spec.runId),
      labels: {
        "app.kubernetes.io/part-of": "metaprompt",
        "app.kubernetes.io/managed-by": "metaprompt-harnessjob",
        "metaprompt/run": spec.runId,
        "metaprompt/owner": sanitizeLabel(spec.owner),
        "metaprompt/harness": spec.harness,
        "metaprompt/root": spec.rootRunId,
      },
      ...(ownerRef ? { ownerReferences: [ownerRef] } : {}),
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      ...(spec.storageClass ? { storageClassName: spec.storageClass } : {}),
      resources: { requests: { storage: spec.pvcSize } },
    },
  };
}

function workloadLabels(spec: HarnessJobSpec): Record<string, string> {
  return {
    "app.kubernetes.io/part-of": "metaprompt",
    "app.kubernetes.io/managed-by": "metaprompt-harnessjob",
    "metaprompt/run": spec.runId,
    "metaprompt/owner": sanitizeLabel(spec.owner),
    "metaprompt/harness": spec.harness,
    "metaprompt/root": spec.rootRunId,
    "metaprompt/kind": spec.mode,
    ...(spec.parentRunId ? { "metaprompt/parent": spec.parentRunId } : {}),
    ...(spec.cron ? { "metaprompt/cron": sanitizeLabel(spec.cron) } : {}),
    "metaprompt/depth": String(spec.depth),
  };
}

function k8sVolumeFromParsed(name: string, parsed: ParsedVolume): Record<string, unknown> {
  if (parsed.type === "pvc") return { name, persistentVolumeClaim: { claimName: parsed.name } };
  if (parsed.type === "hostPath") return { name, hostPath: { path: parsed.path, type: "DirectoryOrCreate" } };
  if (parsed.type === "configMap") return { name, configMap: { name: parsed.name } };
  if (parsed.type === "secret") return { name, secret: { secretName: parsed.name } };
  return { name, emptyDir: parsed.medium ? { medium: parsed.medium } : {} };
}

export function extraPodVolumes(spec: HarnessJobSpec): {
  volumeMounts: Record<string, unknown>[];
  volumes: Record<string, unknown>[];
} {
  const volumeMounts: Record<string, unknown>[] = [];
  const volumes: Record<string, unknown>[] = [];
  if (spec.gitSync?.enabled) {
    volumes.push({
      name: "repos",
      hostPath: { path: spec.gitSync.hostPath, type: "DirectoryOrCreate" },
    });
    volumeMounts.push({ name: "repos", mountPath: "/repos", readOnly: true });
  }
  if (spec.harness === "opencode" || spec.secretRefs?.includes("opencode")) {
    volumes.push({
      name: "opencode-auth",
      secret: { secretName: "metaprompt-opencode", optional: true },
    });
    volumeMounts.push({ name: "opencode-auth", mountPath: "/root/.local/share/opencode", readOnly: true });
  }
  for (const mount of spec.localAuthMounts ?? []) {
    const volName = dnsName(`auth-${mount.name}`);
    volumes.push({
      name: volName,
      hostPath: { path: mount.hostPath, type: "DirectoryOrCreate" },
    });
    volumeMounts.push({
      name: volName,
      mountPath: mount.mountPath,
      readOnly: mount.readOnly !== false,
    });
  }
  for (const asset of spec.assetMounts ?? []) {
    const volName = dnsName(`asset-${asset.name}`);
    volumes.push(k8sVolumeFromParsed(volName, parseAssetVolume(asset.volume)));
    volumeMounts.push({
      name: volName,
      mountPath: asset.mountPath,
      readOnly: asset.readOnly !== false,
    });
  }
  return { volumeMounts, volumes };
}

function workspaceVolume(spec: HarnessJobSpec) {
  const pvc = spec.storage === "pvc" ? pvcNameFor(spec.runId) : undefined;
  const extra = extraPodVolumes(spec);
  return {
    volumeMounts: [{ name: "workspace", mountPath: "/workspace" }, ...extra.volumeMounts],
    volumes: [
      pvc
        ? { name: "workspace", persistentVolumeClaim: { claimName: pvc } }
        : { name: "workspace", emptyDir: { medium: "Memory" } },
      ...extra.volumes,
    ],
  };
}

function optionalSecretEnvFrom(spec: HarnessJobSpec) {
  return (spec.secretRefs ?? []).map((name) => ({
    secretRef: { name: `metaprompt-${name}`, optional: true },
  }));
}

export function jobManifest(spec: HarnessJobSpec, ownerRef?: OwnerRef) {
  const name = harnessJobName(spec.runId);
  const labels = workloadLabels(spec);
  const ws = workspaceVolume(spec);
  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name,
      labels,
      ...(ownerRef ? { ownerReferences: [ownerRef] } : {}),
    },
    spec: {
      backoffLimit: 0,
      ttlSecondsAfterFinished: 600,
      ...(spec.activeDeadlineSeconds ? { activeDeadlineSeconds: spec.activeDeadlineSeconds } : {}),
      template: {
        metadata: { labels },
        spec: {
          restartPolicy: "Never",
          serviceAccountName: spec.serviceAccountName,
          containers: [
            {
              name: "harness",
              image: spec.image,
              imagePullPolicy: spec.pullPolicy,
              env: k8sEnvFromSpec(spec),
              envFrom: optionalSecretEnvFrom(spec),
              volumeMounts: ws.volumeMounts,
            },
          ],
          volumes: ws.volumes,
        },
      },
    },
  };
}

/** Long-running exec target. Not a Job — stays Ready so you can kubectl exec a harness TUI. */
export function sessionPodManifest(spec: HarnessJobSpec, ownerRef?: OwnerRef) {
  const name = harnessJobName(spec.runId);
  const labels = { ...workloadLabels(spec), "metaprompt/session": "true" };
  const ws = workspaceVolume(spec);
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name,
      labels,
      ...(ownerRef ? { ownerReferences: [ownerRef] } : {}),
    },
    spec: {
      restartPolicy: "Always",
      serviceAccountName: spec.serviceAccountName,
      containers: [
        {
          name: "harness",
          image: spec.image,
          imagePullPolicy: spec.pullPolicy,
          command: ["bun", "/app/packages/runner/src/session.ts"],
          stdin: true,
          tty: true,
          env: k8sEnvFromSpec(spec),
          envFrom: optionalSecretEnvFrom(spec),
          volumeMounts: ws.volumeMounts,
          readinessProbe: {
            exec: { command: ["test", "-f", "/tmp/session-ready"] },
            initialDelaySeconds: 2,
            periodSeconds: 5,
          },
        },
      ],
      volumes: ws.volumes,
    },
  };
}

export function assertNoSecretsInSpec(spec: HarnessJobSpec): void {
  const blob = JSON.stringify(spec);
  if (/DATABASE_URL|run-token-secret|fake-pat|kubeconfig|BEGIN /i.test(blob)) {
    throw new Error("HarnessJob spec must not embed plane or VCS secrets");
  }
  if ("token" in spec || "runToken" in spec) {
    throw new Error("HarnessJob spec must not embed a run token");
  }
}
