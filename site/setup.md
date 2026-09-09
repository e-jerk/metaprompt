# Metaprompt setup (fetch and follow)

You are installing **Metaprompt**. Do not invent steps. Follow the matching playbook.

For invariants, MCP tools, and how to use the plane after install, fetch [implement.md](implement.md) first.

**Clanker Cloud is optional.** Local k3s, existing EKS, and existing GKE work with no Clanker CLI, app, or subscription.

1. Detect the target:
   - Apple Silicon (macOS 26+) → **Apple `container k8s`**. Fetch and follow [setup/k3s.md](setup/k3s.md).
   - Other local laptops → same playbook; it falls back to k3d.
   - Existing Amazon EKS kubecontext → **EKS**. Fetch and follow [setup/eks.md](setup/eks.md). You need a GitHub Enterprise OIDC issuer (`issuer`, `audience`, `allowedOrgs`).
   - Existing Google GKE kubecontext → [setup/gke.md](setup/gke.md) (`values-gke.yaml` + bootstrap).
   - Azure AKS → chart is compatible but values are not shipped yet. See [setup/aks.md](setup/aks.md).
   - Optional: you already use Clanker Cloud and want it to create EKS/GKE → [setup/clanker.md](setup/clanker.md). Not required.
   - Optional: Clanker DevOps / Secretary / hosted sandboxes / Workspace → [setup/clanker-workspace.md](setup/clanker-workspace.md). Parent laptop only. Paid Clanker features are unused by Metaprompt.

2. If you need images first, fetch and follow [setup/build.md](setup/build.md) (Apple `container build` on Apple Silicon; `docker buildx bake` elsewhere). Images are Bun, not Node.

3. After install, port-forward `svc/metaprompt-mcp` and attach any catalog harness as a parent. Spawn children only with `job.run` / `job.spawn` (Kubernetes Jobs). Never use vendor Task / in-process subagents. If you also run Clanker MCP on the laptop, never pass it to Jobs.
