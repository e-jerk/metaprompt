---
name: metaprompt-build
description: Build Metaprompt images with Bun. Apple Silicon prefers Apple container + container k8s load-image; docker buildx bake is for CI and Linux.
---

# Build Metaprompt images

Use this when you need local images (dev loop) and do not want to pull from GHCR. Images run on **Bun** (`oven/bun:1.3`), not Node.

## Apple container (preferred on Apple Silicon)

```bash
container system start
container build -f adapters/mcp/Dockerfile -t ghcr.io/e-jerk/metaprompt/mcp:latest .
container build -f adapters/runner/Dockerfile -t runner:latest -t ghcr.io/e-jerk/metaprompt/runner:latest .
container build -f adapters/stub/Dockerfile -t ghcr.io/e-jerk/metaprompt/stub:latest .
container k8s load-image --name metaprompt ghcr.io/e-jerk/metaprompt/mcp:latest
container k8s load-image --name metaprompt ghcr.io/e-jerk/metaprompt/runner:latest
container k8s load-image --name metaprompt ghcr.io/e-jerk/metaprompt/stub:latest
```

`make k3s-up` does this on Apple Silicon (`container k8s`). Raw k3c + rancher/k3s is not the Ready path.

Ready check:

```bash
container image ls
```

## docker buildx bake (CI / Linux / multi-arch)

```bash
docker buildx bake
```

Targets: `mcp`, `runner`, `stub`, `opencode`, `claude-code`, `codex`, `cursor`, `cli`.
Images: `ghcr.io/e-jerk/metaprompt/<name>:latest` (also tagged with the git SHA when CI runs).

Single target:

```bash
docker buildx bake stub
```

Import into a k3d fallback cluster named `metaprompt`:

```bash
k3d image import ghcr.io/e-jerk/metaprompt/mcp:latest -c metaprompt
k3d image import ghcr.io/e-jerk/metaprompt/runner:latest -c metaprompt
k3d image import ghcr.io/e-jerk/metaprompt/stub:latest -c metaprompt
```

Then install with `metaprompt-install-local`.
