#!/usr/bin/env bash
# Uninstall the Metaprompt Helm release. Cluster delete is opt-in only.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLUSTER="${METAPROMPT_CLUSTER:-metaprompt}"
PROVIDER="${METAPROMPT_CLANKER_PROVIDER:-eks}"
NS="${METAPROMPT_NAMESPACE:-metaprompt}"
DELETE_CLUSTER="${METAPROMPT_CLANKER_DELETE_CLUSTER:-0}"
GCP_PROJECT="${METAPROMPT_GCP_PROJECT:-}"
GCP_REGION="${METAPROMPT_GCP_REGION:-}"
export PATH="/opt/homebrew/bin:/usr/local/bin:${HOME}/.local/bin:${PATH}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --delete-cluster) DELETE_CLUSTER=1; shift ;;
    --provider) PROVIDER="${2:?}"; shift 2 ;;
    --cluster) CLUSTER="${2:?}"; shift 2 ;;
    *) echo "Unknown arg: $1 (use --delete-cluster, --provider, --cluster)" >&2; exit 1 ;;
  esac
done

if command -v helm >/dev/null && command -v kubectl >/dev/null; then
  if helm -n "${NS}" status metaprompt >/dev/null 2>&1; then
    helm -n "${NS}" uninstall metaprompt
    echo "Uninstalled Helm release metaprompt from namespace ${NS}."
  else
    echo "No Helm release metaprompt in ${NS}."
  fi
else
  echo "helm/kubectl not on PATH; skipped Helm uninstall."
fi

if [[ "${DELETE_CLUSTER}" != "1" ]]; then
  echo "Cluster ${CLUSTER} left in place. Destroy it with: METAPROMPT_CLANKER_DELETE_CLUSTER=1 $0 --delete-cluster"
  exit 0
fi

if ! command -v clanker >/dev/null; then
  cat <<EOF >&2
clanker is not on PATH; cannot delete cluster ${CLUSTER}.
Helm uninstall above does not need Clanker. Delete the cluster with your AWS/GCP tools, or install the CLI only if this cluster was Clanker-managed.
EOF
  exit 1
fi

extra=()
if [[ "${PROVIDER}" == "gke" ]]; then
  if [[ -z "${GCP_PROJECT}" ]]; then
    echo "GKE delete requires METAPROMPT_GCP_PROJECT" >&2
    exit 1
  fi
  extra+=(--gcp-project "${GCP_PROJECT}")
  if [[ -n "${GCP_REGION}" ]]; then
    extra+=(--gcp-region "${GCP_REGION}")
  fi
fi

echo "Deleting Clanker-managed ${PROVIDER} cluster ${CLUSTER}…"
clanker k8s delete "${PROVIDER}" "${CLUSTER}" "${extra[@]}"
echo "Deleted ${PROVIDER} cluster ${CLUSTER}."
