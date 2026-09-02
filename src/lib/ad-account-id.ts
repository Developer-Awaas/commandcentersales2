/**
 * One rule: a stored Meta ad account id is ALWAYS `act_<digits>`.
 *
 * Opposite polarity to `hashtags.ts` on purpose. There, '#' is presentation,
 * so storage is bare and the UI adds the character. Here `act_` is Meta's own
 * identifier format — every Graph path is `/act_123/insights`, and every
 * existing row is already prefixed — so storage is PREFIXED and the input box
 * is the only place a bare number is tolerated.
 *
 * What this replaces: two hand-rolled copies of
 *   raw.startsWith('act_') ? raw : `act_${raw}`
 * (SettingsPage, ProjectForm) that validated nothing and were case-sensitive.
 * `ACT_123456` became `act_ACT_123456`, and `12ab34` became `act_12ab34` —
 * both stored happily, both dead on the first Graph call, and the failure
 * surfaces as a sync that logs `skipped` rather than an error anyone reads.
 * That is the same silent-until-audited shape as the deleted-app token
 * incident, which is why this validates instead of only prefixing.
 *
 * MIRRORED at supabase/functions/_shared/ad-account-id.ts — same reason as
 * pricing.ts: one file cannot cross the Vite/Deno boundary. KEEP THE TWO
 * BODIES IDENTICAL; a test on each side pins the same cases so drift trips CI.
 */

export type AdAccountIdResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

/** Meta account ids are numeric; the range is generous on purpose. */
const DIGITS = /^\d{6,20}$/;

/** Case-insensitive, and only ONE prefix is stripped — see below. */
const PREFIX = /^act_/i;

export const AD_ACCOUNT_ID_ERROR = 'Enter your numeric Ad Account ID';

/**
 * Canonicalises whatever was typed into `act_<digits>`.
 *
 * `act_act_123456` is REJECTED rather than repaired. A doubled prefix is
 * exactly what the old case-sensitive code could produce, so it is tempting
 * to collapse it the way normalizeHashtags collapses '##' — but a hashtag is
 * free text and an account id addresses someone's money. Guessing which half
 * of `act_act_1538119047116545` was intended is not a guess worth making
 * silently; the user retypes it.
 */
export function normalizeAdAccountId(input: string): AdAccountIdResult {
  const digits = String(input ?? '').trim().replace(PREFIX, '');
  if (!DIGITS.test(digits)) return { ok: false, error: AD_ACCOUNT_ID_ERROR };
  return { ok: true, value: `act_${digits}` };
}

/** Display helper — the one place the prefix comes back off. */
export function bareAdAccountId(stored: string | null | undefined): string {
  return String(stored ?? '').trim().replace(PREFIX, '');
}
