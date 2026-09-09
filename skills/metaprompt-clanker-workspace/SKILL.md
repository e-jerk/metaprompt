---
name: metaprompt-clanker-workspace
description: Optional. Use Clanker Cloud Workspace, DevOps, Secretary, and hosted sandboxes with Metaprompt if you already have them. Parent laptop only. Metaprompt works without a Clanker subscription.
---

# Optional: Clanker Cloud surfaces on Metaprompt

**None of this is required.** Metaprompt parties, `coord.handoff`, `run.logs`, and Job spawn work with no Clanker CLI, desktop app, or paid plan.

Clanker Cloud extras (if you already use them): DevOps review, enrolled-machine computer use, hosted sandboxes, and the shared project/session UI. Paid Clanker features (`/sites`, `/explain`, persistent sandboxes, Pro backend, Secretary remote control) are unused by Metaprompt.

Do not replace `job.spawn` with Clanker Secretary or a sandbox. Do not put Clanker credentials, MCP, or tools on a Kubernetes Job.

## Which surface

| Work | Surface | Where it runs |
| --- | --- | --- |
| Child coding / review / tests as a harness | Metaprompt `job.run` / `job.spawn` | Cluster Job (always) |
| Incidents, deploys, cost, security, live Kubernetes | `kubectl` / your usual cloud tools, or optional **Clanker DevOps** | Laptop |
| Click, type, browsers, apps, files, SaaS | You, or optional **Clanker Secretary** | Enrolled machine only |
| Shell when it must not be the laptop and you do not want a Job | Optional **Cloud for Agents** sandbox | Clanker-hosted (anonymous create needs no subscription) |
| Projects, sessions, reviewable handoffs | Metaprompt party + `coord.handoff`, or optional **Clanker Workspace** | In-plane / desktop UI |

Cluster create + Helm without Clanker: [setup/k3s.md](../setup/k3s.md), [setup/eks.md](../setup/eks.md), [setup/gke.md](../setup/gke.md). Optional Clanker broker: [metaprompt-install-clanker](../metaprompt-install-clanker/SKILL.md).

## Parent MCP

Metaprompt plane is the only required MCP:

```bash
kubectl -n metaprompt port-forward svc/metaprompt-mcp 3333:3333
```

Skip the rest unless you already run Clanker:

```bash
clanker mcp --transport http --listen 127.0.0.1:39393
```

- Metaprompt plane: `http://127.0.0.1:3333/mcp`
- Optional Clanker CLI MCP: `http://127.0.0.1:39393/mcp`
- Optional desktop app MCP: discover via `http://127.0.0.1:8080/mcp/instructions` through `8084`

`clanker` is **not** a default catalog MCP. If an operator adds it, `run.create` / `job.spawn` reject it (`PARENT_ONLY_MCPS`). Always-on Job MCPs stay `plane`, `party`, `jj`.

Forbidden on Jobs: `clanker_k8s_create*`, `clanker_k8s_delete`, `clanker_run_command`, credential store, Secretary computer-use, sandbox create/delete with account tokens.

## Clanker DevOps (optional)

Use only if you already have the CLI, for multi-cloud operations **with review before changes**.

```bash
clanker k8s ask "metaprompt jobs in namespace metaprompt"
clanker k8s resources
# Any mutate: --plan first, then --apply only after a human confirms
```

`scripts/clanker-up.sh` already plans before apply. Do not use `clanker k8s deploy` for the Metaprompt chart.

Harness debugger: Metaprompt `run.logs` / `job.progress` (no Clanker needed). Infra debugger: your cloud console, or optional DevOps ask / resources.

## Clanker Secretary (optional)

Computer-use agent on an **explicitly enrolled** machine. Remote control from web/phone is **off unless the operator enables it** and is typically a paid extra.

- Secretary is a sibling parent, not a child Job.
- Hand off office work with Metaprompt `coord.handoff` (party log). A Clanker Workspace handoff is optional, not required.
- Keep cloud kubeconfigs and PATs on the enrolled desktop, not in run records.

## Cloud for Agents (optional hosted sandboxes)

Isolated runtimes when work should **not** run on the laptop and is **not** a Metaprompt Job. Anonymous `create` needs no subscription (~1 hour TTL). Free account ~8h. Paid Lite/Pro for `/sites` and `/explain` — Metaprompt does not call those.

```bash
bash scripts/clanker-sandbox.sh create metaprompt
bash scripts/clanker-sandbox.sh cmd "uname -a"
bash scripts/clanker-sandbox.sh delete
```

API (see [Cloud for Agents](https://clankercloud.ai/cloud-for-agents)): `POST /api/sandboxes`, `/commands`, `/files`, `/workflows`, `/approvals`, `/traces`, `/memory`. Optional `CLANKER_ACCOUNT_TOKEN`.

Rules: one sandbox per task; store id + sandbox token from create; memory is non-secret only; create approvals before side effects; delete when done. Never mint a sandbox token onto a Job.

## Workspace (optional)

Metaprompt already has parties, skill catalog, and `coord.handoff`. Clanker Workspace is a desktop/web UI for the same operator if you already use it.

| Metaprompt (always) | Optional Clanker Workspace |
| --- | --- |
| Party + `coord.handoff` | Reviewable handoff / session |
| Skill catalog | Knowledge + skills |
| `run` / `job.spawn` tree | Agent run (cluster) |
| Parent harness on the laptop | Workspace session operator |
| `run.logs` | Harness evidence (keep in-plane) |

Job summaries still roll up in Metaprompt whether or not Workspace is open.
