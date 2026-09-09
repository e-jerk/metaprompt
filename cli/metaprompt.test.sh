#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="${ROOT}/cli/metaprompt"
fail() { printf 'FAIL %s\n' "$*" >&2; exit 1; }

bash -n "${CLI}"
[[ -x "${CLI}" ]] || chmod +x "${CLI}"

out="$("${CLI}" version)"
echo "${out}" | grep -q 'metaprompt 0.1.0' || fail "version: ${out}"
echo "${out}" | grep -q "${ROOT}" || fail "version should report checkout share"

"${CLI}" help | grep -q 'brew install' || fail "help missing brew"
"${CLI}" --help | grep -q 'Cluster' || fail "--help"

set +e
"${CLI}" >/tmp/mp-cli-nousage 2>&1
code=$?
set -e
[[ "${code}" -eq 2 ]] || fail "no-args exit ${code}"
grep -q 'Usage:' /tmp/mp-cli-nousage || fail "no-args usage"

set +e
"${CLI}" nope >/tmp/mp-cli-nope 2>&1
code=$?
set -e
[[ "${code}" -ne 0 ]] || fail "unknown command should fail"
grep -q 'unknown command' /tmp/mp-cli-nope || fail "unknown command message"

dry="$("${CLI}" call --dry-run harness.list)"
echo "${dry}" | python3 -c 'import json,sys; b=json.load(sys.stdin); assert b["method"]=="tools/call"; assert b["params"]["name"]=="harness.list"; assert b["params"]["arguments"]=={}'

dry="$("${CLI}" call --dry-run run.create '{"harness":"stub","repo":"app"}')"
echo "${dry}" | python3 -c 'import json,sys; b=json.load(sys.stdin); assert b["params"]["arguments"]["harness"]=="stub"'
echo "${dry}" | grep -viq 'alice-token' || fail "dry-run leaked token"
echo "${dry}" | grep -viq 'Bearer' || fail "dry-run leaked bearer"

dry="$("${CLI}" run --dry-run create --harness stub --repo app --prompt 'cluster smoke' --storage tmpfs)"
echo "${dry}" | python3 -c 'import json,sys; a=json.load(sys.stdin)["params"]["arguments"]; assert a=={"harness":"stub","repo":"app","prompt":"cluster smoke","storage":"tmpfs"}'
dry="$("${CLI}" run create --harness stub --dry-run --repo app)"
echo "${dry}" | python3 -c 'import json,sys; assert json.load(sys.stdin)["params"]["arguments"]["harness"]=="stub"'

dry="$("${CLI}" run --dry-run get run-abc)"
echo "${dry}" | python3 -c 'import json,sys; a=json.load(sys.stdin)["params"]; assert a["name"]=="run.get"; assert a["arguments"]=={"runId":"run-abc"}'

dry="$("${CLI}" tools --dry-run)"
echo "${dry}" | python3 -c 'import json,sys; assert json.load(sys.stdin)["method"]=="tools/list"'

sess="$("${CLI}" session --dry-run opencode)"
echo "${sess}" | python3 -c 'import json,sys; a=json.load(sys.stdin); assert a["harness"]=="opencode"; assert a["repo"]=="app"'

eng="$("${CLI}" version)"
echo "${eng}" | grep -Eq 'runtime (docker|container|native)' || fail "version runtime: ${eng}"

wrap="$("${CLI}" up --dry-run)"
echo "${wrap}" | grep -Eq '^(docker|container) ' || fail "up --dry-run: ${wrap}"
echo "${wrap}" | grep -q 'ghcr.io/e-jerk/metaprompt/cli' || fail "up --dry-run missing cli image"
echo "${wrap}" | grep -viq 'alice-token' || fail "up --dry-run leaked token"

byo="$("${CLI}" install --dry-run eks)"
echo "${byo}" | grep -Eq '^(docker|container) ' || fail "install --dry-run: ${byo}"
echo "${byo}" | grep -q 'install' || fail "install --dry-run missing install"

set +e
METAPROMPT_ENGINE=native "${CLI}" up >/tmp/mp-cli-native 2>&1
code=$?
set -e
[[ "${code}" -ne 0 ]] || fail "native up should refuse without METAPROMPT_NATIVE=1"
grep -q 'METAPROMPT_NATIVE=1' /tmp/mp-cli-native || fail "native up should mention METAPROMPT_NATIVE"

set +e
METAPROMPT_NATIVE=1 METAPROMPT_HOME=/tmp/metaprompt-missing-$$ "${CLI}" install k3s >/tmp/mp-cli-home 2>&1
code=$?
set -e
[[ "${code}" -ne 0 ]] || fail "install with missing HOME should fail"
grep -q 'brew install' /tmp/mp-cli-home || fail "missing home should mention brew"

# Must not require a cluster or print tokens
if [[ -n "${METAPROMPT_TOKEN:-}" ]]; then
  fail "test environment should not export METAPROMPT_TOKEN"
fi

echo "cli ok"
