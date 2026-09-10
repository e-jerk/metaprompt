#!/usr/bin/env bash
# Live smoke against a bootstrapped local cluster (Apple container k8s, k3c, or k3d).
# Layer 2 (HTTP plane) + layer 3 (Jobs: tmpfs, PVC, share, kill, spawn, memory, prefix).
set -euo pipefail
NS="${METAPROMPT_NAMESPACE:-metaprompt}"
TOKEN="${METAPROMPT_TOKEN:-alice-token}"
LOCAL_PORT="${METAPROMPT_LOCAL_PORT:-3333}"
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"
export MCP_URL="http://127.0.0.1:${LOCAL_PORT}/mcp"

need() { command -v "$1" >/dev/null || { echo "missing $1" >&2; exit 1; }; }
need kubectl
need curl
need python3

kubectl -n "${NS}" rollout status deploy/metaprompt-mcp --timeout=180s
if kubectl -n "${NS}" get sts metaprompt-postgres >/dev/null 2>&1; then
  kubectl -n "${NS}" rollout status sts/metaprompt-postgres --timeout=180s
fi

PF_PID=""
cleanup() { [[ -n "${PF_PID}" ]] && kill "${PF_PID}" >/dev/null 2>&1 || true; }
trap cleanup EXIT
if ! curl -sf "http://127.0.0.1:${LOCAL_PORT}/healthz" >/dev/null; then
  PF_LOG="$(mktemp)"
  kubectl -n "${NS}" port-forward svc/metaprompt-mcp "${LOCAL_PORT}:3333" >"${PF_LOG}" 2>&1 &
  PF_PID=$!
  for _ in $(seq 1 30); do
    if curl -sf "http://127.0.0.1:${LOCAL_PORT}/healthz" >/dev/null; then
      break
    fi
    sleep 1
  done
fi
curl -sf "http://127.0.0.1:${LOCAL_PORT}/healthz" | grep -q '"ok":true'
echo "healthz ok"

call() {
  local token="$1" name="$2" args="${3-}"
  if [[ -z "${args}" ]]; then args='{}'; fi
  python3 - "$token" "$name" "$args" <<'PY'
import json, os, sys, urllib.error, urllib.request
token, name, raw = sys.argv[1], sys.argv[2], sys.argv[3]
args = json.loads(raw)
req = urllib.request.Request(
    os.environ["MCP_URL"],
    data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args}}).encode(),
    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    method="POST",
)
try:
    with urllib.request.urlopen(req) as r:
        body = json.load(r)
        status = r.status
except urllib.error.HTTPError as e:
    body = json.loads(e.read().decode())
    status = e.code
if "error" in body:
    err = body["error"]
    raise SystemExit(f"{name} failed ({status}): {err.get('message', err)}")
print(body["result"]["content"][0]["text"])
PY
}

