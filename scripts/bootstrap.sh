#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VALUES="${1:-}"
if [[ "${VALUES}" == "--values" ]]; then
  VALUES="${2:-$ROOT/deploy/chart/values-k3s.yaml}"
fi
VALUES="${VALUES:-$ROOT/deploy/chart/values-k3s.yaml}"
NS="${METAPROMPT_NAMESPACE:-metaprompt}"
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"

echo "Bootstrapping Metaprompt into namespace ${NS} with ${VALUES}"
helm upgrade --install metaprompt "${ROOT}/deploy/chart" \
  --namespace "${NS}" \
  --create-namespace \
  --values "${ROOT}/deploy/chart/values.yaml" \
  --values "${VALUES}" \
  --wait --timeout 5m

echo "Waiting for MCP…"
kubectl -n "${NS}" rollout status deploy/metaprompt-mcp --timeout=180s
echo "MCP Service: metaprompt-mcp.${NS}.svc.cluster.local:3333"
echo "Local plane (k3d LoadBalancer): http://127.0.0.1:3333/healthz"
echo "Auth (k3s): Authorization: Bearer alice-token  (or local-dev-token / bob-token)"
