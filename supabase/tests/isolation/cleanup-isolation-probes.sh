#!/usr/bin/env bash
# Removes everything seed-isolation-probes.sh creates. Safe to run any time —
# idempotent, no-ops cleanly if nothing is left to clean. Not run
# automatically by CI; run manually or on a schedule if probe data
# shouldn't linger in prod between runs.
#
# Required env: REST_BASE, SUPABASE_SERVICE_ROLE_KEY,
#                PROBE_ORG_A_EMAIL, PROBE_ORG_B_EMAIL

set -euo pipefail

USAGE="Usage: REST_BASE=... SUPABASE_SERVICE_ROLE_KEY=... PROBE_ORG_A_EMAIL=... PROBE_ORG_B_EMAIL=... $0"

: "${REST_BASE:?not set — $USAGE}"
: "${SUPABASE_SERVICE_ROLE_KEY:?not set — $USAGE}"
: "${PROBE_ORG_A_EMAIL:?not set — $USAGE}"
: "${PROBE_ORG_B_EMAIL:?not set — $USAGE}"

ORG_A_NAME="isolation-probe-org-a"
ORG_B_NAME="isolation-probe-org-b"

command -v curl >/dev/null 2>&1 || { echo "FAIL: curl is required but not found on PATH" >&2; exit 1; }
command -v jq   >/dev/null 2>&1 || { echo "FAIL: jq is required but not found on PATH"   >&2; exit 1; }

TMP_BODY="$(mktemp)"
trap 'rm -f "$TMP_BODY"' EXIT

info() { echo "INFO: $1" >&2; }
pass() { echo "PASS: $1"; }

sr_get() {
  curl -sS -o "$TMP_BODY" -w '%{http_code}' -X GET "$1" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}"
}
sr_delete() {
  curl -sS -o "$TMP_BODY" -w '%{http_code}' -X DELETE "$1" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Prefer: return=representation"
}

delete_user_by_email() {
  local email="$1" page=1 per_page=200 status user_id
  while :; do
    status=$(sr_get "${REST_BASE}/auth/v1/admin/users?page=${page}&per_page=${per_page}")
    [[ "$status" == "200" ]] || { info "list users (page ${page}) returned ${status}, stopping search for ${email}"; return; }
    user_id=$(jq -r --arg email "$email" '.users[] | select((.email // "") | ascii_downcase == ($email | ascii_downcase)) | .id' "$TMP_BODY" | head -n1)
    if [[ -n "$user_id" ]]; then
      local del_status
      del_status=$(curl -sS -o "$TMP_BODY" -w '%{http_code}' -X DELETE "${REST_BASE}/auth/v1/admin/users/${user_id}" \
        -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}")
      [[ "$del_status" == "200" ]] && pass "deleted probe user ${email} (${user_id})" || info "delete ${email} (${user_id}) returned ${del_status}"
      return
    fi
    local count; count=$(jq -r '.users | length' "$TMP_BODY")
    [[ "$count" -ge "$per_page" ]] || { info "probe user ${email} not found — already clean"; return; }
    page=$((page + 1))
  done
}

echo "== deleting agent_memory_chunks rows for probe orgs =="
for name in "$ORG_A_NAME" "$ORG_B_NAME"; do
  status=$(sr_get "${REST_BASE}/rest/v1/organizations?name=eq.${name}&select=id")
  org_id=$(jq -r '.[0].id // empty' "$TMP_BODY")
  if [[ -n "$org_id" ]]; then
    del_status=$(sr_delete "${REST_BASE}/rest/v1/agent_memory_chunks?org_id=eq.${org_id}")
    rows=$(jq -r 'length // 0' "$TMP_BODY" 2>/dev/null || echo 0)
    info "deleted ${rows} agent_memory_chunks row(s) for ${name} (HTTP ${del_status})"
  fi
done

echo "== deleting probe users (cascades their profiles row via ON DELETE CASCADE) =="
delete_user_by_email "$PROBE_ORG_A_EMAIL"
delete_user_by_email "$PROBE_ORG_B_EMAIL"

echo "== deleting probe organizations =="
for name in "$ORG_A_NAME" "$ORG_B_NAME"; do
  del_status=$(sr_delete "${REST_BASE}/rest/v1/organizations?name=eq.${name}")
  rows=$(jq -r 'length // 0' "$TMP_BODY" 2>/dev/null || echo 0)
  [[ "$rows" -gt 0 ]] && pass "deleted org ${name}" || info "org ${name} not found — already clean"
done

echo "== cleanup-isolation-probes.sh: done =="
