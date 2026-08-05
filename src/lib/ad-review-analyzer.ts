import { aiVision, isAiEnabled } from './ai-service';

export interface ProjectConfiguration {
  type: string;
  carpet: string;
  price_lacs: string;
  total_units: number | null;
  remaining_units: number | null;
  available: boolean;
  notes: string;
}

export interface AdReviewProjectInput {
  name?: string;
  locality?: string | null;
  city?: string | null;
  status?: string;
  completion_pct?: number;
  expected_possession?: string;
  nearest_landmarks?: string;
  unit_types?: string;
  price_range_lacs?: string | null;
  units_remaining?: number | null;
  usps?: string | null;
  amenities?: string;
  rera_number?: string;
  configurations?: ProjectConfiguration[] | null;
}

export interface AiIssue {
  area: string;
  severity: string;
  issue: string;
  fix: string;
}

export interface AiCategoryReview {
  score: number;
  fixes: string[];
}

export interface AiComplianceCheck {
  reraVisible: boolean;
  logoVisible: boolean;
  pricingClear: boolean;
  issues: string[];
}

export interface AiPlatformFit {
  ig_feed: string;
  ig_story: string;
  fb_feed: string;
}

export interface AiReviewResult {
  overallScore?: number;
  verdict?: string;
  strengths?: string[];
  issues?: AiIssue[];
  layoutReview?: AiCategoryReview;
  colorReview?: AiCategoryReview;
  typographyReview?: AiCategoryReview;
  contentReview?: AiCategoryReview;
  ctaReview?: AiCategoryReview;
  complianceCheck?: AiComplianceCheck;
  platformFit?: AiPlatformFit;
  followUpPrompt?: string;
  followUpPromptStory?: string;
}

export type AdReviewAnalyzeResult =
  | { status: 'error'; message: string }
  | { status: 'raw'; text: string }
  | { status: 'ok'; data: AiReviewResult; raw: Record<string, unknown> };

