import { describe, expect, it } from "bun:test";
import { CHILD_PROXY_TOOLS, handleChildCall, startChildMcp } from "./child-mcp.js";

async function rpc(url: string, method: string, params?: Record<string, unknown>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("child MCP", () => {
  it("listens on loopback and lists party plus local jj tools", async () => {
    const child = await startChildMcp({
      port: 0,
      planeUrl: "http://plane.invalid",
      token: "run-token",
      cwd: process.cwd(),
    });
    try {
      const health = await fetch(`http://127.0.0.1:${child.port}/healthz`);
      expect(await health.json()).toEqual({ ok: true, child: true });
      const listed = await rpc(`http://127.0.0.1:${child.port}/mcp`, "tools/list");
      const names = ((listed.body.result as { tools: { name: string }[] }).tools).map((t) => t.name);
      expect(names).toContain("party.get");
      expect(names).toContain("job.spawn");
      expect(names).toContain("jj.status");
      expect(names).toContain("jj.git.fetch");
      expect(names).toContain("gh.issue.create");
      expect(names).toContain("gh.pr.merge");
      expect(names).toContain("app.cred.mint");
      const jjOnly = await rpc(`http://127.0.0.1:${child.port}/jj`, "tools/list");
      const jjNames = ((jjOnly.body.result as { tools: { name: string }[] }).tools).map((t) => t.name);
      expect(jjNames.every((n) => n.startsWith("jj."))).toBe(true);
      expect(jjNames).not.toContain("party.get");
    } finally {
      child.stop();
    }
  });

  it("proxies plane tools and stubs local jj when the binary is missing", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const result = await handleChildCall(
      {
        planeUrl: "http://plane",
        token: "run-token",
        cwd: process.cwd(),
        fetchImpl: async (input, init) => {
          calls.push({
            url: String(input),
            body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
          });
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              result: { content: [{ type: "text", text: JSON.stringify({ ok: true, proxied: true }) }] },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
      },
      "party.get",
      { partyId: "pty_1" },
    );
    expect(result).toEqual({ ok: true, proxied: true });
    expect(calls[0]?.url).toBe("http://plane/mcp");
    expect(calls[0]?.body.params).toEqual({
      name: "party.get",
      arguments: { partyId: "pty_1" },
    });

    const jj = await handleChildCall(
      { planeUrl: "http://plane", token: "t", cwd: "/tmp" },
      "jj.status",
      {},
    );
    expect(jj).toEqual(expect.objectContaining({ tool: "jj.status" }));
    if ((jj as { skipped?: string }).skipped) {
      expect((jj as { skipped: string }).skipped).toMatch(/jj not installed/);
    }

    await expect(
      handleChildCall({ planeUrl: "http://plane", token: "t", cwd: "/tmp" }, "memory.put", { text: "nope" }),
    ).rejects.toThrow(/unknown child tool/);
    expect(CHILD_PROXY_TOOLS).not.toContain("memory.put");
  });
});
