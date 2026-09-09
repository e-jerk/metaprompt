#!/usr/bin/env bash
# Creates github.com/e-jerk/metaprompt when `gh` is authenticated to that org.
set -euo pipefail
if ! gh auth status -h github.com >/dev/null 2>&1; then
  echo "gh is not authenticated. Run: gh auth refresh -h github.com" >&2
  exit 1
fi
gh repo view e-jerk/metaprompt >/dev/null 2>&1 && {
  echo "e-jerk/metaprompt already exists"
  exit 0
}
# Public so GitHub Pages (free org) can serve site/ for agents + metaprom.pt.
gh repo create e-jerk/metaprompt --public --description "Metaprompt — Kubernetes control plane for CLI coding harnesses" --disable-wiki --homepage https://metaprom.pt
echo "Enable GitHub Pages (Actions source: .github/workflows/pages.yml) and point metaprom.pt at Pages. Agents: /implement.md"
