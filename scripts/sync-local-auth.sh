#!/usr/bin/env bash
# Bind or copy ~/.metaprompt/creds/cursor onto local cluster nodes.
# k3d nodes need the files at /var/lib/metaprompt/creds/cursor for Job hostPath.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${METAPROMPT_CURSOR_CRED_DIR:-${HOME}/.metaprompt/creds/cursor}"
NODE_PATH="/var/lib/metaprompt/creds/cursor"
CLUSTER="${METAPROMPT_CLUSTER:-metaprompt}"

if [[ ! -S /var/run/docker.sock && -S "${HOME}/.colima/default/docker.sock" ]]; then
  export DOCKER_HOST="unix://${HOME}/.colima/default/docker.sock"
fi
DOCKER="${DOCKER_BIN:-}"
if [[ -z "${DOCKER}" ]]; then
  if [[ -x /usr/local/bin/docker ]]; then
    DOCKER=/usr/local/bin/docker
  elif [[ -x /Applications/Docker.app/Contents/Resources/bin/docker ]]; then
    DOCKER=/Applications/Docker.app/Contents/Resources/bin/docker
  else
    DOCKER=docker
  fi
fi

bash "${ROOT}/scripts/materialize-cursor-auth.sh"

sync_k3d() {
  local node
  for node in "k3d-${CLUSTER}-server-0" "k3d-${CLUSTER}-agent-0"; do
    "${DOCKER}" inspect "${node}" >/dev/null 2>&1 || continue
    "${DOCKER}" exec "${node}" mkdir -p "${NODE_PATH}"
    "${DOCKER}" cp "${DEST}/." "${node}:${NODE_PATH}/"
    echo "synced ${DEST} -> ${node}:${NODE_PATH}"
  done
}

if k3d cluster list --no-headers 2>/dev/null | awk '{print $1}' | grep -qx "${CLUSTER}"; then
  sync_k3d
fi
