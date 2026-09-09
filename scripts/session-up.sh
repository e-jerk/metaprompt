#!/usr/bin/env bash
# Create a root-level exec session and print the kubectl attach command.
set -euo pipefail
NS="${METAPROMPT_NAMESPACE:-metaprompt}"
TOKEN="${METAPROMPT_TOKEN:-alice-token}"
HARNESS="${1:-session}"
LOCAL_PORT="${METAPROMPT_LOCAL_PORT:-3333}"
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"

python3 - "$TOKEN" "$HARNESS" <<'PY'
import json, os, sys, urllib.request
token, harness = sys.argv[1], sys.argv[2]
url = os.environ.get("MCP_URL", f"http://127.0.0.1:{os.environ.get('METAPROMPT_LOCAL_PORT', '3333')}/mcp")
body = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
        "name": "session.create",
        "arguments": {"harness": harness, "repo": "app", "storage": "pvc"},
    },
}
req = urllib.request.Request(
    url,
    data=json.dumps(body).encode(),
    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req) as r:
    out = json.load(r)
if "error" in out:
    raise SystemExit(out["error"])
result = json.loads(out["result"]["content"][0]["text"])
print(json.dumps(result, indent=2))
print()
print(result["attach"]["command"])
print("# shell:")
print(result["shell"]["command"])
print("# then:  /workspace/.mp/attach opencode | cursor | claude | codex | shell")
PY
