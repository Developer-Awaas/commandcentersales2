import { supabase } from './supabase';
import { aiCall, isAiEnabled } from './ai-service';
import { buildContext } from './context-builder';

export interface AdConfigProjectInput {
  name?: string;
  locality?: string | null;
  city?: string | null;
  price_range_lacs?: string | null;
  units_remaining?: number | null;
  usps?: string | null;
  notes?: string | null;
}

export interface AiLocation {
  city: string;
  radius: string;
  why: string;
}

export interface AiIcebreaker {
  text: string;
  purpose: string;
}

export interface AiConfigResult {
  platformTip?: string;
  campaignName?: string;
  adType?: string;
  objective?: string;
  goal?: string;
  locations?: AiLocation[];
  ageMin?: number;
  ageMax?: number;
  ageWhy?: string;
  gender?: string;
  interests?: string[];
  demographics?: string[];
  occupations?: string[];
  educationLevel?: string;
  lifeEvents?: string;
  behaviors?: string[];
  audienceExpansion?: string;
  dailyBudget?: number;
  days?: number;
  totalBudget?: number;
  bidStrategy?: string;
  icebreakers?: AiIcebreaker[];
  pixelEvents?: string[];
  checklist?: string[];
}

export type AdConfigGenerateResult =
  | { status: 'error'; message: string }
  | { status: 'raw'; text: string }
  | { status: 'ok'; data: AiConfigResult; raw: Record<string, unknown> };

// The one place an ad-config prompt gets built and sent — extracted from
// AdConfig.tsx's own handleGenerate (the reference implementation) so
// CampaignWizard's Ad Config step calls the exact same logic (including
// the verified-targeting-keywords lookup the wizard's own hand-rolled
// version never had) instead of a simplified duplicate prompt.
export async function generateAdConfig(input: {
  projectId: string;
  project: AdConfigProjectInput | undefined;
  funnelStage: string;
  platform: string;
}): Promise<AdConfigGenerateResult> {
  if (!isAiEnabled()) {
    return { status: 'error', message: 'AI configuration generation is currently unavailable.' };
  }

  const [context, verifiedKwRes] = await Promise.all([
    buildContext({ projectId: input.projectId }),
    supabase.from('targeting_keywords').select('keyword,status').eq('platform', input.platform).in('status', ['available', 'not_found']),
  ]);
  const verifiedKws = (verifiedKwRes.data ?? []) as { keyword: string; status: string }[];
  const verifiedAvailable = verifiedKws.filter((k) => k.status === 'available').map((k) => k.keyword);
  const verifiedNotFound = verifiedKws.filter((k) => k.status === 'not_found').map((k) => k.keyword);
  const kwSection = [
    verifiedAvailable.length > 0 ? `VERIFIED TARGETING (available in ${input.platform}): ${verifiedAvailable.join(', ')}` : '',
    verifiedNotFound.length > 0 ? `NOT AVAILABLE (do NOT suggest): ${verifiedNotFound.join(', ')}` : '',
  ].filter(Boolean).join('\n');

  const project = input.project;
  const basePrompt = `Generate EXACT field-by-field ad configuration. Write REAL specific values, not placeholders.
PROJECT: ${project?.name ?? 'Unknown'} | ${project?.locality ?? ''}, ${project?.city ?? ''} | Price: ${project?.price_range_lacs ?? 'N/A'} Lacs | Units remaining: ${project?.units_remaining ?? 'N/A'} | USPs: ${project?.usps ?? 'N/A'} | Notes: ${project?.notes ?? 'None'}
FUNNEL: ${input.funnelStage}
PLATFORM: ${input.platform}
${kwSection ? '\n' + kwSection : ''}

Return ONLY a JSON object:
{"platformTip":"recommendation","campaignName":"REAL name","adType":"REAL type","objective":"REAL","goal":"REAL","locations":[{"city":"REAL","radius":"REAL","why":"REAL"}],"ageMin":30,"ageMax":50,"ageWhy":"reason","gender":"All","interests":["REAL interest 1","REAL interest 2"],"demographics":["REAL demographic 1","REAL demographic 2"],"occupations":["job title 1","job title 2"],"educationLevel":"College Graduate, Postgraduate","lifeEvents":"Recently married, Recently moved","behaviors":["REAL"],"audienceExpansion":"OFF - reason","dailyBudget":350,"days":14,"totalBudget":4900,"bidStrategy":"Lowest cost","icebreakers":[{"text":"REAL with emoji","purpose":"purpose"}],"pixelEvents":["REAL event"],"checklist":["REAL step 1","REAL step 2"]}`;
  const prompt = context ? basePrompt + '\n\n' + context : basePrompt;

  const res = await aiCall(prompt);
  if (res.error) return { status: 'error', message: String(res.error) };
  if (res.raw) return { status: 'raw', text: String(res.raw) };
  return { status: 'ok', data: res as AiConfigResult, raw: res };
}
