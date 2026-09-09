#!/usr/bin/env bun
/**
 * In-session launcher. Drops into a preconfigured harness TUI (opencode, cursor, …)
 * with plane MCP + model already set. Spawn children via job.spawn, never vendor Task.
 */
import { spawn } from "node:child_process";
import { defaultHarnesses } from "@metaprompt/shared";
import { interactiveFor } from "./adapters.js";

const ALIASES: Record<string, string> = {
  opencode: "opencode",
  oc: "opencode",
  cursor: "cursor",
  claude: "claude-code",
  "claude-code": "claude-code",
  codex: "codex",
  session: "session",
};

function help(): string {
  return `Metaprompt session — plane MCP and model are already configured.

  mp                 menu / default harness (${process.env.METAPROMPT_HARNESS ?? "session"})
  mp opencode        OpenCode TUI
  mp cursor          Cursor CLI
  mp claude          Claude Code TUI
  mp codex           Codex TUI
  mp shell           bash in /workspace

Spawn parallel work with job.spawn on the plane MCP. Do not use vendor Task/subagent tools.
`;
}

async function main() {
  const arg = process.argv[2] ?? "";
  if (arg === "help" || arg === "-h" || arg === "--help") {
    process.stdout.write(help());
    return;
  }
  if (arg === "shell" || arg === "bash") {
    const sh = spawn("/bin/bash", ["-l"], { cwd: process.env.METAPROMPT_WORKSPACE ?? "/workspace", stdio: "inherit" });
    sh.on("exit", (code) => process.exit(code ?? 0));
    return;
  }
  if (!arg) {
    const def = process.env.METAPROMPT_HARNESS ?? "session";
    if (def === "session") {
      process.stdout.write(help());
      return;
    }
    return launch(def);
  }
  const name = ALIASES[arg];
  if (!name) {
    process.stderr.write(`unknown harness ${arg}\n${help()}`);
    process.exit(2);
  }
  return launch(name);
}

function launch(name: string) {
  const harness = defaultHarnesses().find((h) => h.name === name);
  if (!harness) throw new Error(`unknown harness ${name}`);
  let resolvedModel: { id: string; provider: string; vendorId?: string } | undefined;
  const raw = process.env.METAPROMPT_MODEL;
  if (raw) {
    try {
      resolvedModel = raw.startsWith("{") ? JSON.parse(raw) : { id: raw, provider: "none" };
    } catch {
      resolvedModel = { id: raw, provider: "none" };
    }
  }
  const { argv, env } = interactiveFor(harness, {
    id: process.env.METAPROMPT_RUN_ID ?? "session",
    resolvedModel,
  });
  const child = spawn(argv[0]!, argv.slice(1), {
    cwd: process.env.METAPROMPT_WORKSPACE ?? "/workspace",
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  child.on("exit", (code) => process.exit(code ?? 1));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
