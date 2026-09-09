# How Metaprompt works

A Kubernetes control plane for swappable CLI coding harnesses. The control surface is MCP. A **parent** is whoever called `run.create` (or `session.create`). Every child is a Kubernetes Job — never an in-container Task / Agent / subagent.

- Source: https://github.com/e-jerk/metaprompt
- Images: `ghcr.io/e-jerk/metaprompt/*`
- Runtime: **Bun**, not Node
- Humans: [index.html](index.html) (this text). Agents installing: [implement.md](implement.md).

## The shape of a run

The plane is an MCP server in the cluster (`deploy/metaprompt-mcp`). It authenticates callers, enforces ACL, writes catalog and party state, and creates Kubernetes objects. Coding work happens in harness pods.

1. A human or parent harness calls `session.create` (interactive root) or `run.create` (one-shot Job).
2. The plane opens a **party** (or joins one), resolves repo / model / skills / MCPs, and mints a **run token**.
3. It applies a `HarnessJob` CR (`metaprompt.io/v1`). Mode `session` → long-running Pod. Mode `job` → `batch/v1` Job.
4. The runner starts a loopback child MCP, materializes prefix files, then execs the vendor CLI or stub.
5. More workers use `job.spawn` — each spawn is another Job, nested in the party, depth + 1. Summaries roll up. Parents tail with `run.logs` / `job.progress`.

Independent work: one `job.spawn` (parallel Jobs). Dependent work: `after: [id]` or `job.wait`.

## Control surface (MCP)

`http://<plane>:3333/mcp`, JSON-RPC `tools/call`, `Authorization: Bearer …`. In-cluster: `http://metaprompt-mcp:3333`. Laptop: port-forward. Ready: `GET /healthz` → `{"ok":true}`.

Always-on Job MCPs: `plane`, `party`, `jj`. `clanker` is parent-only (`PARENT_ONLY_MCPS`). Never pass it to Jobs.

| Group | Tools |
| --- | --- |
| Discover | `harness.list` `harness.get` `model.list` `skill.list` `mcp.list` `repo.list` `asset.list` |
| Party / coord | `party.create` `party.get` `party.list` `party.add` `party.close` `coord.post` `coord.inbox` `coord.wait` `coord.signal` `coord.barrier` `coord.handoff` `coord.members` `coord.artifact.put` `coord.artifact.get` |
| Runs | `run.create` `run.instruct` `run.wait` `run.kill` `run.cancel` `run.logs` `run.result` `run.list` `run.get` `run.share` `run.unshare` |
| Jobs | `job.run` `job.spawn` `job.wait` `job.kill` `job.logs` `job.progress` |
| Self | `self.suspend` `self.exit` |
| Sessions | `session.create` `session.list` `session.get` `session.attach` `session.delete` |
| Cron | `cron.create` `cron.list` `cron.get` `cron.delete` `cron.enable` |
| jj / VCS | `jj.status` `jj.diff` `jj.log` `jj.new` `jj.describe` `jj.squash` `jj.rebase` `jj.bookmark` `jj.git.fetch` `jj.git.push` `vcs.cred.mint` |
| Memory | `memory.put` `memory.search` `memory.get` `memory.delete` |

## Sessions vs Jobs

| | Session | Job |
| --- | --- | --- |
| Create | `session.create` | `run.create` / `job.spawn` |
| Kubernetes | Long-running Pod, `mode: session` | `batch/v1` Job, `mode: job` |
| Default harness | `session` (fat image). Stub rejected. | Catalog harness you pass |
| Attach | `kubectl exec` → `/workspace/.mp/attach` | `run.logs`; process exits and completes |
| Children | Still Jobs via `job.spawn` | Still Jobs via `job.spawn` |

Storage: `tmpfs` or `pvc`. Local smoke prefers tmpfs.

## HarnessJob and the run token

The CR is the launch record (run id, owner, harness, image, repo, model, party, parent/root, depth, skills, MCPs, assets, storage, plane URL). It does **not** carry the run token, `DATABASE_URL`, or VCS PATs.

The run token is Secret `mp-token-<run>` → `METAPROMPT_RUN_TOKEN`. Jobs never get the memory database URL. Helm release/namespace/labels stay `metaprompt`. Do not put `repos` in Helm config without `currentSha`.

## What the runner does in the pod

1. **Child MCP** on `127.0.0.1:3334`. `party` → `/mcp`, `jj` → `/jj`. Proxies party/coord/job/self/`jj.git.fetch`/`push`/`vcs.cred.mint` to the plane. Local `jj.*` in-pod. Memory on the plane.
2. **Workspace pin** (`.metaprompt-pin` + optional git-sync lowerdir at `/repos/<repo>/current`). Local k3s leaves git-sync off.
3. **jj colocate** if installed.
4. **Prefix files** hashed as `prefixHash`.
5. **Spawn the harness**; Job POSTs `/internal/runs/:id/complete` on exit.

Git credential helpers are emptied. Fetch/push uses minted creds.

## Harnesses and models

| Harness | Image | Default model |
| --- | --- | --- |
| `session` | `…/session:latest` | `none` |
| `opencode` | `…/opencode:latest` | `mimo-v2.5-free` |
| `claude-code` | `…/claude-code:latest` | `bedrock-sonnet` (needs Bedrock) |
| `codex` | `…/codex:latest` | `gpt-5` |
| `cursor` | `…/cursor:latest` | `auto` |
| `stub` | `…/stub:latest` | `none` (Jobs/smoke only) |

Local k3s: Bedrock off. Disallowed tools: Task, Agent, subagent.

**Assets** after `asset.list`: `assets: ["eval-set"]`, ACL `readers`, read-only mount (`pvc:`, `hostPath:`, `configMap:`, `secret:`, `emptyDir` / `emptyDir:Memory`).

**Repos** have readers/writers, `currentSha`, `currentGeneration`. Default local repo `app` has a fixture SHA.

## Parties, memory, VCS

A party is the room for a root and descendants. `coord.handoff` creates another run. `job.spawn` may nest a party. Summaries roll up (capped). Kill can cascade. Share is ACL.

Memory (optional Postgres + pgvector) is plane-only. Scopes: `user`, `party`, `repo`. k3s embedding default is `hash`.

VCS is jj-first. `jj.git.fetch` / `push` mint via `vcs.cred.mint`.

## Auth

Local k3s: `local-dev-token` (admin), `alice-token`, `bob-token`. EKS/GKE: GitHub Enterprise OIDC JWT (`actor` / `sub`). Not IRSA.

## Limits (defaults)

Max depth 4, running per user 16, parallel per parent 8, attempts 8, suspend TTL 86400s, skill/memory 32KiB, summary 2KiB, rollup 8KiB, tail 50/500.

## Install

[setup.md](setup.md). Clanker is optional.

```bash
git clone https://github.com/e-jerk/metaprompt.git
cd metaprompt
bun install && bun test
make k3s-up
make cluster-smoke
kubectl --context metaprompt -n metaprompt port-forward svc/metaprompt-mcp 3333:3333
```

## What it is not

Not a vendor Task runtime. Not `clanker k8s deploy`. Not a Clanker subscription requirement. Not a place for `DATABASE_URL` or tokens on the CR.
