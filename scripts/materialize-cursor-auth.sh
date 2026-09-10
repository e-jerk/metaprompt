#!/usr/bin/env bash
# Copy local Cursor CLI login into ~/.metaprompt/creds/cursor for k3s hostPath.
# Never prints credential values. Does not create a Kubernetes Secret.
set -euo pipefail

DEST="${METAPROMPT_CURSOR_CRED_DIR:-${HOME}/.metaprompt/creds/cursor}"
umask 077
mkdir -p "${DEST}"
chmod 700 "${DEST}"
export METAPROMPT_CURSOR_DEST="${DEST}"

copy_if_file() {
  local src="$1"
  local name="$2"
  if [[ -f "${src}" ]]; then
    cp "${src}" "${DEST}/${name}"
    chmod 600 "${DEST}/${name}"
    return 0
  fi
  return 1
}

copied=0
if copy_if_file "${HOME}/.cursor/auth.json" auth.json; then copied=1; fi
if copy_if_file "${HOME}/.config/cursor/auth.json" auth.json; then copied=1; fi
if copy_if_file "${HOME}/.cursor/sdk/auth.json" sdk-auth.json; then copied=1; fi

keychain_to_file() {
  local service="$1"
  local out="$2"
  if security find-generic-password -s "${service}" -a cursor-user -w >"${out}" 2>/dev/null \
    && [[ -s "${out}" ]]; then
    chmod 600 "${out}"
    return 0
  fi
  rm -f "${out}"
  return 1
}

if [[ "$(uname -s)" == "Darwin" ]]; then
  if keychain_to_file cursor-api-key "${DEST}/api-key"; then copied=1; fi
  keychain_to_file cursor-access-token "${DEST}/.access-token" || true
  keychain_to_file cursor-refresh-token "${DEST}/.refresh-token" || true
  python3 - <<'PY'
import json, os, sqlite3
from pathlib import Path

dest = Path(os.environ["METAPROMPT_CURSOR_DEST"])
out = {}
auth = dest / "auth.json"
if auth.is_file():
    try:
        out.update(json.loads(auth.read_text()))
    except json.JSONDecodeError:
        out = {}

# Cursor IDE login (not the CLI keychain). Write files only; never print values.
db = Path.home() / "Library/Application Support/Cursor/User/globalStorage/state.vscdb"
if db.is_file():
    con = sqlite3.connect(f"file:{db}?mode=ro&immutable=1", uri=True)
    rows = {k: v for k, v in con.execute("SELECT key, value FROM ItemTable")}
    con.close()
    interesting = []
    for key, raw in rows.items():
        lk = key.lower()
        if "cursorauth" in lk or key.endswith("/accessToken") or key.endswith("/refreshToken"):
            interesting.append(key)
            if not isinstance(raw, str) or not raw:
                continue
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = raw
            if isinstance(parsed, dict):
                for src, dst in (
                    ("accessToken", "accessToken"),
                    ("refreshToken", "refreshToken"),
                    ("apiKey", "apiKey"),
                    ("token", "accessToken"),
                ):
                    val = parsed.get(src)
                    if isinstance(val, str) and val:
                        out[dst] = val
            elif isinstance(parsed, str) and parsed:
                if "refresh" in lk:
                    out.setdefault("refreshToken", parsed)
                elif "api" in lk:
                    out.setdefault("apiKey", parsed)
                else:
                    out.setdefault("accessToken", parsed)
    if interesting:
        dest.joinpath(".ide-keys").write_text("\n".join(sorted(interesting)) + "\n", encoding="utf-8")
if out:
    auth.write_text(json.dumps(out), encoding="utf-8")
    auth.chmod(0o600)
PY
  # merge keychain scraps after IDE extract
  python3 - <<'PY'
import json, os
from pathlib import Path
dest = Path(os.environ["METAPROMPT_CURSOR_DEST"])
out = {}
auth = dest / "auth.json"
if auth.is_file():
    try:
        out.update(json.loads(auth.read_text()))
    except json.JSONDecodeError:
        out = {}
for src, key in (
    (dest / "api-key", "apiKey"),
    (dest / ".access-token", "accessToken"),
    (dest / ".refresh-token", "refreshToken"),
):
    if src.is_file():
        val = src.read_text().strip()
        if val:
            out[key] = val
if out:
    auth.write_text(json.dumps(out), encoding="utf-8")
    auth.chmod(0o600)
PY
  if [[ -f "${DEST}/auth.json" || -f "${DEST}/api-key" ]]; then copied=1; fi
  rm -f "${DEST}/.access-token" "${DEST}/.refresh-token"
fi

if [[ ! -f "${DEST}/auth.json" && ! -f "${DEST}/api-key" ]]; then
  echo "No local Cursor CLI login found. Run: AGENT_CLI_CREDENTIAL_STORE=file agent login" >&2
  echo "Expected files under ${DEST}" >&2
  exit 2
fi

echo "Cursor creds ready at ${DEST} (filenames only):"
ls -l "${DEST}" | awk '{print $1, $NF}'
