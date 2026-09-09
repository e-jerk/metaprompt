#!/usr/bin/env bun
import { Plane } from "./plane.js";
import { K8sRuntime } from "./k8s.js";
import { openMemoryStore } from "./memory.js";
import { createApp, loadConfig } from "./server.js";

const config = loadConfig();
const inCluster = Boolean(process.env.KUBERNETES_SERVICE_HOST) || process.env.METAPROMPT_IN_CLUSTER === "1";
const memories = await openMemoryStore();
const plane = new Plane(config, inCluster ? new K8sRuntime(config) : undefined, memories);
const app = createApp(plane);
const port = Number(process.env.PORT ?? 3333);
app.listen(port, "0.0.0.0", () => {
  const backend = "embedder" in memories ? memories.embedder.provider : "hash";
  console.log(`metaprompt mcp listening on :${port} runtime=${inCluster ? "k8s" : "local"} memory=${process.env.DATABASE_URL ? "pgvector" : "in-memory"} embed=${backend}`);
});
