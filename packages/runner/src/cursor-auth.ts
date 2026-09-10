import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function pickKey(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const rec = data as Record<string, unknown>;
  for (const key of ["apiKey", "CURSOR_API_KEY", "accessToken", "token"]) {
    const value = rec[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

/** Load a laptop-mounted Cursor login into env. Never logs the value. */
export function applyLocalCursorAuth(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (env.CURSOR_API_KEY) {
    env.AGENT_CLI_CREDENTIAL_STORE = env.AGENT_CLI_CREDENTIAL_STORE ?? "file";
    return env;
  }
  const home = env.HOME || homedir() || "/root";
  const files = [
    join(home, ".cursor", "api-key"),
    join(home, ".config", "cursor", "api-key"),
    join(home, ".cursor", "auth.json"),
    join(home, ".config", "cursor", "auth.json"),
    join(home, ".cursor", "sdk", "auth.json"),
  ];
  for (const path of files) {
    try {
      const raw = readFileSync(path, "utf8").trim();
      if (!raw) continue;
      if (path.endsWith("api-key")) {
        env.CURSOR_API_KEY = raw.split(/\r?\n/, 1)[0] ?? "";
        if (env.CURSOR_API_KEY) break;
        continue;
      }
      const key = pickKey(JSON.parse(raw));
      if (key) {
        env.CURSOR_API_KEY = key;
        break;
      }
    } catch {
      // missing or unreadable
    }
  }
  env.AGENT_CLI_CREDENTIAL_STORE = env.AGENT_CLI_CREDENTIAL_STORE ?? "file";
  return env;
}
