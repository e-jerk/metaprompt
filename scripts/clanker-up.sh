#!/usr/bin/env bash
# Create or reuse a Clanker-managed EKS/GKE cluster, write kubeconfig, helm-install.
# Does not use `clanker k8s deploy` (naive Deployment+LB). Helm stays bootstrap.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLUSTER="${METAPROMPT_CLUSTER:-metaprompt}"
PROVIDER="${METAPROMPT_CLANKER_PROVIDER:-eks}"
APPLY="${METAPROMPT_CLANKER_APPLY:-0}"
NODES="${METAPROMPT_CLANKER_NODES:-2}"
GCP_PROJECT="${METAPROMPT_GCP_PROJECT:-}"
GCP_REGION="${METAPROMPT_GCP_REGION:-}"
export PATH="/opt/homebrew/bin:/usr/local/bin:${HOME}/.local/bin:${PATH}"

need() { command -v "$1" >/dev/null || { echo "missing $1" >&2; exit 1; }; }

need_clanker() {
  if command -v clanker >/dev/null; then
    return
  fi
  cat <<'EOF' >&2
clanker is not on PATH. This script is optional.

Metaprompt does not need a Clanker Cloud subscription. Use:
  make k3s-up                                          # local k3s
  ./scripts/bootstrap.sh --values deploy/chart/values-eks.yaml   # existing EKS
  ./scripts/bootstrap.sh --values deploy/chart/values-gke.yaml   # existing GKE

Install the Clanker CLI only if you want it to create the cluster.
EOF
  exit 1
}

provider_args() {
  local -a extra=()
  if [[ "${PROVIDER}" == "gke" ]]; then
    if [[ -z "${GCP_PROJECT}" ]]; then
      echo "GKE requires METAPROMPT_GCP_PROJECT" >&2
      exit 1
    fi
    extra+=(--gcp-project "${GCP_PROJECT}")
    if [[ -n "${GCP_REGION}" ]]; then
      extra+=(--gcp-region "${GCP_REGION}")
    fi
  fi
  printf '%s\n' "${extra[@]}"
}

values_for_provider() {
  case "${PROVIDER}" in
    eks) echo "${ROOT}/deploy/chart/values-eks.yaml" ;;
    gke) echo "${ROOT}/deploy/chart/values-gke.yaml" ;;
    *)
      echo "Unknown METAPROMPT_CLANKER_PROVIDER=${PROVIDER} (use eks or gke)" >&2
      exit 1
      ;;
  esac
}

cluster_listed() {
  local -a extra=()
  while IFS= read -r line; do
    [[ -n "${line}" ]] && extra+=("${line}")
  done < <(provider_args)
  clanker k8s list "${PROVIDER}" "${extra[@]}" 2>/dev/null | grep -qw "${CLUSTER}"
}

confirm_apply() {
  if [[ "${APPLY}" == "1" ]]; then
    return
  fi
  if [[ -t 0 ]]; then
    read -r -p "Apply this plan and create the cluster? [y/N] " ans
    [[ "${ans}" == [yY] || "${ans}" == [yY][eE][sS] ]] || { echo "Aborted."; exit 1; }
    return
  fi
  echo "Non-interactive shell. Re-run the create with METAPROMPT_CLANKER_APPLY=1 after reviewing the plan." >&2
  exit 1
}

need_clanker
need kubectl
need helm

VALUES="$(values_for_provider)"
mapfile -t EXTRA < <(provider_args)

echo "Clanker Cloud cluster broker: provider=${PROVIDER} cluster=${CLUSTER}"

if cluster_listed; then
  echo "Cluster ${CLUSTER} already listed by Clanker; reusing"
else
  echo "Planning ${PROVIDER} cluster ${CLUSTER}…"
  clanker k8s create "${PROVIDER}" "${CLUSTER}" --nodes "${NODES}" "${EXTRA[@]}" --plan
  confirm_apply
  echo "Applying cluster create…"
  clanker k8s create "${PROVIDER}" "${CLUSTER}" --nodes "${NODES}" "${EXTRA[@]}" --apply
fi

echo "Writing kubeconfig…"
clanker k8s kubeconfig "${PROVIDER}" "${CLUSTER}" "${EXTRA[@]}"

"${ROOT}/scripts/bootstrap.sh" --values "${VALUES}"
echo "Metaprompt is on the ${PROVIDER} cluster ${CLUSTER} (created/reused via optional Clanker CLI)."
echo "Parent MCP (laptop): kubectl -n metaprompt port-forward svc/metaprompt-mcp 3333:3333"
echo "Clanker MCP is optional (laptop only): clanker mcp --transport http --listen 127.0.0.1:39393"
echo "Do not attach Clanker MCP to Jobs. Metaprompt does not require a Clanker subscription."
