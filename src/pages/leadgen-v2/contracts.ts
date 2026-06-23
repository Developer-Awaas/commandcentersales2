// LeadGen V2 orchestration contract.
//
// INVARIANT: the UI talks ONLY to the `aarav-orchestrate` Edge Function.
// No component or hook in this feature may import/invoke a specialist
// function (arjun/aanya/diya) directly — Aarav is the single entry point
// and fans work out to specialists server-side.
//
// These types are shared between the client (src/hooks/useAgentSession.ts,
// the card components below) and the `aarav-orchestrate` Edge Function
// response shape. Keep them in sync — the edge function is the source of
// truth for the wire format. StrategyConfig in particular mirrors
// supabase/functions/_shared/agents/arjun.ts's StrategyConfig exactly —
// that is Arjun's real output shape, not a placeholder.

export type DelegateAgent = 'arjun' | 'aanya';

export type DelegationState = 'pending' | 'working' | 'done' | 'failed';

export interface DelegationStatus {
  agent: DelegateAgent;
  label: string;
  status: DelegationState;
}

export type AgentStatus = 'idle' | 'thinking' | 'generating' | 'ready';

export interface AaravMessage {
  id: string;
  role: 'aarav' | 'user';
  content: string;
  timestamp: string;
}

export type AdPlatform = 'Meta Ads Manager' | 'AiSensy';
export type FunnelStage = 'awareness' | 'consideration' | 'conversion';
export type CreativeAngle = 'value' | 'lifestyle' | 'amenity';

export interface BudgetAllocation {
  awareness: number;
  consideration: number;
  conversion: number;
}

export interface TargetingConfig {
  age_range: string;
  locations: string[];
  interests: string[];
}

export interface ExpectedCplRange {
  min: number;
  max: number;
  currency: 'INR';
}

// Arjun's (performance marketer) real output — a media plan, not ad copy.
// Ad copy (headline/primary_text/cta) belongs to Aanya once she exists.
export interface StrategyConfig {
  platform: AdPlatform;
  primary_funnel_stage: FunnelStage;
  budget_allocation: BudgetAllocation;
  targeting: TargetingConfig;
  placements: string[];
  expected_cpl_range: ExpectedCplRange;
  notes: string;
}

export interface CreativeCopy {
  headline: string;
  primary_text: string;
  cta: string;
}

export interface CreativeVariant {
  id: string;
  label: string;
  angle: CreativeAngle;
  preview_color: string;
  image_url?: string;
  copy?: CreativeCopy;
  rationale?: string;
}

export interface AaravCanvas {
  strategy?: StrategyConfig;
  creatives?: CreativeVariant[];
}

export type AgentAction = 'send_message' | 'approve' | 'request_change';

export interface AgentRequest {
  // action defaults to 'send_message' when omitted.
  action?: AgentAction;
  message?: string;
  project_id?: string;
  session_id?: string;
  // Present when the user edited Arjun's strategy card and resubmitted.
  // aarav-orchestrate treats this as a new orchestration turn that
  // re-delegates to Arjun with the edits folded into the objective — it
  // is never sent directly to a specialist.
  edited_strategy?: StrategyConfig;
  // Present when the user clicked "Regenerate" (ApprovalBar, all 3) or a
  // per-tile regenerate (CreativeGrid, one angle). aarav-orchestrate treats
  // this as a new orchestration turn that skips Arjun (reusing `strategy`
  // unchanged) and re-delegates only to Aanya. When `angle` is set, `keep`
  // must carry the other two variants unchanged so the response still has
  // all three — the client never talks to Aanya directly.
  regenerate_creatives?: {
    strategy: StrategyConfig;
    angle?: CreativeAngle;
    keep?: CreativeVariant[];
  };
  // For action='approve': the agent_turns row to approve.
  turn_id?: string;
  // Subset of creative variant ids the user selected; absent means all.
  selected_creative_ids?: string[];
}

export interface AaravResponse {
  // Server-assigned id of the agent_turns row for this invocation.
  // Used by the client to subscribe to Realtime updates and call approve.
  turn_id: string;
  // Server-resolved org_id — safe to include; used by the client to
  // set up the Realtime subscription without a separate profile lookup.
  org_id: string;
  status: AgentStatus;
  message: AaravMessage;
  delegations: DelegationStatus[];
  canvas: AaravCanvas;
  awaiting_user: boolean;
}

// Returned by action='approve'.
export interface ApproveResponse {
  success: boolean;
  // 'ready_to_launch': no real ad-launch integration exists — the campaign
  // is approved and saved but NOT automatically launched. Shown truthfully
  // in ApprovalBar; a real launch integration is a future phase.
  turn_status: 'ready_to_launch';
  turn_id: string;
  // Present when the turn was already approved (idempotent second call).
  already_approved?: boolean;
}
