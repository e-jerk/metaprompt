import type { AssetMount, McpRef, SkillRef, StorageKind } from "./types.js";

export const HARNESS_JOB_GROUP = "metaprompt.io";
export const HARNESS_JOB_VERSION = "v1";
export const HARNESS_JOB_KIND = "HarnessJob";
export const HARNESS_JOB_PLURAL = "harnessjobs";
export const HARNESS_JOB_API_VERSION = `${HARNESS_JOB_GROUP}/${HARNESS_JOB_VERSION}`;

export type HarnessJobTokenRef = {
  name: string;
  key: string;
};

/** Launch document for one parent or child harness. The Kubernetes Job is projected from this. */
export type HarnessJobSpec = {
  runId: string;
  owner: string;
  harness: string;
  image: string;
  prompt?: string;
  repo?: string;
  sha?: string;
  generation?: string;
  model?: string;
  resolvedModel?: { id: string; provider: string; vendorId?: string };
  partyId: string;
  parentRunId?: string;
  rootRunId: string;
  createdByRunId?: string;
  depth: number;
  attempt: number;
  storage: StorageKind;
  skills: SkillRef[];
  mcpServers: McpRef[];
  assets: string[];
  spawnGroupId?: string;
  spawnKey?: string;
  cron?: string;
  prefixHash: string;
  cacheHint?: string;
  planeUrl: string;
  serviceAccountName: string;
  pullPolicy: string;
  storageClass?: string;
  pvcSize: string;
  activeDeadlineSeconds?: number;
  mode: "job" | "session";
  secretRefs?: string[];
  tokenSecretRef: HarnessJobTokenRef;
  assetMounts?: AssetMount[];
  gitSync?: { enabled: boolean; hostPath: string };
  lowerdir?: string;
  childMcpPort?: number;
  agentcore?: {
    region: string;
    harnessArn?: string;
    runtimeArn?: string;
    qualifier?: string;
    gatewayArn?: string;
    planeUrl?: string;
    memoryArn?: string;
    memoryNamespace?: string;
    sessionId?: string;
    actorId?: string;
    awsSkillPaths?: string[];
    maxIterations?: number;
    maxTokens?: number;
    timeoutSeconds?: number;
    allowedTools?: string[];
    attachPlaneMcp?: boolean;
    enableBrowser?: boolean;
    enableCodeInterpreter?: boolean;
  };
};

export type HarnessJobStatus = {
  phase?: "Pending" | "Running" | "Succeeded" | "Failed" | "Cancelled";
  jobName?: string;
  pvcName?: string;
  message?: string;
};

export type HarnessJob = {
  apiVersion: typeof HARNESS_JOB_API_VERSION;
  kind: typeof HARNESS_JOB_KIND;
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
    uid?: string;
  };
  spec: HarnessJobSpec;
  status?: HarnessJobStatus;
};
