-- ============================================================
-- PKCE + server-authoritative identity for OAuth flows (Canva first;
-- provider column allows reuse for a future integration).
--
-- Replaces putting {userId, orgId} directly in the OAuth `state` param
-- (client-controlled, travels through a redirect the client doesn't
-- control the endpoint of) with an opaque nonce. The flow's real identity
-- (user_id, org_id) and PKCE code_verifier live server-side only, keyed
-- by that nonce, single-use (deleted on first read) and short-lived.
--
-- RLS: deny-all is the point. No policies for anon/authenticated at all —
-- with RLS enabled and zero policies, every row is inaccessible to those
-- roles by default. Only the service-role client (which bypasses RLS
-- entirely, as always) can read or write this table. That's intentional,
-- not an oversight to fill in later.
-- ============================================================

create table if not exists public.oauth_flow_sessions (
  nonce         uuid primary key default gen_random_uuid(),
  provider      text not null default 'canva',
  user_id       uuid not null references auth.users(id) on delete cascade,
  org_id        uuid not null,
  code_verifier text not null,
  return_url    text not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '10 minutes')
);

alter table public.oauth_flow_sessions enable row level security;

create index if not exists idx_oauth_flow_sessions_expires_at
  on public.oauth_flow_sessions (expires_at);
