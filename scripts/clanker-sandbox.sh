#!/usr/bin/env bash
# Operator helper for Clanker Cloud for Agents (hosted sandboxes).
# Parent laptop only. Do not call from a Kubernetes Job.
set -euo pipefail
API="${CLANKER_API:-https://clankercloud.ai}"
TOKEN_FILE="${CLANKER_SANDBOX_TOKEN_FILE:-${HOME}/.config/metaprompt/clanker-sandbox.json}"

usage() {
  cat <<'EOF'
Usage: scripts/clanker-sandbox.sh <create|status|cmd|delete> [args]

  create [name]     POST /api/sandboxes  (prints id + token; writes TOKEN_FILE)
  status            GET  /api/sandboxes/{id}
  cmd <command>     POST /api/sandboxes/{id}/commands
  delete            DELETE /api/sandboxes/{id}

Default create is anonymous (no subscription, ~1 hour TTL).
Optional CLANKER_ACCOUNT_TOKEN: free account ~8h; paid Lite/Pro for /sites and /explain.
Metaprompt itself does not need this script or a Clanker subscription.
Never put cloud credentials or PATs in sandbox memory or traces.
EOF
}

need_curl() { command -v curl >/dev/null || { echo "missing curl" >&2; exit 1; }; }

load_state() {
  if [[ ! -f "${TOKEN_FILE}" ]]; then
    echo "No sandbox state at ${TOKEN_FILE}. Run: $0 create" >&2
    exit 1
  fi
  SANDBOX_ID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("id",""))' "${TOKEN_FILE}")"
  SANDBOX_TOKEN="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("sandboxToken",""))' "${TOKEN_FILE}")"
  if [[ -z "${SANDBOX_ID}" ]]; then
    echo "sandbox id missing in ${TOKEN_FILE}" >&2
    exit 1
  fi
}

auth_args() {
  if [[ -n "${CLANKER_ACCOUNT_TOKEN:-}" ]]; then
    printf -- '-H\nAuthorization: Bearer %s\n' "${CLANKER_ACCOUNT_TOKEN}"
  elif [[ -n "${SANDBOX_TOKEN:-}" ]]; then
    printf -- '-H\nAuthorization: Bearer %s\n' "${SANDBOX_TOKEN}"
  fi
}

cmd="${1:-}"
shift || true
need_curl

case "${cmd}" in
  create)
    name="${1:-metaprompt}"
    mkdir -p "$(dirname "${TOKEN_FILE}")"
    body="$(python3 -c 'import json,sys; print(json.dumps({"name":sys.argv[1],"agent":"clanker-cli"}))' "${name}")"
    extra=()
    if [[ -n "${CLANKER_ACCOUNT_TOKEN:-}" ]]; then
      extra+=(-H "Authorization: Bearer ${CLANKER_ACCOUNT_TOKEN}")
    else
      echo "Creating an anonymous sandbox (no Clanker subscription). ~1 hour TTL."
    fi
    resp="$(curl -sS "${API}/api/sandboxes" -H "Content-Type: application/json" "${extra[@]}" -d "${body}")"
    echo "${resp}"
    python3 -c '
import json,sys
p=json.loads(sys.argv[1])
out={"id": p.get("id") or p.get("sandboxId"), "sandboxToken": p.get("sandboxToken") or p.get("token") or ""}
if not out["id"]:
    raise SystemExit("create response missing id")
open(sys.argv[2],"w").write(json.dumps(out, indent=2)+"\n")
print("wrote", sys.argv[2], "id="+out["id"])
' "${resp}" "${TOKEN_FILE}"
    ;;
  status)
    load_state
    mapfile -t AUTH < <(auth_args)
    curl -sS "${API}/api/sandboxes/${SANDBOX_ID}" "${AUTH[@]}"
    echo
    ;;
  cmd)
    load_state
    [[ $# -ge 1 ]] || { usage; exit 1; }
    command="$*"
    payload="$(python3 -c 'import json,sys; print(json.dumps({"command":sys.argv[1]}))' "${command}")"
    mapfile -t AUTH < <(auth_args)
    curl -sS "${API}/api/sandboxes/${SANDBOX_ID}/commands" \
      -H "Content-Type: application/json" "${AUTH[@]}" -d "${payload}"
    echo
    ;;
  delete)
    load_state
    mapfile -t AUTH < <(auth_args)
    curl -sS -X DELETE "${API}/api/sandboxes/${SANDBOX_ID}" "${AUTH[@]}"
    echo
    rm -f "${TOKEN_FILE}"
    ;;
  -h|--help|"")
    usage
    ;;
  *)
    usage
    exit 1
    ;;
esac
