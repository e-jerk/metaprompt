#!/usr/bin/env bun
/**
 * Long-running root session: materialize plane MCP + skills, then stay up for kubectl exec.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { defaultHarnesses } from "@metaprompt/shared";
import { startChildMcp } from "./child-mcp.js";
import { materializePrefix } from "./prefix-files.js";
import { emptyGitCredentialHelperEnv, jjColocate, pinAndOverlay } from "./workspace.js";

async function main() {
  const cwd = process.env.METAPROMPT_WORKSPACE ?? "/workspace";
  const harnessName = process.env.METAPROMPT_HARNESS ?? "session";
  const harness = defaultHarnesses().find((h) => h.name === harnessName);
  if (!harness || harness.name === "stub") throw new Error(`session harness must be real, got ${harnessName}`);
  Object.assign(process.env, emptyGitCredentialHelperEnv());
  try {
    await pinAndOverlay({
      lowerdir: process.env.METAPROMPT_LOWERDIR ?? "/repos/current",
      upperdir: `${cwd}/upper`,
      workdir: `${cwd}/work`,
      merged: cwd,
    });
  } catch {
    await mkdir(cwd, { recursive: true });
  }
  try {
    await jjColocate(cwd);
  } catch {
    // jj optional if the image has no binary
  }
  const skills = JSON.parse(process.env.METAPROMPT_SKILLS ?? "[]");
  const mcpServers = JSON.parse(process.env.METAPROMPT_MCPS ?? "[]");
  const planeUrl = process.env.METAPROMPT_PLANE_URL ?? "http://metaprompt-mcp:3333";
  const childPort = Number(process.env.METAPROMPT_CHILD_MCP_PORT ?? 3334);
  await startChildMcp({
    port: childPort,
    planeUrl,
    token: process.env.METAPROMPT_RUN_TOKEN ?? "",
    cwd,
  });
  await materializePrefix({
    cwd,
    harness,
    skills,
    mcpServers,
    planeUrl,
    childMcpUrl: process.env.METAPROMPT_CHILD_MCP_URL ?? `http://127.0.0.1:${childPort}`,
    planeToken: process.env.METAPROMPT_RUN_TOKEN,
  });
  const mpDir = `${cwd}/.mp`;
  await mkdir(mpDir, { recursive: true });
  const attach = `#!/bin/sh
set -e
cd /workspace
export PATH="/workspace/.mp:/root/.local/bin:/usr/local/bin:/usr/local/bun-node-fallback-bin:/opt/homebrew/bin:$PATH"
if [ -n "$1" ]; then
  exec bun /app/packages/runner/src/mp.ts "$@"
fi
exec bun /app/packages/runner/src/mp.ts
`;
  await writeFile(`${mpDir}/attach`, attach, { mode: 0o755 });
  await writeFile(`${mpDir}/mp`, attach, { mode: 0o755 });
  const motd = `Metaprompt root session
  harness=${harness.name}  run=${process.env.METAPROMPT_RUN_ID ?? ""}  model=${process.env.METAPROMPT_MODEL ?? "none"}
  plane=${planeUrl}/mcp
  child MCP=http://127.0.0.1:${childPort}/mcp (party, jj)

  kubectl exec -it ${process.env.HOSTNAME ?? "pod"} -c harness -- /workspace/.mp/attach
  /workspace/.mp/attach opencode | cursor | claude | codex | shell

  Always-on MCP: plane, party, jj. Spawn children with job.spawn, never vendor Task/subagent.
`;
  await writeFile(`${cwd}/.mp/MOTD`, motd);
  await writeFile("/tmp/session-ready", "ok\n");
  console.log(motd);
  await new Promise(() => {
    /* stay up for kubectl exec */
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
