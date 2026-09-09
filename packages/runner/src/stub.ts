#!/usr/bin/env bun
/**
 * Test harness: talks to the plane as a run token and exits with a summary.
 * Never spawns in-process subagents.
 *
 * Prompt verbs:
 *   default / exit:…  — log and self.exit
 *   spawn:a,b         — job.spawn those keys, then job.wait
 *   memory:…          — memory.put + memory.search as the run owner
 *   sleep:N           — stay running N seconds (for kill smoke)
 */
async function main() {
  const plane = process.env.METAPROMPT_PLANE_URL ?? "http://127.0.0.1:3333";
  const token = process.env.METAPROMPT_RUN_TOKEN ?? "";
  const runId = process.env.METAPROMPT_RUN_ID ?? "";
  const prompt =
    process.env.METAPROMPT_PROMPT ||
    process.argv.slice(2).filter((a) => a !== "--resume").join(" ");
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await fetch(`${plane}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    const body = (await res.json()) as {
      error?: { message?: string };
      result?: { content?: { text?: string }[] };
    };
    if (body.error) throw new Error(body.error.message ?? `tool ${name} failed`);
    const text = body.result?.content?.[0]?.text;
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  };
  const log = async (chunk: string) => {
    console.log(chunk);
    await fetch(`${plane}/internal/runs/${runId}/logs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ chunk, stream: "stdout" }),
    });
  };
  await log(`stub start ${prompt}`);

  if (prompt.startsWith("sleep:")) {
    const secs = Number(prompt.slice(6)) || 60;
    await log(`stub sleeping ${secs}s`);
    await new Promise((r) => setTimeout(r, secs * 1000));
    await call("self.exit", { status: "succeeded", summary: `slept ${secs}` });
    return;
  }

  if (prompt.startsWith("spawn:")) {
    const keys = prompt
      .slice(6)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const spawned = (await call("job.spawn", {
      agents: keys.map((id) => ({ id, harness: "stub", prompt: `exit:child-${id}` })),
    })) as { runIds?: Record<string, string> };
    const runIds = Object.values(spawned.runIds ?? {});
    await log(`stub spawned ${JSON.stringify(spawned.runIds ?? {})}`);
    if (runIds.length) await call("job.wait", { runIds });
    await call("self.exit", { status: "succeeded", summary: `spawned ${keys.join(",")}` });
    return;
  }

  if (prompt.startsWith("memory:")) {
    const text = prompt.slice(7) || "stub memory";
    const put = await call("memory.put", { scope: "user", text });
    const search = await call("memory.search", { query: text, scope: "user", limit: 3 });
    await log(`stub memory ${JSON.stringify({ put, search })}`);
    await call("self.exit", { status: "succeeded", summary: `memory:${text.slice(0, 40)}` });
    return;
  }

  const summary = prompt.startsWith("exit:") ? prompt.slice(5) : `stub completed: ${prompt.slice(0, 80)}`;
  await call("self.exit", { status: "succeeded", summary });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
