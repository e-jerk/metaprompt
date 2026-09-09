#!/usr/bin/env bun
import { defaultHarnesses } from "@metaprompt/shared";
import { commandFor } from "./adapters.js";
import { startChildMcp } from "./child-mcp.js";
import { materializePrefix } from "./prefix-files.js";
import { emptyGitCredentialHelperEnv, jjColocate, pinAndOverlay } from "./workspace.js";

async function main() {
  const cwd = process.env.METAPROMPT_WORKSPACE ?? "/workspace";
  const harnessName = process.env.METAPROMPT_HARNESS ?? "stub";
  const harness = defaultHarnesses().find((h) => h.name === harnessName);
  if (!harness) throw new Error(`unknown harness ${harnessName}`);
  const planeUrl = process.env.METAPROMPT_PLANE_URL ?? "http://metaprompt-mcp:3333";
  const childPort = Number(process.env.METAPROMPT_CHILD_MCP_PORT ?? 3334);
  await startChildMcp({
    port: childPort,
    planeUrl,
    token: process.env.METAPROMPT_RUN_TOKEN ?? "",
    cwd,
  });
  await pinAndOverlay({
    lowerdir: process.env.METAPROMPT_LOWERDIR ?? "/repos/current",
    upperdir: `${cwd}/upper`,
    workdir: `${cwd}/work`,
    merged: cwd,
  });
  await jjColocate(cwd);
  const skills = JSON.parse(process.env.METAPROMPT_SKILLS ?? "[]");
  const mcpServers = JSON.parse(process.env.METAPROMPT_MCPS ?? "[]");
  await materializePrefix({
    cwd,
    harness,
    skills,
    mcpServers,
    planeUrl,
    childMcpUrl: process.env.METAPROMPT_CHILD_MCP_URL ?? `http://127.0.0.1:${childPort}`,
    planeToken: process.env.METAPROMPT_RUN_TOKEN,
  });
  const resume = process.argv.includes("--resume");
  const rawModel = process.env.METAPROMPT_RESOLVED_MODEL || process.env.METAPROMPT_MODEL;
  let resolvedModel: { id: string; provider: string; vendorId?: string } | undefined;
  if (rawModel) {
    try {
      resolvedModel = rawModel.startsWith("{") ? JSON.parse(rawModel) : { id: rawModel, provider: "none" };
    } catch {
      resolvedModel = { id: rawModel, provider: "none" };
    }
  }
  const run = {
    id: process.env.METAPROMPT_RUN_ID ?? "unknown",
    prompt: process.env.METAPROMPT_PROMPT,
    resumeSuffix: process.env.METAPROMPT_RESUME_SUFFIX,
    resolvedModel,
  };
  const { argv, env } = commandFor(harness, run as never, resume);
  const { spawn } = await import("node:child_process");
  const childEnv = { ...emptyGitCredentialHelperEnv(), ...process.env, ...env, HOME: process.env.HOME ?? "/root" };
  const child =
    harness.name === "stub"
      ? spawn(process.execPath, [new URL("./stub.js", import.meta.url).pathname, ...argv.slice(1)], {
          cwd,
          env: childEnv,
          stdio: "inherit" as const,
        })
      : spawn(argv[0]!, argv.slice(1), { cwd, env: childEnv, stdio: "inherit" as const });
  child.on("exit", async (code) => {
    const status = code === 0 ? "succeeded" : "failed";
    try {
      await fetch(`${planeUrl.replace(/\/$/, "")}/internal/runs/${run.id}/complete`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${process.env.METAPROMPT_RUN_TOKEN ?? ""}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          status,
          summary: (process.env.METAPROMPT_PROMPT ?? harness.name).slice(0, 200),
          reason: code === 0 ? undefined : `exit ${code}`,
        }),
      });
    } catch (err) {
      console.error("complete failed", err);
    }
    process.exit(code ?? 1);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
