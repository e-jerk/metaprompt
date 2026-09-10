---
name: metaprompt-install-local
description: Install or reset Metaprompt on a local cluster. Apple Silicon prefers Apple container k8s (1.3.1+). Source of truth is scripts/k3s-up.sh + bootstrap.sh.
---

# Install Metaprompt on k3s

Use this for a local single-user cluster. **No Clanker Cloud subscription is required.** ACL still exists (`local-dev`, `alice`, `bob`). Runtime images are Bun (`oven/bun`), not Node/pnpm.

## Apple Silicon (preferred)

On macOS 26+ Apple Silicon, the cluster runs **on Apple `container k8s`** (kindest node, one micro-VM). That is what `container` 1.3.1 can Ready. Raw `rancher/k3s` via k3c still fails (`/proc/sys` read-only). Do not use Docker Desktop, Colima, or k3d unless you set `METAPROMPT_CLUSTER_BACKEND=k3d`.

### Prerequisites

- Apple `container` **>= 1.3.1** (`container --version`) with the `container k8s` plugin
- `kubectl`, `helm`
- The script builds `mcp`, `runner`, and `stub` with `container build` and loads them with `container k8s load-image`

### Commands

Homebrew CLI (cluster commands run in `ghcr.io/e-jerk/metaprompt/cli` via Docker or Apple `container`). `up` still creates a real Kubernetes cluster.

```bash
brew tap e-jerk/metaprompt https://github.com/e-jerk/metaprompt
brew install --HEAD metaprompt
metaprompt up
```

From the repo root (`./cli/metaprompt` is the same CLI):

```bash
metaprompt up
# or: bash scripts/k3s-up.sh
```

This starts the Apple container system if needed, creates `container k8s create --name metaprompt` if needed (kube context `metaprompt`), and runs:

```bash
bash scripts/bootstrap.sh --values deploy/chart/values-k3s.yaml
```

Reset:

```bash
metaprompt down
metaprompt up
```

`k3s-down` leaves `container system` running. Stop it with `container system stop` if you want the VMs fully off.

## Linux / Intel Mac (k3d fallback)

When Apple `container` is not available, the same script uses k3d (Docker Desktop or Colima):

```bash
METAPROMPT_CLUSTER_BACKEND=k3d metaprompt up
```

Prerequisites for that path: a Docker engine, `kubectl`, `helm`. `k3d` and Colima are installed automatically if missing.

## Ready checks

```bash
kubectl --context metaprompt get nodes,deploy,sts -n metaprompt
kubectl -n metaprompt rollout status deploy/metaprompt-mcp
kubectl -n metaprompt get svc metaprompt-mcp
```

Local memories use Postgres + pgvector (`memory.enabled` in `values-k3s.yaml`). The plane MCP gets `DATABASE_URL`; Jobs never do. Embedding default is `hash` (no API key).

**Cursor login.** Local k3s mounts `~/.metaprompt/creds/cursor` into cursor/session pods (`/root/.cursor`, `/root/.config/cursor`). That is a hostPath, not a Kubernetes Secret. `scripts/materialize-cursor-auth.sh` copies a Cursor **CLI** login (`~/.cursor/auth.json`, `CURSOR_API_KEY`, or keychain `cursor-api-key`). The IDE session is not enough — workers run `agent`, which wants `agent login` or `CURSOR_API_KEY`. After login: `scripts/sync-local-auth.sh`. Do not print the files.

**Assets.** `run.create` / `session.create` may pass `assets: ["eval-set"]` after `asset.list`. The plane checks catalog `readers`, then the Job/session pod mounts the volume read-only (`pvc:…`, `hostPath:…`, `configMap:…`, `secret:…`, `emptyDir` / `emptyDir:Memory`). Local k3s uses `hostPath:/var/lib/metaprompt/assets/eval-set`.

**Git-sync.** When `gitSync.enabled` is true, a DaemonSet writes repo snapshots under `hostPath` (`/var/lib/metaprompt/repos/<name>/current`). Jobs mount that path at `/repos` and set `METAPROMPT_LOWERDIR=/repos/<repo>/current`. Local k3s leaves git-sync **off** so smoke does not need `e-jerk/metaprompt`.

**Child MCP.** Every Job and session starts an in-pod MCP on `127.0.0.1:3334`. Prefix `party` → `/mcp` and `jj` → `/jj`. Party/job/self/coord and `jj.git.fetch`/`push` proxy to the plane with the run token; local `jj.*` runs in the pod (or stubs if `jj` is missing). Memory stays on the plane.

## Local test layers

Stop on the first red. Run from the repo root.

0. **Preflight** — `bun test` (or `make test`). Cluster Ready. k3d publishes the MCP LoadBalancer on `127.0.0.1:3333` — `GET /healthz`. Tokens: `local-dev-token` (admin), `alice-token`, `bob-token`.
1. **In-process** — slice tests plus `packages/mcp/src/memory.test.ts` (ACL, search rank, delete, empty/oversize). No cluster.
2. **HTTP plane** — `packages/mcp/src/server.test.ts` against an in-process listener; live catalog/auth/party/cron/mint/memory also run in `scripts/cluster-smoke.sh` against `127.0.0.1:3333`.
3. **Live Jobs** — `metaprompt smoke` (or `make cluster-smoke`): tmpfs Job + logs, PVC create/delete, bob denied until `run.share`, kill unblocks `run.wait`, `spawn:a,b` rollup, memory put/search across user/party/repo, identical stubs share `prefixHash`.

Stub prompt verbs for Job-only plane calls: `exit:…`, `spawn:a,b`, `memory:…`, `sleep:N`.

Out of scope locally: vendor harnesses, Bedrock, OIDC, git-sync SHA rotation, Clanker, live `jj` binary.

## Attach a parent harness

MCP URL: `http://127.0.0.1:3333/mcp` (k3d LoadBalancer; `metaprompt forward` is only a fallback).

Static tokens (k3s only):

- `Authorization: Bearer local-dev-token` (admin)
- `Authorization: Bearer alice-token`
- `Authorization: Bearer bob-token`

Call `harness.list` then `session.create` with `{ "repo": "app" }` (default harness is `session`). Jobs still use `run.create`.

### Interactive root session (`kubectl exec`)

`session.create` starts a long-running Pod (not a one-shot Job) with plane MCP, party, jj, model, and skills already written into `/workspace`. Children still launch as Kubernetes Jobs via `job.spawn`.

```bash
metaprompt forward
metaprompt session               # session image (OpenCode/Cursor/Claude/Codex)
# or: metaprompt session opencode | cursor | claude-code | codex
# prints: kubectl --context metaprompt -n metaprompt exec -it mp-run_… -c harness -- /workspace/.mp/attach
```

Inside the pod:

```text
/workspace/.mp/attach              # default harness TUI
/workspace/.mp/attach opencode     # OpenCode
/workspace/.mp/attach cursor
/workspace/.mp/attach claude
/workspace/.mp/attach codex
/workspace/.mp/attach shell
```

The fat `session` image (`adapters/session`) bundles those CLIs. `session.create` rejects `stub`. Launch context is a `HarnessJob` CR (`mode: session`); the run token stays in a Secret, not on the CR. Sessions also run the child MCP on `:3334` so `jj` is in-pod.

Do not use vendor Task/subagent tools. Spawn children with `job.run` / `job.spawn`.
