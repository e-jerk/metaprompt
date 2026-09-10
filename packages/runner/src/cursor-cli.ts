#!/usr/bin/env bun
/**
 * Catalog entrypoint for the Cursor CLI. The installer binary is `agent`.
 */
import { spawn } from "node:child_process";
import { applyLocalCursorAuth } from "./cursor-auth.js";

const extra = process.argv.slice(2);
const child = spawn("agent", extra, {
  cwd: process.env.METAPROMPT_WORKSPACE ?? "/workspace",
  env: applyLocalCursorAuth({ ...process.env }),
  stdio: "inherit",
});
child.on("error", (err) => {
  console.error(`metaprompt-cursor: agent not on PATH (${(err as Error).message})`);
  process.exit(127);
});
child.on("exit", (code) => process.exit(code ?? 1));
