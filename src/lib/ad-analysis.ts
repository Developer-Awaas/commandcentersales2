import { aiCall, isAiEnabled } from './ai-service';
import { buildContext } from './context-builder';

// Shared ad-performance analysis — extracted verbatim from Analyzer.tsx's
// handleRunAnalysis (CC-P4 Step 3, "reuse the working analysis code, don't
// rewrite it") so both the Analyzer page and the new Performance Monitor
// call the exact same prompt + model. Performance Monitor feeds it a metrics
// object read from campaign_metrics instead of manual entry.

export interface AdMetrics {
  spend?: number;
  leads?: number;
  cpl?: number;
  ctr?: number;
  impressions?: number;
  reach?: number;
  frequency?: number;
  site_visits?: number;
  bookings?: number;
}

export interface AiScorecardRow {
  metric: string;
  value: string;
  target: string;
  status: 'green' | 'yellow' | 'red';
  insight: string;
}
export interface AiTacticalAction { priority: number; action: string; impact: string; howTo: string; }
export interface AiStrategicRec { rec: string; rationale: string; timeline: string; }
export interface AiFunnelAnalysis { bottleneck: string; stage: string; fix: string; }

export interface AiAnalysisResult {
  healthScore?: number;
  assessment?: string;
  scorecard?: AiScorecardRow[];
  tacticalActions?: AiTacticalAction[];
  strategicRecs?: AiStrategicRec[];
  funnelAnalysis?: AiFunnelAnalysis;
  creativeRec?: string;
  targetingRec?: string;
  nextReview?: string;
}

export type AdAnalysisResult =
  | { status: 'error'; message: string }
  | { status: 'raw'; text: string }
  | { status: 'ok'; data: AiAnalysisResult; raw: Record<string, unknown> };

export async function runAdAnalysis(input: {
  metrics: AdMetrics;
  projectName: string;
  projectId?: string;
  periodDays: number;
}): Promise<AdAnalysisResult> {
  if (!isAiEnabled()) {
    return { status: 'error', message: 'AI analysis is currently unavailable.' };
  }
  const m = input.metrics;
  const context = await buildContext({ projectId: input.projectId });
  const basePrompt = `Analyze real estate ad metrics. Give specific actionable recommendations.
PROJECT: ${input.projectName}
PERIOD: Last ${input.periodDays} days
METRICS: Spend Rs ${m.spend ?? 0}, Leads ${m.leads ?? 0}, CPL Rs ${m.cpl ?? 0}, CTR ${m.ctr ?? 0}%, Impressions ${m.impressions ?? 0}, Reach ${m.reach ?? 0}, Frequency ${m.frequency ?? 0}, Site Visits ${m.site_visits ?? 0}, Bookings ${m.bookings ?? 0}
BASELINE: ~80 leads/mo, CPL Rs 80-140, ~12 SVs, 0-1 bookings

Return ONLY a JSON object:
{"healthScore":7,"assessment":"summary","scorecard":[{"metric":"CPL","value":"Rs X","target":"Rs X","status":"green or yellow or red","insight":"brief"}],"tacticalActions":[{"priority":1,"action":"action","impact":"impact","howTo":"steps"}],"strategicRecs":[{"rec":"recommendation","rationale":"why","timeline":"when"}],"funnelAnalysis":{"bottleneck":"what","stage":"which","fix":"how"},"creativeRec":"recommendation","targetingRec":"changes","nextReview":"when"}`;
  const prompt = context ? basePrompt + '\n\n' + context : basePrompt;

  const res = await aiCall(prompt);
  if (res.error) return { status: 'error', message: String(res.error) };
  if (res.raw) return { status: 'raw', text: String(res.raw) };
  return { status: 'ok', data: res as AiAnalysisResult, raw: res };
}
