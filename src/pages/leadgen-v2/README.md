# LeadGen V2 — Aarav Agent

Feature-flagged AI campaign workspace. Enabled via `VITE_LEADGEN_V2_ENABLED=true`.

## Orchestration contract

**Single entry point**: the client talks ONLY to the `aarav-orchestrate` Edge Function
via `useAgentSession`. No component or hook in this directory may import or invoke a
specialist (arjun / aanya / diya) directly. Aarav fans work out to specialists
server-side.

```
Browser → useAgentSession → aarav-orchestrate → Arjun (strategy)
                                              → Aanya (creatives + self-critique loop)
                                              → Diya  (brand confirm + brand check)
```

## Invariants (do not break)

| # | Invariant |
|---|-----------|
| 1 | `org_id` is NEVER trusted from the request body. Resolved server-side from the JWT. |
| 2 | No Aanya creative reaches the user without passing through `applyBrandCheck` (Diya). A Diya outage fails-safe: every variant flagged, none left at the placeholder 'pass'. |
| 3 | Approve is idempotent: UI guard (`approveLoading`), hook guard (`approveRef`), server guard (`approved_at IS NOT NULL`). All three required. |
| 4 | `agent_turns.status` never goes to `'approved'` — use `'ready_to_launch'` until a real Meta campaign-create call is wired. |
| 5 | Per-interaction budget cap enforced via `BudgetTracker` in `aanya.ts`. Reserve happens synchronously before each `await generateImage` — race-free in Deno's single-threaded isolate. |

## Profile tiers (presentation only — same backend)

| Tier | Thread chips | Card attribution |
|------|-------------|-----------------|
| `profile_1` | Single neutral "Working on it…" spinner | "Campaign Strategy" |
| `profile_2` | Named-agent delegation chips (Arjun / Aanya / Diya) | "Arjun's Strategy" |

The tier is read from `localStorage` via `useProfileMode` (client display) and from
`profiles.tier` (server-side cost ceiling enforcement).

## Per-interaction budget

Cost ceilings per tier live in `supabase/functions/_shared/tier-config.ts`.
`aanya.ts::BudgetTracker` enforces them. On cap hit:
- `agent_turns.cap_hit` is set to `true`
- A `budget-cap-hit` Langfuse span is logged
- Aarav's message notes the plan limit (advisory, not a hard error)

## Feature flag cutover

When `VITE_LEADGEN_V2_ENABLED=true`:
- The Lead Gen section tab defaults to `leadgen-v2`
- The "Aarav Agent ✦" nav item appears in the sidebar
- Old Lead Gen pages (Strategy, CampaignWizard, Ad Config, etc.) remain accessible
  and are NOT deleted — kept for one release as a fallback

## Key files

| File | Purpose |
|------|---------|
| `index.tsx` | Page entry; calls `useProfileMode` + `useAgentSession` |
| `contracts.ts` | Shared types (mirrors `aarav-orchestrate` wire format) |
| `components/AaravThread.tsx` | Conversation + delegation chips |
| `components/StrategyCard.tsx` | Editable Arjun strategy card |
| `components/CreativeGrid.tsx` | 3-tile creative gallery with per-tile regen |
| `components/BrandCheckCard.tsx` | Diya's brand-confirm verdict |
| `components/ApprovalBar.tsx` | Approve / Regenerate / Request Change bar |
| `../../hooks/useAgentSession.ts` | All network calls; guards double-submit |
| `../../hooks/useProfileMode.ts` | Client-side tier from localStorage |