wait_status() {
  local token="$1" run_id="$2" want="${3:-succeeded}" tries="${4:-60}"
  local status=""
  for _ in $(seq 1 "${tries}"); do
    status="$(call "${token}" run.get "{\"runId\":\"${run_id}\"}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')"
    echo "  run.get ${run_id} status=${status}"
    if [[ "${status}" == "succeeded" || "${status}" == "failed" || "${status}" == "cancelled" ]]; then
      break
    fi
    sleep 2
  done
  if [[ "${status}" != "${want}" ]]; then
    echo "Run ${run_id} wanted ${want} got ${status}" >&2
    kubectl -n "${NS}" get jobs,pods,pvc -o wide >&2 || true
    kubectl -n "${NS}" logs -l "metaprompt/run=${run_id}" --tail=80 >&2 || true
    kubectl -n "${NS}" logs deploy/metaprompt-mcp --tail=80 >&2 || true
    exit 1
  fi
}

wait_job() {
  local run_id="$1"
  local job=""
  for _ in $(seq 1 40); do
    job="$(kubectl -n "${NS}" get jobs -l "metaprompt/run=${run_id}" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
    if [[ -n "${job}" ]]; then
      echo "  Job: ${job}" >&2
      echo "${job}"
      return 0
    fi
    sleep 1
  done
  echo "No Kubernetes Job for ${run_id}" >&2
  kubectl -n "${NS}" get jobs,pods -o wide >&2 || true
  kubectl -n "${NS}" logs deploy/metaprompt-mcp --tail=80 >&2 || true
  exit 1
}

# --- Layer 2: HTTP plane ---
LIST="$(curl -sS "${MCP_URL}" -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')"
echo "${LIST}" | grep -q 'run.create'
echo "${LIST}" | grep -q 'memory.put'
echo "tools/list ok"

for tool in harness.list harness.get model.list skill.list mcp.list repo.list asset.list; do
  args="{}"
  [[ "${tool}" == "harness.get" ]] && args='{"name":"stub"}'
  call "${TOKEN}" "${tool}" "${args}" >/dev/null
done
call "${TOKEN}" mcp.list | python3 -c 'import json,sys; names=[m["name"] for m in json.load(sys.stdin)]; assert "clanker" not in names'
echo "catalog ok"

NOAUTH="$(curl -sS -o /tmp/mcp-noauth -w "%{http_code}" "${MCP_URL}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')"
[[ "${NOAUTH}" == "401" ]]
echo "missing bearer 401 ok"

set +e
SPAWN_HUMAN="$(call "${TOKEN}" job.spawn '{"agents":[{"harness":"stub","prompt":"x"}]}' 2>&1)"
set -e
echo "${SPAWN_HUMAN}" | grep -Eq 'run token|400'
echo "job.spawn as human rejected"

set +e
CLANKER="$(call "${TOKEN}" run.create '{"harness":"stub","repo":"app","mcpServers":[{"name":"clanker"}]}' 2>&1)"
set -e
echo "${CLANKER}" | grep -Eq 'parent-only|400'
echo "clanker parent-only ok"

PARTY="$(call "${TOKEN}" party.create)"
PARTY_ID="$(echo "${PARTY}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
call "${TOKEN}" coord.post "{\"partyId\":\"${PARTY_ID}\",\"body\":\"hello\"}" >/dev/null
call "${TOKEN}" coord.inbox "{\"partyId\":\"${PARTY_ID}\"}" | python3 -c 'import json,sys; assert any(e.get("type")=="post" for e in json.load(sys.stdin))'
call "${TOKEN}" coord.barrier "{\"partyId\":\"${PARTY_ID}\"}" >/dev/null
call "${TOKEN}" coord.handoff "{\"partyId\":\"${PARTY_ID}\",\"harness\":\"stub\",\"prompt\":\"handoff\",\"message\":\"next\",\"storage\":\"tmpfs\"}" >/dev/null
call "${TOKEN}" coord.artifact.put "{\"partyId\":\"${PARTY_ID}\",\"name\":\"note\",\"bytes\":\"abc\"}" >/dev/null
call "${TOKEN}" coord.artifact.get "{\"partyId\":\"${PARTY_ID}\",\"name\":\"note\"}" | python3 -c 'import json,sys; assert json.load(sys.stdin)["bytes"]=="abc"'
call "${TOKEN}" coord.wait "{\"partyId\":\"${PARTY_ID}\"}" | python3 -c 'import json,sys; assert json.load(sys.stdin)=={"ok":True}'
echo "party ok"

CRON_NAME="smoke-cron-$$"
call "${TOKEN}" cron.create "{\"name\":\"${CRON_NAME}\",\"schedule\":\"0 2 * * *\",\"harness\":\"stub\",\"repo\":\"app\",\"prompt\":\"cron\",\"storage\":\"tmpfs\",\"concurrencyPolicy\":\"Forbid\"}" >/dev/null
call bob-token cron.list | python3 -c 'import json,sys; assert json.load(sys.stdin)==[]'
call "${TOKEN}" cron.delete "{\"name\":\"${CRON_NAME}\"}" >/dev/null
echo "cron ok"

# --- Layer 3: live Jobs ---
CREATED="$(call "${TOKEN}" run.create '{"harness":"stub","repo":"app","prompt":"cluster smoke","storage":"tmpfs"}')"
echo "${CREATED}"
RUN_ID="$(echo "${CREATED}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
echo "created tmpfs ${RUN_ID}"
JOB="$(wait_job "${RUN_ID}")"
wait_status "${TOKEN}" "${RUN_ID}" succeeded
call "${TOKEN}" run.logs "{\"runId\":\"${RUN_ID}\"}" | python3 -c 'import json,sys; logs=json.load(sys.stdin); assert any("stub start" in l.get("chunk","") for lines in logs.values() for l in lines)'
kubectl -n "${NS}" logs -l "metaprompt/run=${RUN_ID}" --tail=40 | grep -q "stub start" \
  || echo "warn: kubectl logs missing stub start (plane logs ok)" >&2
echo "tmpfs Job logs ok"

# ACL deny then share
set +e
BOB_DENY="$(call bob-token run.get "{\"runId\":\"${RUN_ID}\"}" 2>&1)"
set -e
echo "${BOB_DENY}" | grep -Eq 'cannot read|403'
call "${TOKEN}" run.share "{\"runId\":\"${RUN_ID}\",\"subjects\":[\"user:bob\"]}" >/dev/null
call bob-token run.get "{\"runId\":\"${RUN_ID}\"}" | python3 -c 'import json,sys; assert json.load(sys.stdin)["id"]'
call bob-token run.logs "{\"runId\":\"${RUN_ID}\"}" >/dev/null
echo "share ACL ok"

# PVC lifecycle
PVC_RUN="$(call "${TOKEN}" run.create '{"harness":"stub","repo":"app","prompt":"pvc smoke","storage":"pvc"}')"
PVC_ID="$(echo "${PVC_RUN}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
echo "created pvc ${PVC_ID}"
wait_job "${PVC_ID}" >/dev/null
PVC_NAME=""
for _ in $(seq 1 30); do
  PVC_NAME="$(kubectl -n "${NS}" get pvc -l "metaprompt/run=${PVC_ID}" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [[ -n "${PVC_NAME}" ]]; then
    echo "  PVC: ${PVC_NAME}"
    break
  fi
  sleep 1
done
[[ -n "${PVC_NAME}" ]]
wait_status "${TOKEN}" "${PVC_ID}" succeeded
call "${TOKEN}" run.get "{\"runId\":\"${PVC_ID}\"}" | python3 -c 'import json,sys; r=json.load(sys.stdin); assert r.get("pvcDeleted") is True, r'
PVC_PHASE="$(kubectl -n "${NS}" get pvc -l "metaprompt/run=${PVC_ID}" -o jsonpath='{.items[0].status.phase}' 2>/dev/null || true)"
# Plane issues the PVC delete on terminal. The Job pod keeps the volume mounted until
# ttlSecondsAfterFinished, so the claim may stay Bound or Terminating for a few minutes.
if [[ -n "${PVC_PHASE}" && "${PVC_PHASE}" != "Terminating" && "${PVC_PHASE}" != "Bound" ]]; then
  echo "PVC ${PVC_NAME} unexpected phase ${PVC_PHASE} after terminal" >&2
  exit 1
fi
echo "PVC created and deleted ok"

# Kill a running stub; waiter unblocks
KILL_RUN="$(call "${TOKEN}" run.create '{"harness":"stub","repo":"app","prompt":"sleep:90","storage":"tmpfs"}')"
KILL_ID="$(echo "${KILL_RUN}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
wait_job "${KILL_ID}" >/dev/null
WAIT_OUT="$(mktemp)"
call "${TOKEN}" run.wait "{\"runId\":\"${KILL_ID}\"}" >"${WAIT_OUT}" &
WAIT_PID=$!
sleep 2
call "${TOKEN}" run.kill "{\"runId\":\"${KILL_ID}\",\"reason\":\"smoke-kill\"}" >/dev/null
wait "${WAIT_PID}"
python3 -c 'import json,sys; r=json.load(open(sys.argv[1])); assert r["status"]=="cancelled"' "${WAIT_OUT}"
wait_status "${TOKEN}" "${KILL_ID}" cancelled 20
echo "kill + waiter ok"

# Spawn DAG via stub verb
SPAWN_RUN="$(call "${TOKEN}" run.create '{"harness":"stub","repo":"app","prompt":"spawn:a,b","storage":"tmpfs"}')"
SPAWN_ID="$(echo "${SPAWN_RUN}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
wait_job "${SPAWN_ID}" >/dev/null
wait_status "${TOKEN}" "${SPAWN_ID}" succeeded 90
RESULT="$(call "${TOKEN}" run.result "{\"runId\":\"${SPAWN_ID}\"}")"
echo "${RESULT}"
echo "${RESULT}" | python3 -c 'import json,sys; r=json.load(sys.stdin); assert len(r["children"])==2; assert "grandchild" not in json.dumps(r)'
CHILD_JOBS="$(kubectl -n "${NS}" get jobs -l "metaprompt/parent=${SPAWN_ID}" -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}')"
echo "${CHILD_JOBS}" | awk 'NF' | wc -l | grep -Eq '[2-9]'
echo "spawn rollup ok"

# Memory scopes + Job put/search
USER_MEM="$(call "${TOKEN}" memory.put '{"scope":"user","text":"alice user smoke memory phrase"}')"
USER_MEM_ID="$(echo "${USER_MEM}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
PARTY_MEM="$(call "${TOKEN}" memory.put "{\"scope\":\"party\",\"partyId\":\"${PARTY_ID}\",\"text\":\"alice party smoke memory phrase\"}")"
call "${TOKEN}" memory.put '{"scope":"repo","repo":"app","text":"alice repo smoke memory phrase"}' >/dev/null
call "${TOKEN}" memory.search '{"query":"alice user smoke memory phrase","scope":"user"}' \
  | python3 -c 'import json,sys; hits=json.load(sys.stdin); assert hits and hits[0]["id"]==sys.argv[1]' "${USER_MEM_ID}"
set +e
BOB_MEM="$(call bob-token memory.get "{\"id\":\"${USER_MEM_ID}\"}" 2>&1)"
set -e
echo "${BOB_MEM}" | grep -Eq 'cannot read|403'
call "${TOKEN}" party.add "{\"partyId\":\"${PARTY_ID}\",\"subject\":\"user:bob\",\"role\":\"member\"}" >/dev/null
call bob-token memory.search "{\"query\":\"alice party smoke memory phrase\",\"scope\":\"party\",\"partyId\":\"${PARTY_ID}\"}" \
  | python3 -c 'import json,sys; assert json.load(sys.stdin)'
JOB_MEM="$(call "${TOKEN}" run.create '{"harness":"stub","repo":"app","prompt":"memory:job-owned smoke phrase","storage":"tmpfs"}')"
JOB_MEM_ID="$(echo "${JOB_MEM}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
wait_job "${JOB_MEM_ID}" >/dev/null
wait_status "${TOKEN}" "${JOB_MEM_ID}" succeeded
call "${TOKEN}" memory.search '{"query":"job-owned smoke phrase","scope":"user"}' \
  | python3 -c 'import json,sys; hits=json.load(sys.stdin); assert any("job-owned" in h.get("text","") for h in hits)'
JOB_ENV="$(kubectl -n "${NS}" get pods -l "metaprompt/run=${JOB_MEM_ID}" -o jsonpath='{.items[0].spec.containers[0].env[*].name}' 2>/dev/null || true)"
echo "${JOB_ENV}" | grep -vq DATABASE_URL || [[ -z "${JOB_ENV}" ]]
echo "memory scopes + Job ok"

# Prefix hash shared across identical stub runs
A="$(call "${TOKEN}" run.create '{"harness":"stub","repo":"app","prompt":"prefix-smoke","storage":"tmpfs"}')"
B="$(call "${TOKEN}" run.create '{"harness":"stub","repo":"app","prompt":"prefix-smoke","storage":"tmpfs"}')"
AID="$(echo "${A}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
BID="$(echo "${B}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
HA="$(echo "${A}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["prefixHash"])')"
HB="$(echo "${B}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["prefixHash"])')"
[[ "${HA}" == "${HB}" && -n "${HA}" ]]
wait_status "${TOKEN}" "${AID}" succeeded
wait_status "${TOKEN}" "${BID}" succeeded
echo "prefix hash ok (${HA})"

# mint: ACL + no PAT on run record
MINT="$(call "${TOKEN}" vcs.cred.mint "{\"repo\":\"app\",\"op\":\"push\",\"runId\":\"${RUN_ID}\"}")"
echo "${MINT}" | python3 -c 'import json,sys; r=json.load(sys.stdin); assert r["ephemeral"] is True'
call "${TOKEN}" run.get "{\"runId\":\"${RUN_ID}\"}" | python3 -c 'import json,sys; s=json.dumps(json.load(sys.stdin)); assert "fake-pat" not in s and "local-dev-memory" not in s'
echo "mint ok"

echo "Cluster smoke passed (tmpfs ${RUN_ID} Job ${JOB})"
