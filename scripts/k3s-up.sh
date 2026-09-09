#!/usr/bin/env bash
# Create (or reuse) a local cluster and helm-install Metaprompt.
#
# Images come from GHCR (`ghcr.io/e-jerk/metaprompt/*:latest`), published by
# `.github/workflows/images.yml`. The cluster pulls them. Set
# METAPROMPT_BUILD_IMAGES=1 to rebuild with Apple `container` (or Docker) and load.
#
# Apple Silicon + Apple container 1.3+ (preferred): `container k8s` (kindest node).
# k3c + rancher/k3s still cannot Ready: kubelet cannot write /proc/sys.
# Elsewhere, or METAPROMPT_CLUSTER_BACKEND=k3d: k3d on Docker Desktop / Colima.
# METAPROMPT_CLUSTER_BACKEND=k3c forces the k3c path.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLUSTER="${METAPROMPT_CLUSTER:-metaprompt}"
REGISTRY="${METAPROMPT_REGISTRY:-ghcr.io/e-jerk/metaprompt}"
BACKEND="${METAPROMPT_CLUSTER_BACKEND:-auto}"
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"

prefer_apple() {
  [[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]]
}

# Apple container 1.2.x mounts /proc/sys read-only, so k3s kubelet never
# becomes Ready (open /proc/sys/kernel/panic). Fixed in 1.3.0+ (#2137).
# k3c 0.26's bundled runtime (1f75291) has the same bug.
apple_container_runs_k3s() {
  local ver
  command -v container >/dev/null || return 1
  ver="$(container --version 2>/dev/null | sed -n 's/.*version \([0-9][0-9.]*\).*/\1/p' | head -1)"
  [[ -n "${ver}" ]] || return 1
  [[ "$(printf '%s\n' "${ver}" "1.3.0" | sort -V | tail -1)" == "${ver}" ]]
}

container_k8s_available() {
  command -v container >/dev/null || return 1
  apple_container_runs_k3s || return 1
  container k8s list >/dev/null 2>&1
}

resolve_backend() {
  case "${BACKEND}" in
    container|k3c|k3d) echo "${BACKEND}" ;;
    auto)
      if prefer_apple && container_k8s_available; then
        echo container
      elif prefer_apple && apple_container_runs_k3s; then
        echo k3c
      else
        if prefer_apple && command -v container >/dev/null; then
          echo "Apple container $(container --version 2>/dev/null) has no working k8s path. Using k3d." >&2
        fi
        echo k3d
      fi
      ;;
    *)
      echo "Unknown METAPROMPT_CLUSTER_BACKEND=${BACKEND} (use auto, container, k3c, or k3d)" >&2
      exit 1
      ;;
  esac
}

ensure_container_system() {
  if ! command -v container >/dev/null; then
    echo "Apple container CLI not found. Install from https://github.com/apple/container (macOS 26+)." >&2
    exit 1
  fi
  container system start >/dev/null 2>&1 || true
  for _ in $(seq 1 30); do
    if container image ls >/dev/null 2>&1; then
      echo "Apple container system is ready ($(container --version 2>/dev/null || true))"
      return
    fi
    sleep 2
  done
  echo "Apple container system did not become ready. Try: container system start" >&2
  exit 1
}

install_k3c() {
  if command -v k3c >/dev/null; then
    return
  fi
  echo "k3c not found; installing…"
  if command -v brew >/dev/null; then
    brew tap philipparndt/k3c
    HOMEBREW_NO_AUTO_UPDATE=1 brew install philipparndt/k3c/k3c
    return
  fi
  local tmp archive
  tmp="$(mktemp -d)"
  archive="${tmp}/k3c_darwin_arm64.tar.gz"
  curl -fsSL -o "${archive}" https://github.com/philipparndt/k3c/releases/latest/download/k3c_darwin_arm64.tar.gz
  tar -xzf "${archive}" -C "${tmp}"
  mkdir -p "${HOME}/.local/bin"
  find "${tmp}" -type f -name k3c -perm -u+x -exec mv {} "${HOME}/.local/bin/k3c" \;
  export PATH="${HOME}/.local/bin:${PATH}"
  command -v k3c >/dev/null || { echo "Failed to install k3c" >&2; exit 1; }
}

k3c_has_cluster() {
  k3c cluster list 2>/dev/null | awk '{print $1}' | grep -qx "${1}"
}

container_k8s_has_cluster() {
  container k8s list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "${1}"
}

ensure_local_path() {
  if kubectl get sc local-path >/dev/null 2>&1; then
    return
  fi
  echo "Installing local-path provisioner (values-k3s.yaml uses storageClass local-path)…"
  kubectl apply -f https://raw.githubusercontent.com/rancher/local-path-provisioner/v0.0.31/deploy/local-path-storage.yaml
  kubectl -n local-path-storage rollout status deploy/local-path-provisioner --timeout=120s || true
}

