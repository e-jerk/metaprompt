#!/usr/bin/env node
import { readFileSync } from "node:fs";
import express, { type Express } from "express";
import { defaultConfig, type PlaneConfig, type StaticUser } from "@metaprompt/shared";
import { authenticate } from "./auth.js";
import { PlaneError } from "./errors.js";
import { Plane } from "./plane.js";
import { callTool, toolDefs } from "./tools.js";

export function createApp(plane: Plane): Express {
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  app.post("/mcp", async (req, res) => {
    try {
      const identity = await authenticate(plane.config, req.header("authorization"));
      const body = req.body as { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
      if (body.method === "initialize") {
        res.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "metaprompt", version: "0.1.0" },
          },
        });
        return;
      }
      if (body.method === "notifications/initialized") {
        res.status(204).end();
        return;
      }
      if (body.method === "tools/list") {
        res.json({ jsonrpc: "2.0", id: body.id, result: { tools: toolDefs() } });
        return;
      }
      if (body.method === "tools/call") {
        const name = String(body.params?.name ?? "");
        const args = (body.params?.arguments ?? {}) as Record<string, unknown>;
        const result = await callTool(plane, identity, name, args);
        res.json({
          jsonrpc: "2.0",
          id: body.id,
          result: { content: [{ type: "text", text: JSON.stringify(result) }] },
        });
        return;
      }
      res.json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "method not found" } });
    } catch (err) {
      const status = err instanceof PlaneError ? err.status : 500;
      res.status(status).json({
        jsonrpc: "2.0",
        id: (req.body as { id?: unknown })?.id,
        error: { code: status, message: (err as Error).message },
      });
    }
  });

  app.post("/internal/runs/:id/logs", async (req, res) => {
    try {
      const identity = await authenticate(plane.config, req.header("authorization"));
      const run = plane.getRun(req.params.id);
      if (identity.runId !== run.id && run.owner !== identity.user && !identity.admin) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const line = plane.appendLog(run.id, String(req.body.chunk ?? ""), req.body.stream ?? "stdout");
      res.json(line);
    } catch (err) {
      res.status(err instanceof PlaneError ? err.status : 500).json({ error: (err as Error).message });
    }
  });

  app.post("/internal/runs/:id/complete", async (req, res) => {
    try {
      await authenticate(plane.config, req.header("authorization"));
      const run = plane.getRun(req.params.id);
      const updated = await plane.complete(run, req.body.status ?? "succeeded", {
        summary: req.body.summary,
        reason: req.body.reason,
        usage: req.body.usage,
      });
      res.json(updated);
    } catch (err) {
      res.status(err instanceof PlaneError ? err.status : 500).json({ error: (err as Error).message });
    }
  });

  app.post("/internal/vcs/cred/mint", async (req, res) => {
    try {
      const identity = await authenticate(plane.config, req.header("authorization"));
      res.json(await plane.mintCred(identity, req.body));
    } catch (err) {
      res.status(err instanceof PlaneError ? err.status : 500).json({ error: (err as Error).message });
    }
  });

  return app;
}

function readJsonFile<T>(path: string | undefined): T | undefined {
  if (!path) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export function loadConfig(): PlaneConfig {
  const fromFile = readJsonFile<Partial<PlaneConfig>>(
    process.env.METAPROMPT_CONFIG_FILE ?? "/etc/metaprompt/config.json",
  );
  const staticUsers = readJsonFile<StaticUser[]>(
    process.env.METAPROMPT_STATIC_USERS_FILE ?? "/etc/metaprompt/secrets/static-users.json",
  );
  const fromEnv = process.env.METAPROMPT_CONFIG ? (JSON.parse(process.env.METAPROMPT_CONFIG) as Partial<PlaneConfig>) : {};
  const merged = { ...fromFile, ...fromEnv };
  return defaultConfig({
    ...merged,
    namespace: process.env.METAPROMPT_NAMESPACE ?? merged.namespace ?? "metaprompt",
    runTokenSecret: process.env.METAPROMPT_RUN_TOKEN_SECRET ?? merged.runTokenSecret,
    staticUsers: staticUsers ?? merged.staticUsers,
    bedrock: {
      enabled: process.env.METAPROMPT_BEDROCK === "1" || Boolean(merged.bedrock?.enabled),
      region: process.env.AWS_REGION ?? merged.bedrock?.region ?? "us-east-1",
    },
    agentcore: {
      enabled: process.env.METAPROMPT_AGENTCORE === "1" || Boolean(merged.agentcore?.enabled),
      region: process.env.AWS_REGION ?? merged.agentcore?.region ?? merged.bedrock?.region ?? "us-east-1",
      harnessArn: process.env.METAPROMPT_AGENTCORE_HARNESS_ARN ?? merged.agentcore?.harnessArn,
      runtimeArn: process.env.METAPROMPT_AGENTCORE_RUNTIME_ARN ?? merged.agentcore?.runtimeArn,
      qualifier: process.env.METAPROMPT_AGENTCORE_QUALIFIER ?? merged.agentcore?.qualifier,
      gatewayUrl: process.env.METAPROMPT_AGENTCORE_GATEWAY_URL ?? merged.agentcore?.gatewayUrl,
      gatewayArn: process.env.METAPROMPT_AGENTCORE_GATEWAY_ARN ?? merged.agentcore?.gatewayArn,
      gatewayName: merged.agentcore?.gatewayName,
      planeExternalUrl:
        process.env.METAPROMPT_PLANE_EXTERNAL_URL ?? merged.agentcore?.planeExternalUrl,
      memoryArn: process.env.METAPROMPT_AGENTCORE_MEMORY_ARN ?? merged.agentcore?.memoryArn,
      memoryNamespace: merged.agentcore?.memoryNamespace,
      awsSkillPaths: merged.agentcore?.awsSkillPaths,
      maxIterations: merged.agentcore?.maxIterations,
      maxTokens: merged.agentcore?.maxTokens,
      timeoutSeconds: merged.agentcore?.timeoutSeconds,
      allowedTools: merged.agentcore?.allowedTools,
      attachPlaneMcp: merged.agentcore?.attachPlaneMcp,
      enableBrowser: merged.agentcore?.enableBrowser,
      enableCodeInterpreter: merged.agentcore?.enableCodeInterpreter,
    },
    github: {
      apiUrl: process.env.METAPROMPT_GITHUB_API_URL ?? merged.github?.apiUrl,
      appId: process.env.METAPROMPT_GITHUB_APP_ID ?? merged.github?.appId,
      installationId: process.env.METAPROMPT_GITHUB_APP_INSTALLATION_ID ?? merged.github?.installationId,
    },
    oidcApps: merged.oidcApps,
    gitSync: {
      enabled: process.env.METAPROMPT_GITSYNC === "1" || Boolean(merged.gitSync?.enabled),
      hostPath:
        process.env.METAPROMPT_GITSYNC_HOSTPATH ??
        merged.gitSync?.hostPath ??
        "/var/lib/metaprompt/repos",
    },
    localAuth: merged.localAuth,
  });
}
