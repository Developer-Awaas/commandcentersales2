#!/usr/bin/env bash
# Seeds two throwaway orgs + two non-admin probe users for the WS1.6
# isolation harness (agent_memory_chunks + related org-scoped tables).
# TEST-only in spirit, but runs against the ONLY Supabase project this repo
# has (CommandCentre_Prod, ref mpvdpdxzqnidwyihyhbn) — there is no separate
# TEST project (decided 2026-07-21: "run against prod, carefully"). Every
# row this script creates is prefixed "isolation-probe-" so it's always
# identifiable and can be cleaned up with cleanup-isolation-probes.sh.
#
# Why service-role REST calls (not a direct DB connection, unlike
# awaas-suite's equivalent script): service_role bypasses RLS normally via
# PostgREST here — no table-level GRANT restriction like praveshika has.
# organizations has no INSERT policy for `authenticated` at all (verified:
# migration 20260610150000 scoped SELECT/UPDATE but never re-added INSERT
# after dropping the old open one) — so org creation is already
# service-role-only in this schema, same mechanism this script uses.
#
# Why profiles.org_id needs a service-role UPDATE, not a client insert:
# handle_new_user() auto-creates a profiles row with org_id=NULL on signup
# (20260409085002_create_profiles_table.sql), and
# prevent_self_privilege_escalation() (20260610150000) blocks a user from
# changing their own org_id via the client. Service-role UPDATE bypasses
# both — auth.uid() is NULL under service-role, so the escalation trigger's
# `NEW.id = auth.uid()` guard never fires.
#
# Idempotent: orgs looked up by name before insert; probe users looked up
# by email before create (password/confirmation re-asserted every run);
# profiles.org_id re-asserted every run; the org B seed row in
# agent_memory_chunks is looked up by content before insert.
#
# Required env (see .env.isolation.local):
#   REST_BASE                 e.g. https://mpvdpdxzqnidwyihyhbn.supabase.co
#   ANON_KEY                  anon/publishable key
#   SUPABASE_SERVICE_ROLE_KEY service-role key (org/profile seeding only,
#                              never used against agent_memory_chunks itself —
#                              that table is seeded via org B's own JWT)
#   PROBE_ORG_A_EMAIL / PROBE_ORG_A_PASSWORD
#   PROBE_ORG_B_EMAIL / PROBE_ORG_B_PASSWORD

set -euo pipefail

USAGE="Usage: REST_BASE=... ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... PROBE_ORG_A_EMAIL=... PROBE_ORG_A_PASSWORD=... PROBE_ORG_B_EMAIL=... PROBE_ORG_B_PASSWORD=... $0"

: "${REST_BASE:?not set — $USAGE}"
: "${ANON_KEY:?not set — $USAGE}"
: "${SUPABASE_SERVICE_ROLE_KEY:?not set — $USAGE}"
: "${PROBE_ORG_A_EMAIL:?not set — $USAGE}"
: "${PROBE_ORG_A_PASSWORD:?not set — $USAGE}"
: "${PROBE_ORG_B_EMAIL:?not set — $USAGE}"
: "${PROBE_ORG_B_PASSWORD:?not set — $USAGE}"

ORG_A_NAME="isolation-probe-org-a"
ORG_B_NAME="isolation-probe-org-b"
SEED_CHUNK_CONTENT="isolation-probe seed chunk (org B) — do not delete manually, see seed-isolation-probes.sh"

command -v curl >/dev/null 2>&1 || { echo "FAIL: curl is required but not found on PATH" >&2; exit 1; }
command -v jq   >/dev/null 2>&1 || { echo "FAIL: jq is required but not found on PATH"   >&2; exit 1; }

TMP_BODY="$(mktemp)"
TMP_REQ="$(mktemp)"
trap 'rm -f "$TMP_BODY" "$TMP_REQ"' EXIT

fail() { echo "FAIL: $1" >&2; exit 1; }
pass() { echo "PASS: $1"; }
info() { echo "INFO: $1" >&2; }

