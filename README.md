# Metaprompt

Kubernetes control plane for swappable CLI coding harnesses. Product site: [metaprom.pt](https://metaprom.pt). Images: `ghcr.io/e-jerk/metaprompt/<name>`.

A **parent** is whoever called `run.create`. Every child is a **Kubernetes Job**. Vendor Task / in-process subagents stay off. Independent work uses `job.spawn` (parallel Jobs, nested party). Summaries roll up the tree. The root and any child-parent can tail descendant logs via `run.logs` / `job.progress`.

## Repo

| Path | Role |
| --- | --- |
| `packages/shared` | Types, ACL, prefix hash, spawn DAG, rollup |
| `packages/mcp` | Control-plane MCP + in-process plane |
| `packages/runner` | Job runner, prefix files, stub harness |
| `adapters/*` | Images (mcp, runner, stub, opencode, claude-code, codex, cursor, session). `agentcore` reuses the runner image (SigV4 bridge into AgentCore). |
| `deploy/chart` | Generic Helm chart (`values-k3s.yaml`, `values-eks.yaml`, `values-gke.yaml`) |
| `skills/` | Harness-native install/build playbooks |
| `site/` | GitHub Pages + CNAME `metaprom.pt`. Landing: how it works. Agents: `implement.md` |

## GitHub

Intended remote: [`e-jerk/metaprompt`](https://github.com/e-jerk/metaprompt). After `gh auth refresh`:

```bash
bash scripts/create-github-repo.sh
git init -b main
git add .
git commit -m "Initial Metaprompt control plane"
git remote add origin git@github.com:e-jerk/metaprompt.git
git push -u origin main
```

Point **metaprom.pt** at GitHub Pages once `.github/workflows/pages.yml` has published `site/` (CNAME is already `metaprom.pt`). The site ships `.nojekyll` so agents receive raw markdown.

## Local

```bash
bun install
bun test
```

Cluster (Apple Silicon: Apple `container k8s`; elsewhere: k3d):

```bash
make k3s-up
make cluster-smoke
kubectl -n metaprompt port-forward svc/metaprompt-mcp 3333:3333
```

Then `Authorization: Bearer alice-token` against `http://127.0.0.1:3333/mcp`.

EKS (existing cluster, GitHub Enterprise OIDC):

```bash
./scripts/bootstrap.sh --values deploy/chart/values-eks.yaml
```

Clanker Cloud is **optional** (no subscription required for Metaprompt). Local k3s and `bootstrap.sh` on an existing kubecontext are the supported paths. If you already have the Clanker CLI and want it to create EKS/GKE:

```bash
bash scripts/clanker-up.sh
```

Never pass `clanker` into `job.spawn` / `mcpServers`.

Agents that are not in this checkout should `curl https://metaprom.pt/implement.md` and follow it (install router: `setup.md`; index: `llms.txt`). Until DNS is live: `https://e-jerk.github.io/metaprompt/implement.md`.

## Tests

`packages/mcp` vertical slice covers ACL, parties, suspend/resume, PVC vs tmpfs, models/Bedrock, jj mint, inherited skills/MCPs, prefix cache, kill/cascade, Job-only spawn + summary rollup, ancestor tail, and parallel `after[]`.