export async function fileToBase64(file: File): Promise<{ data: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve({ data: result.split(',')[1], mimeType: file.type });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// The one place an ad-review vision prompt gets built and sent — extracted
// from AdReview.tsx's own handleAnalyze (the reference implementation) so
// CampaignWizard's Ad Review step gets the same RERA/configuration
// guardrails instead of the generic prompt its previous hand-rolled version
// used (which had none of these compliance rules at all).
export async function analyzeAdCreative(input: {
  image: File;
  project: AdReviewProjectInput | undefined;
  createdWith: string;
}): Promise<AdReviewAnalyzeResult> {
  if (!isAiEnabled()) {
    return { status: 'error', message: 'AI analysis is currently unavailable.' };
  }

  const { project, createdWith } = input;

  let configLines = '';
  let configInline = '';
  if (project) {
    const configs: ProjectConfiguration[] = (project.configurations && project.configurations.length > 0)
      ? project.configurations
      : project.unit_types
        ? project.unit_types.split(',').map((t) => ({
            type: t.trim(),
            carpet: '',
            price_lacs: project.price_range_lacs ?? '',
            total_units: null,
            remaining_units: project.units_remaining ?? null,
            available: (project.units_remaining ?? 1) > 0,
            notes: '',
          }))
        : [{
            type: 'Unit',
            carpet: '',
            price_lacs: project.price_range_lacs ?? '',
            total_units: null,
            remaining_units: project.units_remaining ?? null,
            available: true,
            notes: '',
          }];

    configLines = configs
      .filter((c) => c.available)
      .map((c) => [
        `  - Type: ${c.type}`,
        c.carpet ? `    Carpet Area: ${c.carpet}` : '',
        c.price_lacs ? `    Price: ₹${c.price_lacs}L` : '',
        c.remaining_units != null ? `    Units Available: ${c.remaining_units}` : '',
        c.notes ? `    Note: ${c.notes}` : '',
      ].filter(Boolean).join('\n'))
      .join('\n');

    configInline = configs
      .filter((c) => c.available)
      .map((c) => `${c.type}${c.carpet ? ` ${c.carpet}` : ''}${c.price_lacs ? ` ₹${c.price_lacs}L` : ''}`)
      .join(', ');
  }

  const reraLine = project?.rera_number
    ? `RERA: ${project.rera_number}`
    : `RERA: NOT AVAILABLE — DO NOT MENTION RERA IN ANY OUTPUT`;

  const projectBlock = project
    ? `CRITICAL RULES — READ BEFORE GENERATING:
1. Use ONLY the configurations listed below — do NOT invent other unit types or sizes
2. Use the exact prices given — do NOT round, estimate, or change prices
3. ${reraLine.startsWith('RERA: NOT') ? 'RERA is NOT available — DO NOT mention RERA or any registration number anywhere' : 'Use the RERA number exactly as given'}
4. If amenities or USPs are not listed, do NOT invent them
5. All ad copy must reflect ONLY this project data — no fabricated details

PROJECT BEING REVIEWED — USE ONLY THESE EXACT VALUES:
Name: ${project.name}
Location: ${[project.locality, project.city].filter(Boolean).join(', ') || 'Bhubaneswar'}
Status: ${project.status || 'Not specified'}${project.completion_pct != null ? `\nCompletion: ${project.completion_pct}%` : ''}${project.expected_possession ? `\nPossession: ${project.expected_possession}` : ''}${project.nearest_landmarks ? `\nNearby: ${project.nearest_landmarks}` : ''}
${reraLine}

CONFIGURATIONS BEING ADVERTISED (use ONLY these):
${configLines || '  - No configuration data available'}
${project.usps ? `\nUSPs: ${project.usps}` : ''}${project.amenities ? `\nAmenities: ${project.amenities}` : ''}`
    : 'Project details not available';

  const promptText = `Review this real estate ad creative. Be specific about issues and fixes.

${projectBlock}

CREATED ON: ${createdWith}

Return ONLY a JSON object:
{"overallScore":7,"verdict":"one line","strengths":["specific strength"],"issues":[{"area":"Layout or Color or Typography or Content or CTA","severity":"Critical or Major or Minor","issue":"specific problem","fix":"how to fix"}],"layoutReview":{"score":7,"fixes":["fix"]},"colorReview":{"score":7,"fixes":["fix"]},"typographyReview":{"score":7,"fixes":["fix"]},"contentReview":{"score":7,"fixes":["fix"]},"ctaReview":{"score":7,"fixes":["fix"]},"complianceCheck":{"reraVisible":true,"logoVisible":true,"pricingClear":true,"issues":["issue"]},"platformFit":{"ig_feed":"Good or Needs work","ig_story":"Good or Needs work","fb_feed":"Good or Needs work"},"followUpPrompt":"COMPLETE revised prompt for ${createdWith} that fixes ALL issues above. MANDATORY: Use ONLY these project details — Project: ${project?.name ?? ''}, Location: ${[project?.locality, project?.city].filter(Boolean).join(', ') || 'Bhubaneswar'}, Configs: ${configInline || 'as listed'}. ${project?.rera_number ? `RERA: ${project.rera_number}.` : 'Do NOT mention RERA.'} Include specific design fixes. Dimensions: 1080x1080. Brand colors: #1B4332, #2DD4A8. Logo: Neelachala Homes top-left.","followUpPromptStory":"Same structure for 1080x1920 story format with same mandatory project details and fixes."}`;

  const { data: b64data, mimeType } = await fileToBase64(input.image);
  const messages = [
    {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: b64data } },
        { type: 'text', text: promptText },
      ],
    },
  ];

  const res = await aiVision(messages, 'You are a senior creative director reviewing real estate ads. Respond ONLY in valid JSON.');

  if (res.error) return { status: 'error', message: String(res.error) };
  if (res.raw) return { status: 'raw', text: String(res.raw) };
  return { status: 'ok', data: res as AiReviewResult, raw: res };
}
