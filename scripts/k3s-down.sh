#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:${HOME}/.local/bin:${PATH}"
CLUSTER="${METAPROMPT_CLUSTER:-metaprompt}"
BACKEND="${METAPROMPT_CLUSTER_BACKEND:-auto}"
deleted=0

prefer_apple() {
  [[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]]
}

if [[ "${BACKEND}" == "auto" ]]; then
  if prefer_apple && command -v container >/dev/null && container k8s list >/dev/null 2>&1; then
    BACKEND=container
  elif prefer_apple && command -v k3c >/dev/null; then
    BACKEND=k3c
  elif command -v k3d >/dev/null; then
    BACKEND=k3d
  fi
fi

if command -v container >/dev/null && container k8s list >/dev/null 2>&1; then
  if container k8s list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "${CLUSTER}"; then
    container k8s delete --name "${CLUSTER}"
    deleted=1
    echo "Deleted container k8s cluster ${CLUSTER}."
    echo "Apple container system is left running. Stop it with: container system stop"
  fi
fi

if [[ "${deleted}" -eq 0 ]] && command -v k3c >/dev/null; then
  if k3c cluster list 2>/dev/null | awk '{print $1}' | grep -qx "${CLUSTER}"; then
    k3c cluster delete "${CLUSTER}"
    deleted=1
    echo "Deleted k3c cluster ${CLUSTER}."
    echo "Apple container system is left running. Stop it with: container system stop"
  fi
fi

if [[ "${deleted}" -eq 0 ]] && command -v k3d >/dev/null; then
  if [[ -S "${HOME}/.colima/default/docker.sock" ]] && ! docker info >/dev/null 2>&1; then
    export DOCKER_HOST="unix://${HOME}/.colima/default/docker.sock"
  fi
  if k3d cluster list --no-headers 2>/dev/null | awk '{print $1}' | grep -qx "${CLUSTER}"; then
    k3d cluster delete "${CLUSTER}"
    deleted=1
    echo "Deleted k3d cluster ${CLUSTER}."
    echo "Colima VM is left running. Stop it with: colima stop"
  fi
fi

if [[ "${deleted}" -eq 0 ]]; then
  echo "No local cluster named ${CLUSTER} found."
fi
