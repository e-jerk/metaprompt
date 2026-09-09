/**
 * In-pod child MCP on :3334 — party/job/self/coord proxy to the plane, jj locally.
 * Bound to loopback. Jobs never get DATABASE_URL; they call the plane for memory.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { runJj } from "./jj-mcp.js";

export const CHILD_PROXY_TOOLS = [
  "party.get",
  "party.list",
  "party.add",
  "party.close",
  "coord.post",
  "coord.inbox",
  "coord.wait",
  "coord.signal",
  "coord.barrier",
  "coord.handoff",
  "coord.members",
  "coord.artifact.put",
  "coord.artifact.get",
  "job.run",
  "job.spawn",
  "job.wait",
  "job.kill",
  "job.logs",
  "job.progress",
  "self.suspend",
  "self.exit",
  "run.instruct",
  "jj.git.fetch",
  "jj.git.push",
  "vcs.cred.mint",
] as const;

export const JJ_LOCAL_TOOLS = [
  "jj.status",
  "jj.diff",
  "jj.log",
  "jj.new",
  "jj.describe",
  "jj.squash",
  "jj.rebase",
  "jj.bookmark",
] as const;

const JJ_ARGS: Record<(typeof JJ_LOCAL_TOOLS)[number], (args: Record<string, unknown>) => string[]> = {
  "jj.status": () => ["status"],
  "jj.diff": (a) => ["diff", ...(a.revision ? ["-r", String(a.revision)] : [])],
  "jj.log": () => ["log"],
  "jj.new": () => ["new"],
  "jj.describe": (a) => ["describe", "-m", String(a.message ?? a.msg ?? "")],
  "jj.squash": () => ["squash"],
  "jj.rebase": (a) => ["rebase", "-d", String(a.destination ?? a.onto ?? "@")],
  "jj.bookmark": (a) => ["bookmark", "set", String(a.name ?? "main"), "-r", String(a.revision ?? "@")],
};

export type ChildMcpOptions = {
  port?: number;
  planeUrl: string;
  token: string;
  cwd: string;
  fetchImpl?: typeof fetch;
};

export function childToolDefs(): { name: string; description: string; inputSchema: Record<string, unknown> }[] {
  return [...CHILD_PROXY_TOOLS, ...JJ_LOCAL_TOOLS].map((name) => ({
    name,
    description: name,
    inputSchema: { type: "object", additionalProperties: true },
  }));
}

export function planeMcpUrl(planeUrl: string): string {
  const base = planeUrl.replace(/\/$/, "");
  return base.endsWith("/mcp") ? base : `${base}/mcp`;
}

export async function handleChildCall(
  opts: ChildMcpOptions,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if ((JJ_LOCAL_TOOLS as readonly string[]).includes(name)) {
    const argv = JJ_ARGS[name as (typeof JJ_LOCAL_TOOLS)[number]](args);
    const result = await runJj(opts.cwd, argv);
    if (result.code === 127) return { ok: true, tool: name, skipped: "jj not installed" };
    return { ok: result.code === 0, tool: name, stdout: result.stdout, stderr: result.stderr, code: result.code };
  }
  if (!(CHILD_PROXY_TOOLS as readonly string[]).includes(name)) {
    throw Object.assign(new Error(`unknown child tool: ${name}`), { status: 404 });
  }
  const fetchFn = opts.fetchImpl ?? fetch;
  const res = await fetchFn(planeMcpUrl(opts.planeUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${opts.token}`, "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const body = (await res.json()) as {
    error?: { message?: string };
    result?: { content?: { text?: string }[] };
  };
  if (body.error) throw Object.assign(new Error(body.error.message ?? name), { status: res.status });
  const text = body.result?.content?.[0]?.text;
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: unknown, status: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code: status, message } };
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body?: unknown) {
  if (body === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export async function startChildMcp(opts: ChildMcpOptions): Promise<{ port: number; stop: () => void }> {
  const port = opts.port ?? Number(process.env.METAPROMPT_CHILD_MCP_PORT ?? 3334);
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/healthz") {
        sendJson(res, 200, { ok: true, child: true });
        return;
      }
      if (req.method !== "POST" || (url.pathname !== "/mcp" && url.pathname !== "/jj")) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      const body = (await readJson(req)) as {
        id?: unknown;
        method?: string;
        params?: { name?: string; arguments?: Record<string, unknown> };
      };
      if (body.method === "initialize") {
        sendJson(
          res,
          200,
          rpcResult(body.id, {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "metaprompt-child", version: "0.1.0" },
          }),
        );
        return;
      }
      if (body.method === "notifications/initialized") {
        sendJson(res, 204);
        return;
      }
      if (body.method === "tools/list") {
        const tools =
          url.pathname === "/jj"
            ? childToolDefs().filter((t) => t.name.startsWith("jj."))
            : childToolDefs();
        sendJson(res, 200, rpcResult(body.id, { tools }));
        return;
      }
      if (body.method === "tools/call") {
        const name = String(body.params?.name ?? "");
        if (url.pathname === "/jj" && !name.startsWith("jj.")) {
          sendJson(res, 404, rpcError(body.id, 404, `unknown jj tool: ${name}`));
          return;
        }
        try {
          const result = await handleChildCall(opts, name, body.params?.arguments ?? {});
          sendJson(res, 200, rpcResult(body.id, { content: [{ type: "text", text: JSON.stringify(result) }] }));
        } catch (err) {
          const status = (err as { status?: number }).status ?? 500;
          sendJson(res, status, rpcError(body.id, status, (err as Error).message));
        }
        return;
      }
      sendJson(res, 404, rpcError(body.id, 404, "method not found"));
    })().catch((err) => {
      if (!res.headersSent) sendJson(res, 500, rpcError(null, 500, (err as Error).message));
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const bound = typeof addr === "object" && addr ? addr.port : port;
      resolve({
        port: bound,
        stop: () => {
          server.close();
        },
      });
    });
    server.on("error", reject);
  });
}
