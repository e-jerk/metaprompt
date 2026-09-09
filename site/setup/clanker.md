---
name: metaprompt-install-clanker
description: Optional. Create or reuse an EKS/GKE cluster with the Clanker CLI, then Helm-install Metaprompt. Not required. Metaprompt works without a Clanker Cloud subscription.
---

# Optional: install Metaprompt via Clanker Cloud

**Skip this playbook unless you already have the Clanker CLI and want it to create the cluster.** Metaprompt does not need a Clanker Cloud account or subscription.

Supported paths with no Clanker:

- Local laptop → [setup/k3s.md](../setup/k3s.md) (`make k3s-up`)
- Existing EKS kubecontext → [setup/eks.md](../setup/eks.md)
- Existing GKE kubecontext → [setup/gke.md](../setup/gke.md)

This script only brokers cluster create, then calls the same `bootstrap.sh` as those playbooks. Metaprompt still owns the Helm release, Jobs, parties, and ACL.

Do **not** use `clanker k8s deploy` for Metaprompt. That command emits a naive Deployment + LoadBalancer, not this chart.

Local Apple Silicon stays [setup/k3s.md](../setup/k3s.md) (`k3c` + Apple `container`). Clanker does not create k3s on Apple container.

## Prerequisites

- `clanker` CLI (optional product; same credential store as the Clanker Cloud desktop app)
- `kubectl`, `helm`
- AWS CLI / `eksctl` for EKS, or `gcloud` for GKE
- GHCR pull access for `ghcr.io/e-jerk/metaprompt/*`
- GitHub Enterprise OIDC issuer in the values file (`issuer`, `audience`, `allowedOrgs`)

If `clanker` is missing, `scripts/clanker-up.sh` exits and points at `k3s-up` / `bootstrap.sh`.

## Commands

EKS (default):

```bash
bash scripts/clanker-up.sh
```

That runs `clanker k8s create eks metaprompt --nodes 2 --plan`, prompts before `--apply` (or set `METAPROMPT_CLANKER_APPLY=1`), writes kubeconfig, then:

```bash
bash scripts/bootstrap.sh --values deploy/chart/values-eks.yaml
```

GKE:

```bash
METAPROMPT_CLANKER_PROVIDER=gke METAPROMPT_GCP_PROJECT=my-project bash scripts/clanker-up.sh
```

Uses [deploy/chart/values-gke.yaml](../../deploy/chart/values-gke.yaml) (Workload Identity annotation placeholder, `premium-rwo` / pd-ssd). Chart templates stay generic.

Reuse an existing Clanker-listed cluster named `metaprompt` by running the same script; it skips create.

Tear down Helm only (`clanker` not required):

```bash
bash scripts/clanker-down.sh
```

Destroy the Clanker-managed cluster too (opt-in; needs the CLI):

```bash
bash scripts/clanker-down.sh --delete-cluster
```

## Ready checks

```bash
kubectl -n metaprompt rollout status deploy/metaprompt-mcp
kubectl -n metaprompt get deploy,svc
```

Optional infra debugger (Clanker, laptop):

```bash
clanker k8s resources
clanker k8s ask "metaprompt jobs in namespace metaprompt"
```

Harness debugger stays Metaprompt `run.logs` / `job.progress` and does not need Clanker.

DevOps review, Secretary, hosted sandboxes, and Workspace UI are **paid/optional extras**. Follow `metaprompt-clanker-workspace` only if you use them. They are not Jobs.

## Attach a parent harness

Metaprompt alone is enough:

```bash
kubectl -n metaprompt port-forward svc/metaprompt-mcp 3333:3333
```

Optional second surface if you already run Clanker on the laptop:

```bash
clanker mcp --transport http --listen 127.0.0.1:39393
```

| Surface | URL | Who |
| --- | --- | --- |
| Metaprompt plane | `http://127.0.0.1:3333/mcp` | Parent + (via in-cluster Service) Jobs |
| Clanker Cloud (optional) | `http://127.0.0.1:39393/mcp` | Laptop parent only |

`clanker` is **not** in the default MCP catalog. If you add it yourself, `run.create` / `job.spawn` still reject the name (`PARENT_ONLY_MCPS`) so it never lands in a Job prefix.

Jobs keep always-on `plane`, `party`, `jj`. Spawn children with `job.run` / `job.spawn`. Never pass Clanker into `mcpServers`.

Forbidden on Jobs (keep these operator-approved on the laptop):

- `clanker_k8s_create*`
- `clanker_k8s_delete`
- `clanker_run_command`
- Clanker credential store

Auth against Metaprompt is `Authorization: Bearer <GitHub Enterprise OIDC JWT>` (user = JWT `actor` or `sub`).
