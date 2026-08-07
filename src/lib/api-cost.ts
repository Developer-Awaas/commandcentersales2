/**
 * recordApiCost (client) — writes ONE agent_interactions row per external API
 * call made from the browser. Fire-and-forget, same trust/shape model as
 * logAiSession (session-logger.ts): client-reported tokens, org-scoped INSERT
 * policy (migration 20260807140000). This is the client half of the "single
 * ledger for every external API call" goal — the edge half is
 * supabase/functions/_shared/api-cost.ts (images + server/cron paths).
 *
 * Non-agent rows carry agent = null and attribute via `feature` + `provider`.
 * cost is derived from pricing.ts unless the caller passes an explicit costUsd.
 * Unknown model -> textCostUsd returns null -> the row still writes with a NULL
 * cost (never skipped).
 */

import { supabase } from './supabase';
import { getOrgId, getUserId } from './constants';
import { textCostUsd } from './pricing';

export type CostProvider = 'anthropic' | 'openai' | 'gemini';
export type CostCallType = 'text' | 'image_gen' | 'image_edit' | 'vision';

export interface ApiCostInput {
  provider: CostProvider;
  callType: CostCallType;
  feature: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  imageCount?: number;
  unitCostUsd?: number | null;
  /** Precomputed cost — skips the pricing.ts derivation when provided. */
  costUsd?: number | null;
  projectId?: string | null;
  traceId?: string | null;
}

export function recordApiCost(input: ApiCostInput): void {
  const orgId = getOrgId();
  if (!orgId) return; // no org context (signed out / pure-mock) — nothing to attribute

  const inputTokens = input.inputTokens ?? 0;
  const outputTokens = input.outputTokens ?? 0;
  const cost =
    input.costUsd !== undefined
      ? input.costUsd
      : input.callType === 'text' || input.callType === 'vision'
        ? textCostUsd(input.model, inputTokens, outputTokens)
        : (input.unitCostUsd ?? 0) * (input.imageCount ?? 1);

  void Promise.resolve(
    supabase.from('agent_interactions').insert({
      org_id: orgId,
      user_id: getUserId() || null,
      agent: null,
      provider: input.provider,
      call_type: input.callType,
      feature: input.feature,
      model: input.model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      image_count: input.imageCount ?? null,
      unit_cost_usd: input.unitCostUsd ?? null,
      cost_usd: cost,
      project_id: input.projectId ?? null,
      trace_id: input.traceId ?? null,
    })
  ).catch(() => {
    /* cost logging must never surface as a user-facing error */
  });
}
