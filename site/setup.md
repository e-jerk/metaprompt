# Metaprompt setup (fetch and follow)

You are installing **Metaprompt**. Do not invent steps. Follow the matching playbook.

For invariants, MCP tools, and how to use the plane after install, fetch [implement.md](implement.md) first.

**Clanker Cloud is optional.** Local k3s, existing EKS, and existing GKE work with no Clanker CLI, app, or subscription.

Install the bash CLI with Homebrew. Cluster commands (`up`, `install`, `smoke`, …) run inside `ghcr.io/e-jerk/metaprompt/cli` via `docker run` or Apple `container run`. You still need a Kubernetes cluster: `up` installs one, or point kubectl at a BYO cluster and `install`.

```bash
brew tap e-jerk/metaprompt https://github.com/e-jerk/metaprompt
brew install --HEAD metaprompt
metaprompt up              # local cluster (k3d, or Apple container k8s) + Helm
# metaprompt install eks   # BYO kubecontext + values-eks.yaml
metaprompt smoke
metaprompt forward
```

From a git checkout: `./cli/metaprompt`. Formula: [`Formula/metaprompt.rb`](https://github.com/e-jerk/metaprompt/blob/main/Formula/metaprompt.rb).

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
