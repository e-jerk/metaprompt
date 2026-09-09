# Implement Metaprompt

You are an agent implementing or installing **Metaprompt**. Fetch this file and follow it. Do not invent architecture, install steps, or MCP verbs.

**Humans:** [metaprom.pt](https://metaprom.pt) (how it works). Markdown twin: [how-it-works.md](how-it-works.md). **Agents:** stay on these markdown files (raw on GitHub Pages). Index: [llms.txt](llms.txt).

```bash
curl -fsSL https://metaprom.pt/implement.md
# until the custom domain is live:
# curl -fsSL https://e-jerk.github.io/metaprompt/implement.md
```

Then fetch only the playbook you need. Prefer relative links from this page so both `metaprom.pt` and `https://e-jerk.github.io/metaprompt/` work.

## What it is

Metaprompt is a Kubernetes control plane for swappable CLI coding harnesses (OpenCode, Claude Code, Codex, Cursor, session, stub, AgentCore). The control surface is **MCP**, not kubectl-first.

- Source: `https://github.com/e-jerk/metaprompt`
- Images: `ghcr.io/e-jerk/metaprompt/<name>`
- Helm release, namespace, and labels stay `metaprompt`
- Runtime is **Bun** (`oven/bun`), not Node/pnpm

A **parent** is whoever called `run.create` (or `session.create` for a long-running root). Every child is a **Kubernetes Job**. Vendor Task / in-process subagents stay off.

## Hard rules

Do not violate these. If a request conflicts, follow this file.

1. **Children are Jobs.** Independent work uses `job.spawn` (parallel Jobs, nested party). Dependent work uses `after: [id]` or `job.wait`. Never spawn in-container helpers.
2. **Always-on Job MCPs:** `plane`, `party`, `jj`. Jobs also run an in-pod child MCP on `127.0.0.1:3334` (prefix `party` → `/mcp`, `jj` → `/jj`). Memory stays on the plane.
3. **`clanker` is parent-only.** It is not in the default catalog. `run.create` / `job.spawn` reject the name (`PARENT_ONLY_MCPS`). Never pass Clanker into Job `mcpServers`.
4. **Jobs never get `DATABASE_URL`** or plane/VCS secrets on the `HarnessJob` CR. The run token lives in Secret `mp-token-<run>`, not on the CR.
5. **Sessions are not stubs.** `session.create` default harness is `session`. `harness: "stub"` is rejected for sessions.
6. **Do not put `repos` in Helm config without `currentSha`.** Live `run.create` will 409.
7. **Do not commit secrets** (tokens, `auth.json`, kubeconfigs, PATs).
8. **Do not edit** architecture plan files under `~/.cursor/plans/`.

## Fetch map

| File | When |
| --- | --- |
| [how-it-works.md](how-it-works.md) | Full architecture (landing page twin). |
| [implement.md](implement.md) | This brief (invariants + use). Start here. |
| [setup.md](setup.md) | Choose an install playbook. |
| [setup/k3s.md](setup/k3s.md) | Local cluster (Apple `container k8s` / k3d fallback). |
| [setup/eks.md](setup/eks.md) | Existing EKS + GitHub Enterprise OIDC. |
| [setup/gke.md](setup/gke.md) | Existing GKE. |
| [setup/aks.md](setup/aks.md) | AKS (chart compatible; values not shipped). |
| [setup/build.md](setup/build.md) | Build/load images (Bun). |
| [setup/clanker.md](setup/clanker.md) | Optional. Clanker CLI creates EKS/GKE. Not required. |
| [setup/clanker-workspace.md](setup/clanker-workspace.md) | Optional Clanker extras. Parent laptop only. |

Install routing lives in [setup.md](setup.md). **Clanker Cloud is optional.** Local k3s, existing EKS, and existing GKE work with no Clanker CLI, app, or subscription.

## If you are not in the repo

```bash
git clone https://github.com/e-jerk/metaprompt.git
cd metaprompt
bun install
bun test
```

Images and Helm values are in that checkout. Do not reimplement the plane in a new repo unless the user asked for a fork.

## Install

Follow [setup.md](setup.md). Typical local path:

```bash
brew tap e-jerk/metaprompt https://github.com/e-jerk/metaprompt
brew install --HEAD metaprompt
# Docker or Apple container required. Cluster commands run in ghcr.io/e-jerk/metaprompt/cli.
metaprompt up                 # install a local cluster + Helm
# metaprompt install eks      # BYO kubecontext
metaprompt smoke
metaprompt forward
# checkout: ./cli/metaprompt  (same commands)
```

Ready: `GET http://127.0.0.1:3333/healthz` → `{"ok":true}`.

k3s static tokens (local only):

- `Authorization: Bearer local-dev-token` (admin)
- `Authorization: Bearer alice-token`
- `Authorization: Bearer bob-token`

EKS/GKE: `Authorization: Bearer <GitHub Enterprise OIDC JWT>`. User is JWT `actor` (or `sub`).

Need images first → [setup/build.md](setup/build.md). Apple Silicon: `container build`. CI/Linux: `docker buildx bake`.

## Use the plane

MCP URL: `http://127.0.0.1:3333/mcp` (after port-forward). JSON-RPC `tools/call`.

```bash
# example: list harnesses as alice (k3s)
metaprompt call harness.list
# or curl:
curl -sS http://127.0.0.1:3333/mcp \
  -H 'Authorization: Bearer alice-token' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"harness.list","arguments":{}}}'
```

### Parent vs child

| Intent | Tool | Workload |
| --- | --- | --- |
| Interactive root (TUI / `kubectl exec`) | `session.create` `{ "repo": "app" }` | Long-running Pod, `mode: session` |
| One-shot coding run | `run.create` | Kubernetes Job |
| Child / parallel work | `job.spawn` | Kubernetes Job (always) |

`session.create` default image is `session` (OpenCode, Claude Code, Codex, Cursor bundled). Attach:

```bash
metaprompt session
# prints: kubectl --context metaprompt -n metaprompt exec -it mp-run-… -c harness -- /workspace/.mp/attach
```

Inside the pod: `/workspace/.mp/attach` (or `opencode` / `cursor` / `claude` / `codex` / `shell`).

### Prompt patterns (swarms and adversaries)

You prompt the **parent**, not a Metaprompt chat API. The parent calls `job.spawn`. Full examples: [how-it-works.md](how-it-works.md#how-to-use-it) (landing page: [index.html#use](index.html#use)).

Human prompt to the parent (session or `run.create`):

```
Ship a login rate limiter. job.spawn a swarm: implementer, adversary (bypass only, do not help impl), tester.
Each coord.artifact.put (impl / adv / test). job.progress then job.wait. Then spawn judge after those three; keep only what survives the adversary.
No Task/Agent/subagent tools. jj only.
```

`job.spawn` (from the parent run token). Local k3s: use `opencode` for every role. Mixed harnesses need Bedrock / Codex / AgentCore on the cluster.

```json
{
  "agents": [
    { "id": "impl", "harness": "opencode", "prompt": "Implementer. Rate-limit /login. coord.artifact.put name=impl. Do not read the adversary." },
    { "id": "adv", "harness": "opencode", "prompt": "Adversary. Find bypasses only. coord.artifact.put name=adv. Do not implement the feature." },
    { "id": "test", "harness": "opencode", "prompt": "Tester. Tests that catch bypasses. coord.artifact.put name=test. Do not soften failures." },
    { "id": "judge", "harness": "opencode", "after": ["impl", "adv", "test"], "prompt": "Judge. coord.artifact.get impl, adv, test. Keep what survives. coord.artifact.put name=verdict." }
  ]
}
```

Independent work: no `after` (parallel Jobs). Dependent work: `after: [id]`. Same party; share via `coord.artifact.*`. Tail with `job.progress`, not log dumps. `run.get` `{ "summaryTree": true }`.

### Harnesses and default models

| Harness | Default model | Notes |
| --- | --- | --- |
| `session` | `none` | Fat root image. Not stub. |
| `opencode` | `mimo-v2.5-free` | Also `deepseek-v4-flash-free`, `big-pickle`. Bedrock ids need `bedrock.enabled`. |
| `claude-code` | `bedrock-sonnet` | Requires Bedrock when that model is requested. |
| `codex` | `gpt-5` | Needs OpenAI credentials. |
| `cursor` | `auto` | Also `composer-2.5`. |
| `agentcore` | `agentcore` | Amazon Bedrock AgentCore Harness or Runtime. Job-only. Needs `agentcore.enabled` plus `harnessArn` or `runtimeArn`. The Job is the SigV4 bridge; the agent loop runs in the AgentCore microVM. Attach plane MCP at `planeExternalUrl` (AWS cannot reach ClusterIP). Optional Memory (`memoryArn`, `actorId` = owner), Gateway MCP `agentcore-gateway`, Browser, Code Interpreter, AWS/Git/S3 skills. |
| `stub` | `none` | Jobs/smoke only. Rejected for sessions. |

Local k3s ships `bedrock.enabled: false` and `agentcore.enabled: false`. Do not `run.create` with `claude-code` + `bedrock-sonnet` or `harness: "agentcore"` there (409). Use `opencode` + a free Zen model, or `session` / `stub`. `session.create` rejects `agentcore` — AgentCore sessions live in AWS (`runtimeSessionId` = padded run id, `actorId` = owner), not `kubectl exec`.

On EKS, set `bedrock.agentcore.planeExternalUrl` to an Ingress/NLB (or put the harness in the cluster VPC) so `job.spawn` / `coord.*` / `memory.*` / `gh.issue.*` / `gh.pr.*` from AgentCore can reach the plane. The Job still uses the in-cluster URL to POST `/internal/runs/:id/complete` and usage. Children remain Kubernetes Jobs. AgentCore Memory (`CreateEvent` / `RetrieveMemoryRecords`) is optional and dual-writes the summary to plane `memory.put` `{ scope: "party" }`. Inline skill content goes in the system prompt; `s3://` and Git skill URLs become InvokeHarness skills. Workspace for the agent is the AgentCore filesystem (optional S3 Files / EFS on the AWS harness), not the Job `/workspace`.

### Catalog tools (do not invent names)

**Discover:** `harness.list` `harness.get` `model.list` `skill.list` `mcp.list` `repo.list` `asset.list`

**Party / coord:** `party.create` `party.get` `party.list` `party.add` `party.close` `coord.post` `coord.inbox` `coord.wait` `coord.signal` `coord.barrier` `coord.handoff` `coord.members` `coord.artifact.put` `coord.artifact.get`

**Runs:** `run.create` `run.instruct` `run.wait` `run.kill` `run.cancel` `run.logs` `run.result` `run.list` `run.get` `run.share` `run.unshare`

**Jobs:** `job.run` `job.spawn` `job.wait` `job.kill` `job.logs` `job.progress`

**Self (from a Job):** `self.suspend` `self.exit`

**Cron:** `cron.create` `cron.list` `cron.get` `cron.delete` `cron.enable`

**jj / VCS:** `jj.status` `jj.diff` `jj.log` `jj.new` `jj.describe` `jj.squash` `jj.rebase` `jj.bookmark` `jj.git.fetch` `jj.git.push` `vcs.cred.mint`

**GitHub (plane only):** `gh.issue.list` `gh.issue.get` `gh.issue.create` `gh.issue.comment` `gh.issue.update` `gh.pr.list` `gh.pr.get` `gh.pr.create` `gh.pr.review` `gh.pr.merge`

**App tokens (plane only):** `app.list` `app.cred.mint`

**Memory (plane only):** `memory.put` `memory.search` `memory.get` `memory.delete`

**Sessions:** `session.create` `session.list` `session.get` `session.attach` `session.delete`

Use `jj` for version control. Do not embed git remotes or credentials in Jobs; mint via `vcs.cred.mint` / `jj.git.fetch` / `jj.git.push`. Use `gh.issue.*` / `gh.pr.*` for GitHub issues and pull requests. On EKS the plane prefers a GitHub App installation token or an RFC 8693 / jwt-bearer exchange of the **mcp ServiceAccount** OIDC token (cluster issuer or IRSA web identity). Long-lived PATs stay on the plane only as fallback and are never minted to Jobs. Other apps (Linear, custom STS) use `app.cred.mint`. AgentCore catalog MCPs get those minted bearers at invoke time. Prefer `job.progress` over dumping descendant logs into the next prompt.

### Assets and git-sync

- `run.create` / `session.create` may pass `assets: ["eval-set"]` after `asset.list`. The plane checks catalog `readers`, then mounts the volume read-only.
- Volume kinds: `pvc:…`, `hostPath:…`, `configMap:…`, `secret:…`, `emptyDir` / `emptyDir:Memory`.
- Local k3s: `eval-set` → `hostPath:/var/lib/metaprompt/assets/eval-set`.
- Git-sync (when enabled) writes `/var/lib/metaprompt/repos/<name>/current`. Jobs mount `/repos` and set `METAPROMPT_LOWERDIR=/repos/<repo>/current`. Local k3s leaves git-sync **off**.

## Implementing in this repo

If the user asked you to change Metaprompt itself (not only install it):

| Path | Role |
| --- | --- |
| `packages/shared` | Types, ACL, catalog, prefix hash, spawn DAG, rollup |
| `packages/mcp` | Control-plane MCP + in-process plane |
| `packages/runner` | Job runner, prefix files, child MCP, harness spawn |
| `adapters/*` | Images (`mcp`, `runner`, `stub`, `session`, `opencode`, `claude-code`, `codex`, `cursor`). `agentcore` uses the runner image. |
| `deploy/chart` | Helm (`values-k3s.yaml`, `values-eks.yaml`, `values-gke.yaml`) |
| `skills/` | Install/build playbooks (synced onto this site) |
| `site/` | This GitHub Pages tree |

After catalog or playbook edits, run `make sync-site` so `site/setup/*.md` matches `skills/`. Run `bun test` (or `make test`) before claiming the plane works.

Job-only smoke verbs on **stub**: `exit:…`, `spawn:a,b`, `memory:…`, `sleep:N`. Full local layers are in [setup/k3s.md](setup/k3s.md).

## What not to do

- Do not use vendor Task / Agent / subagent tools.
- Do not pass `clanker` to Jobs or `mcpServers`.
- Do not give Jobs `DATABASE_URL`.
- Do not implement a new control plane beside this one.
- Do not use `clanker k8s deploy` for Metaprompt (naive Deployment + LoadBalancer, not this chart).
- Do not print PATs, kubeconfigs, run tokens, or harness `auth.json`.
