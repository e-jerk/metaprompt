#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "${ROOT}/site/setup"
# Keep hidden files so GitHub Pages serves raw markdown (no Jekyll).
touch "${ROOT}/site/.nojekyll"
cp "${ROOT}/skills/metaprompt-install-local/SKILL.md" "${ROOT}/site/setup/k3s.md"
cp "${ROOT}/skills/metaprompt-install-eks/SKILL.md" "${ROOT}/site/setup/eks.md"
cp "${ROOT}/skills/metaprompt-install-clanker/SKILL.md" "${ROOT}/site/setup/clanker.md"
cp "${ROOT}/skills/metaprompt-clanker-workspace/SKILL.md" "${ROOT}/site/setup/clanker-workspace.md"
cp "${ROOT}/skills/metaprompt-build/SKILL.md" "${ROOT}/site/setup/build.md"
echo "Synced site/setup from skills/"
