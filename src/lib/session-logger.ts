import { getOrgId, getUserId } from './constants';
import type { SupabaseClient } from '@supabase/supabase-js';

interface AiSessionData {
  sessionType: string;
  projectIds?: string[];
  inputSummary?: string;
  inputData?: Record<string, unknown>;
  outputData?: Record<string, unknown>;
  healthScore?: number | null;
  tokensUsed?: number;
}

interface ActivityData {
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  details?: Record<string, unknown>;
}

export function logAiSession(supabase: SupabaseClient, data: AiSessionData): void {
  void Promise.resolve(
    supabase
      .from('ai_sessions')
      .insert({
        org_id: getOrgId(),
        user_id: getUserId(),
        session_type: data.sessionType,
        project_ids: data.projectIds ?? [],
        input_summary: data.inputSummary?.substring(0, 500) ?? '',
        input_data: data.inputData ?? {},
        output_data: data.outputData ?? {},
        health_score: data.healthScore ?? null,
        tokens_used: data.tokensUsed ?? 0,
      })
  ).catch(console.error);
}

export function logActivity(supabase: SupabaseClient, data: ActivityData): void {
  void Promise.resolve(
    supabase
      .from('activity_log')
      .insert({
        org_id: getOrgId(),
        user_id: getUserId(),
        action: data.action,
        entity_type: data.entityType ?? null,
        entity_id: data.entityId ?? null,
        details: data.details ?? {},
      })
  ).catch(console.error);
}