ensure_docker() {
  if docker info >/dev/null 2>&1; then
    echo "Using existing Docker engine"
    return
  fi
  if [[ -S "${HOME}/.colima/default/docker.sock" ]]; then
    export DOCKER_HOST="unix://${HOME}/.colima/default/docker.sock"
    if docker info >/dev/null 2>&1; then
      echo "Using Colima Docker at ${DOCKER_HOST}"
      return
    fi
  fi
  if ! command -v colima >/dev/null; then
    echo "Docker is not running. Installing Colima…"
    if command -v brew >/dev/null; then
      HOMEBREW_NO_AUTO_UPDATE=1 brew install colima
    else
      echo "Install Docker Desktop or Colima, then retry." >&2
      exit 1
    fi
  fi
  echo "Starting Colima (Docker + VM for k3d/k3s)…"
  colima start --cpu "${COLIMA_CPU:-4}" --memory "${COLIMA_MEMORY:-6}" --disk "${COLIMA_DISK:-40}" || true
  export DOCKER_HOST="unix://${HOME}/.colima/default/docker.sock"
  for _ in $(seq 1 30); do
    if docker info >/dev/null 2>&1; then
      echo "Colima Docker is ready"
      return
    fi
    sleep 2
  done
  echo "Could not start a Docker engine (Desktop or Colima)." >&2
  exit 1
}

install_k3d() {
  if command -v k3d >/dev/null; then
    return
  fi
  echo "k3d not found; installing…"
  if command -v brew >/dev/null; then
    HOMEBREW_NO_AUTO_UPDATE=1 brew install k3d
    return
  fi
  curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash
}

# Anonymous GHCR token is not a secret; do not print it.
ghcr_latest_public() {
  local img="$1"
  local path token code
  path="${REGISTRY#ghcr.io/}/${img}"
  token="$(curl -fsSL "https://ghcr.io/token?service=ghcr.io&scope=repository:${path}:pull" \
    | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')" || return 1
  [[ -n "${token}" ]] || return 1
  code="$(curl -sS -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer ${token}" \
    -H "Accept: application/vnd.oci.image.index.v1+json" \
    "https://ghcr.io/v2/${path}/manifests/latest" || true)"
  [[ "${code}" == "200" ]]
}

ghcr_core_ready() {
  local img
  for img in mcp runner session stub; do
    ghcr_latest_public "${img}" || return 1
  done
}

build_images_container() {
  echo "Building local images with Apple container (mcp, runner, session, stub)…"
  container build -f "${ROOT}/adapters/mcp/Dockerfile" -t "${REGISTRY}/mcp:latest" "${ROOT}"
  container build -f "${ROOT}/adapters/runner/Dockerfile" -t runner:latest -t "${REGISTRY}/runner:latest" "${ROOT}"
  container build -f "${ROOT}/adapters/session/Dockerfile" -t "${REGISTRY}/session:latest" "${ROOT}"
  container build -f "${ROOT}/adapters/stub/Dockerfile" -t "${REGISTRY}/stub:latest" "${ROOT}"
}

build_images_docker() {
  echo "Building local images with Docker (mcp, runner, session)…"
  docker build -f "${ROOT}/adapters/mcp/Dockerfile" -t "${REGISTRY}/mcp:latest" "${ROOT}"
  docker build -f "${ROOT}/adapters/runner/Dockerfile" -t runner:latest -t "${REGISTRY}/runner:latest" "${ROOT}"
  docker build -f "${ROOT}/adapters/session/Dockerfile" -t "${REGISTRY}/session:latest" "${ROOT}"
  docker build -f "${ROOT}/adapters/stub/Dockerfile" -t "${REGISTRY}/stub:latest" "${ROOT}"
}

up_container_k8s() {
  if ! prefer_apple && [[ "${BACKEND}" != "container" ]]; then
    echo "container k8s requires macOS 26+ on Apple Silicon." >&2
    exit 1
  fi
  ensure_container_system
  if ! container_k8s_available; then
    echo "container k8s plugin is not available. Need Apple container >= 1.3.1." >&2
    exit 1
  fi
  local cpus="${METAPROMPT_CPUS:-4}"
  local memory="${METAPROMPT_MEMORY:-8G}"

  if container_k8s_has_cluster "${CLUSTER}"; then
    echo "Cluster ${CLUSTER} already exists"
    container k8s start --name "${CLUSTER}" || true
  else
    echo "Creating Kubernetes cluster ${CLUSTER} with Apple container k8s (${cpus} cpu, ${memory})…"
    container k8s create --name "${CLUSTER}" --cpus "${cpus}" --memory "${memory}"
  fi
  container k8s write-config --name "${CLUSTER}"
  if kubectl config get-contexts -o name 2>/dev/null | grep -qx "${CLUSTER}"; then
    kubectl config use-context "${CLUSTER}"
  fi
  kubectl wait --for=condition=Ready "node/${CLUSTER}" --timeout=180s 2>/dev/null \
    || kubectl wait --for=condition=Ready node --all --timeout=180s

  if [[ "${IMAGES_SOURCE}" == "local" ]]; then
    build_images_container
    echo "Loading images into container k8s…"
    container k8s load-image --name "${CLUSTER}" "${REGISTRY}/mcp:latest"
    container k8s load-image --name "${CLUSTER}" "${REGISTRY}/runner:latest"
    container k8s load-image --name "${CLUSTER}" "${REGISTRY}/session:latest"
    container k8s load-image --name "${CLUSTER}" "${REGISTRY}/stub:latest"
    echo "Pulling pgvector for local memories…"
    container image pull pgvector/pgvector:pg16
    container k8s load-image --name "${CLUSTER}" pgvector/pgvector:pg16
  else
    echo "Cluster will pull ${REGISTRY}/*:latest and pgvector/pgvector:pg16."
  fi
  ensure_local_path
}