# Request bodies are always written to a file and sent via --data-binary
# @file, never inline as a curl -d "$var" argument. On Windows Git Bash,
# passing a JSON string containing multi-byte UTF-8 (e.g. an em-dash)
# through argv corrupts the bytes silently — PostgREST then rejects the
# mangled body with a generic "Empty or invalid json" (PGRST102). Writing
# to a file with printf and reading it back with --data-binary is
# byte-exact regardless of platform/locale.
http() {
  local method="$1" url="$2" token="$3" body="${4:-}"
  shift $(( $# >= 4 ? 4 : 3 ))
  if [[ -n "$body" ]]; then
    printf '%s' "$body" > "$TMP_REQ"
    curl -sS -o "$TMP_BODY" -w '%{http_code}' -X "$method" "$url" \
      -H "Authorization: Bearer $token" -H "apikey: $token" -H "Content-Type: application/json" \
      -H "Prefer: return=representation" "$@" --data-binary "@$TMP_REQ"
  else
    curl -sS -o "$TMP_BODY" -w '%{http_code}' -X "$method" "$url" \
      -H "Authorization: Bearer $token" -H "apikey: $token" "$@"
  fi
}

mint_password_jwt() {
  local email="$1" password="$2" body status
  body=$(jq -nc --arg email "$email" --arg pw "$password" '{email:$email, password:$pw}')
  printf '%s' "$body" > "$TMP_REQ"
  status=$(curl -sS -o "$TMP_BODY" -w '%{http_code}' -X POST "${REST_BASE}/auth/v1/token?grant_type=password" \
    -H "apikey: ${ANON_KEY}" -H "Content-Type: application/json" --data-binary "@$TMP_REQ")
  [[ "$status" == "200" ]] || fail "password-grant sign-in for ${email} expected HTTP 200, got ${status}: $(cat "$TMP_BODY")"
  jq -r '.access_token' "$TMP_BODY"
}

echo "== provisioning org A and org B (service-role, direct organizations insert) =="

ensure_org() {
  local name="$1" status org_id
  status=$(http GET "${REST_BASE}/rest/v1/organizations?name=eq.${name}&select=id" "$SUPABASE_SERVICE_ROLE_KEY")
  [[ "$status" == "200" ]] || fail "lookup org '${name}' expected HTTP 200, got ${status}: $(cat "$TMP_BODY")"
  org_id=$(jq -r '.[0].id // empty' "$TMP_BODY")
  if [[ -n "$org_id" ]]; then
    printf '%s' "$org_id"
    return 0
  fi
  local body
  body=$(jq -nc --arg name "$name" '{name:$name}')
  status=$(http POST "${REST_BASE}/rest/v1/organizations" "$SUPABASE_SERVICE_ROLE_KEY" "$body")
  [[ "$status" == "201" ]] || fail "create org '${name}' expected HTTP 201, got ${status}: $(cat "$TMP_BODY")"
  org_id=$(jq -r '.[0].id' "$TMP_BODY")
  [[ -n "$org_id" && "$org_id" != "null" ]] || fail "create org '${name}' returned no id: $(cat "$TMP_BODY")"
  printf '%s' "$org_id"
}

ORG_A_ID="$(ensure_org "$ORG_A_NAME")"
pass "org A provisioned/confirmed: org_id=${ORG_A_ID}"
ORG_B_ID="$(ensure_org "$ORG_B_NAME")"
pass "org B provisioned/confirmed: org_id=${ORG_B_ID}"

echo "== creating/confirming probe users via GoTrue admin API (service-role, auth schema only) =="

find_user_by_email() {
  local email="$1" page=1 per_page=200 status
  while :; do
    status=$(http GET "${REST_BASE}/auth/v1/admin/users?page=${page}&per_page=${per_page}" "$SUPABASE_SERVICE_ROLE_KEY")
    [[ "$status" == "200" ]] || fail "list users (page ${page}) expected HTTP 200, got ${status}: $(cat "$TMP_BODY")"
    local match
    match=$(jq -r --arg email "$email" '.users[] | select((.email // "") | ascii_downcase == ($email | ascii_downcase)) | .id' "$TMP_BODY" | head -n1)
    if [[ -n "$match" ]]; then printf '%s' "$match"; return 0; fi
    local count; count=$(jq -r '.users | length' "$TMP_BODY")
    [[ "$count" -ge "$per_page" ]] || return 1
    page=$((page + 1))
  done
}

ensure_probe_user() {
  local email="$1" password="$2" status user_id body
  body=$(jq -nc --arg email "$email" --arg pw "$password" '{email:$email, password:$pw, email_confirm:true}')
  status=$(http POST "${REST_BASE}/auth/v1/admin/users" "$SUPABASE_SERVICE_ROLE_KEY" "$body")
  if [[ "$status" == "200" || "$status" == "201" ]]; then
    user_id=$(jq -r '.id' "$TMP_BODY")
    info "probe user ${email} created (user_id=${user_id})"
    printf '%s' "$user_id"
    return 0
  fi
  user_id="$(find_user_by_email "$email")" || fail "create ${email} failed (HTTP ${status}: $(cat "$TMP_BODY")) and no existing user found"
  local patch_body patch_status
  patch_body=$(jq -nc --arg pw "$password" '{password:$pw, email_confirm:true}')
  printf '%s' "$patch_body" > "$TMP_REQ"
  patch_status=$(curl -sS -o "$TMP_BODY" -w '%{http_code}' -X PUT "${REST_BASE}/auth/v1/admin/users/${user_id}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" --data-binary "@$TMP_REQ")
  [[ "$patch_status" == "200" ]] || fail "reassert password for ${email} (${user_id}) expected HTTP 200, got ${patch_status}: $(cat "$TMP_BODY")"
  info "probe user ${email} already existed (user_id=${user_id}); password/confirmation reasserted"
  printf '%s' "$user_id"
}

PROBE_A_USER_ID="$(ensure_probe_user "$PROBE_ORG_A_EMAIL" "$PROBE_ORG_A_PASSWORD")"
pass "org A probe user ready: ${PROBE_ORG_A_EMAIL} (${PROBE_A_USER_ID})"
PROBE_B_USER_ID="$(ensure_probe_user "$PROBE_ORG_B_EMAIL" "$PROBE_ORG_B_PASSWORD")"
pass "org B probe user ready: ${PROBE_ORG_B_EMAIL} (${PROBE_B_USER_ID})"

echo "== assigning profiles.org_id (service-role UPDATE — bypasses the self-escalation trigger by design) =="

assign_org() {
  local user_id="$1" org_id="$2" status body
  body=$(jq -nc --arg org "$org_id" '{org_id:$org, role:"member"}')
  status=$(http PATCH "${REST_BASE}/rest/v1/profiles?id=eq.${user_id}" "$SUPABASE_SERVICE_ROLE_KEY" "$body")
  [[ "$status" == "200" ]] || fail "assign org_id for user ${user_id} expected HTTP 200, got ${status}: $(cat "$TMP_BODY")"
  local rows; rows=$(jq -r 'length' "$TMP_BODY")
  [[ "$rows" -gt 0 ]] || fail "assign org_id for user ${user_id}: 0 rows updated — profiles row missing? handle_new_user trigger may not have fired yet"
}
assign_org "$PROBE_A_USER_ID" "$ORG_A_ID"
pass "org A probe user assigned to org A"
assign_org "$PROBE_B_USER_ID" "$ORG_B_ID"
pass "org B probe user assigned to org B"

echo "== seeding one agent_memory_chunks row for org B (via org B's own JWT, standard RLS-scoped insert) =="

JWT_B="$(mint_password_jwt "$PROBE_ORG_B_EMAIL" "$PROBE_ORG_B_PASSWORD")"

EXISTING_STATUS=$(curl -sS -o "$TMP_BODY" -w '%{http_code}' -X GET \
  "${REST_BASE}/rest/v1/agent_memory_chunks?org_id=eq.${ORG_B_ID}&content=eq.$(jq -rn --arg c "$SEED_CHUNK_CONTENT" '$c|@uri')&select=id" \
  -H "Authorization: Bearer ${JWT_B}" -H "apikey: ${ANON_KEY}")
[[ "$EXISTING_STATUS" == "200" ]] || fail "lookup seed chunk for org B expected HTTP 200, got ${EXISTING_STATUS}: $(cat "$TMP_BODY")"
EXISTING_COUNT=$(jq -r 'length' "$TMP_BODY")

if [[ "$EXISTING_COUNT" -gt 0 ]]; then
  pass "org B seed agent_memory_chunks row already exists, skipping insert"
else
  CHUNK_BODY=$(jq -nc --arg org "$ORG_B_ID" --arg content "$SEED_CHUNK_CONTENT" '{org_id:$org, scope:"domain", content:$content}')
  printf '%s' "$CHUNK_BODY" > "$TMP_REQ"
  CHUNK_STATUS=$(curl -sS -o "$TMP_BODY" -w '%{http_code}' -X POST "${REST_BASE}/rest/v1/agent_memory_chunks" \
    -H "Authorization: Bearer ${JWT_B}" -H "apikey: ${ANON_KEY}" -H "Content-Type: application/json" -H "Prefer: return=representation" \
    --data-binary "@$TMP_REQ")
  [[ "$CHUNK_STATUS" == "201" ]] || fail "insert seed chunk for org B expected HTTP 201, got ${CHUNK_STATUS}: $(cat "$TMP_BODY")"
  pass "org B seed agent_memory_chunks row created"
fi

echo "== seed-isolation-probes.sh: done =="
echo "org_a_id=${ORG_A_ID}"
echo "org_b_id=${ORG_B_ID}"
echo "probe_org_a_email=${PROBE_ORG_A_EMAIL}"
echo "probe_org_b_email=${PROBE_ORG_B_EMAIL}"
