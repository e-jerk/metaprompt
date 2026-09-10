import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { applyLocalCursorAuth } from "./cursor-auth.js";

describe("applyLocalCursorAuth", () => {
  it("keeps an existing CURSOR_API_KEY and does not read files", () => {
    const env = applyLocalCursorAuth({ CURSOR_API_KEY: "already", HOME: "/no/such/home" });
    expect(env.CURSOR_API_KEY).toBe("already");
    expect(env.AGENT_CLI_CREDENTIAL_STORE).toBe("file");
  });

  it("reads auth.json from a mounted HOME", async () => {
    const home = join(import.meta.dir, "..", "..", "..", "tmp", "cursor-auth-test");
    await mkdir(join(home, ".cursor"), { recursive: true });
    await writeFile(join(home, ".cursor", "auth.json"), JSON.stringify({ accessToken: "from-file" }), {
      mode: 0o600,
    });
    try {
      const env = applyLocalCursorAuth({ HOME: home });
      expect(env.CURSOR_API_KEY).toBe("from-file");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