up_k3c() {
  if ! prefer_apple && [[ "${BACKEND}" != "k3c" ]]; then
    echo "k3c requires macOS 26+ on Apple Silicon." >&2
    exit 1
  fi
  if ! apple_container_runs_k3s; then
    echo "Apple container $(container --version 2>/dev/null) cannot Ready a k3s node. Need >= 1.3.0, or use METAPROMPT_CLUSTER_BACKEND=k3d." >&2
    exit 1
  fi
  ensure_container_system
  install_k3c
  if command -v container >/dev/null; then
    export K3C_CONTAINER_FROM_PATH=1
  fi
  export K3C_CONFIG="${K3C_CONFIG:-${ROOT}/k3c.yaml}"

  if k3c_has_cluster "${CLUSTER}"; then
    echo "Cluster ${CLUSTER} already exists"
    k3c cluster activate "${CLUSTER}" || k3c cluster start "${CLUSTER}" || true
  else
    echo "Creating k3s cluster ${CLUSTER} on Apple container (k3c)…"
    k3c cluster create "${CLUSTER}" --config "${K3C_CONFIG}"
  fi
  k3c kubeconfig merge "${CLUSTER}" || true
  if kubectl config get-contexts -o name 2>/dev/null | grep -qx "k3c-${CLUSTER}"; then
    kubectl config use-context "k3c-${CLUSTER}"
  fi

  if [[ "${IMAGES_SOURCE}" == "local" ]]; then
    build_images_container
    echo "Importing images into k3c…"
    k3c image import "${REGISTRY}/mcp:latest" "${CLUSTER}"
    k3c image import "${REGISTRY}/runner:latest" "${CLUSTER}"
    k3c image import "${REGISTRY}/session:latest" "${CLUSTER}"
    k3c image import "${REGISTRY}/stub:latest" "${CLUSTER}"
  else
    echo "Cluster will pull ${REGISTRY}/*:latest."
  fi
}

up_k3d() {
  ensure_docker
  install_k3d
  if k3d cluster list --no-headers 2>/dev/null | awk '{print $1}' | grep -qx "${CLUSTER}"; then
    echo "Cluster ${CLUSTER} already exists"
  else
    echo "Creating k3d cluster ${CLUSTER}…"
    k3d cluster create "${CLUSTER}" --agents 1 --wait
  fi
  if [[ "${IMAGES_SOURCE}" == "local" ]]; then
    build_images_docker
    echo "Importing images into k3d…"
    k3d image import \
      "${REGISTRY}/mcp:latest" \
      "${REGISTRY}/runner:latest" \
      "${REGISTRY}/session:latest" \
      "${REGISTRY}/stub:latest" \
      -c "${CLUSTER}"
  else
    echo "Cluster will pull ${REGISTRY}/*:latest."
  fi
}

BACKEND="$(resolve_backend)"
echo "Cluster backend: ${BACKEND}"
if [[ "${METAPROMPT_BUILD_IMAGES:-}" == "1" ]]; then
  IMAGES_SOURCE=local
  echo "Images: local build (METAPROMPT_BUILD_IMAGES=1)"
elif ghcr_core_ready; then
  IMAGES_SOURCE=ghcr
  echo "Images: ${REGISTRY}/{mcp,runner,session,stub}:latest from GHCR"
else
  IMAGES_SOURCE=local
  echo "Images: local build (GHCR :latest not public yet; publish via .github/workflows/images.yml)"
fi
case "${BACKEND}" in
  container) up_container_k8s ;;
  k3c) up_k3c ;;
  *) up_k3d ;;
esac

"${ROOT}/scripts/bootstrap.sh" --values "${ROOT}/deploy/chart/values-k3s.yaml"
echo "k3s cluster ${CLUSTER} is ready (backend=${BACKEND})."
echo "Smoke: bash scripts/cluster-smoke.sh"
