import { spawn } from "node:child_process";
import { emptyGitCredentialHelperEnv } from "./workspace.js";

export async function runJj(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn("jj", args, { cwd, env: emptyGitCredentialHelperEnv(), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", () => resolve({ stdout: "", stderr: "jj not installed", code: 127 }));
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
  });
}

export async function mintAndGit(
  planeUrl: string,
  token: string,
  args: { repo: string; op: "fetch" | "push"; runId: string },
): Promise<{ token: string }> {
  const res = await fetch(`${planeUrl}/internal/vcs/cred/mint`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`mint failed: ${await res.text()}`);
  return res.json() as Promise<{ token: string }>;
}
