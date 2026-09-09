import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

export async function pinAndOverlay(input: {
  lowerdir: string;
  upperdir: string;
  workdir: string;
  merged: string;
}): Promise<void> {
  await mkdir(input.upperdir, { recursive: true });
  await mkdir(input.workdir, { recursive: true });
  await mkdir(input.merged, { recursive: true });
  await writeFile(
    join(input.merged, ".metaprompt-pin"),
    `lowerdir=${input.lowerdir}\n`,
  );
}

export function jjColocate(cwd: string): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("jj", ["git", "init", "--colocate"], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", () => resolve({ code: 127, stderr: "jj not installed" }));
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
  });
}

export function emptyGitCredentialHelperEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "true",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "credential.helper",
    GIT_CONFIG_VALUE_0: "",
  };
}
