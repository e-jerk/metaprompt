#!/usr/bin/env bash
# In-process vertical slice (ACL, parties, suspend, PVC, models, jj, spawn, tail, parallel).
# Live k3s checks: run `make k3s-up` (Apple container + k3c on Apple Silicon).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"
bun test packages/shared packages/mcp packages/runner
echo "Metaprompt in-process smoke passed."
echo "For a live k3s cluster: make k3s-up && make cluster-smoke"
