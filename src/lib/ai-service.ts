import { supabase } from './supabase';
import { ADMIN_EMAIL } from './constants';
import { MOCK_AI_ENABLED } from './feature-flags';
import { MOCK_STRATEGY_JSON } from '../mocks/ai-fixtures';
import { isValidReferenceAnalysis, sanitizePalette, isValidReferenceZone, dedupeZones, clampBbox, type ReferenceAnalysis, type ReferenceZone } from './reference-style';

const CLAUDE_MODEL = 'claude-sonnet-4-6';
const DEFAULT_SYSTEM =
  'You are an expert performance marketing specialist for Indian real estate. Respond ONLY in valid JSON.';

const USER_DAILY_LIMIT_DEFAULT = 40;
const GLOBAL_DAILY_LIMIT = 200;
const QUOTA_MSG = 'Daily AI quota reached. Resets at midnight IST.';

function getTodayKeyIST(): string {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

function getUserEmail(): string {
  return localStorage.getItem('user_email') || '';
}

// Groups all Claude calls from the same browser tab into one Langfuse
// Session so multi-step flows (e.g. Strategy's brief -> Aanya prompt) show
// up together in the Sessions view rather than as unrelated traces.
function getBrowserSessionId(): string {
  const KEY = 'langfuse_session_id';
  let id = sessionStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(KEY, id);
  }
  return id;
}

export interface TraceOptions {
  traceName?: string;
  metadata?: Record<string, unknown>;
}

// Vision call messages embed base64 image bytes — strip those before
// sending to Langfuse so traces stay small and don't ship raw image data.
function redactImages(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactImages);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (obj.type === 'image') return { type: 'image', source: '[redacted image data]' };
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, redactImages(v)]));
  }
  return value;
}

// Fire-and-forget: tracing must never slow down or fail a real AI call.
// The Langfuse SECRET key never reaches the browser — this calls a Supabase
// Edge Function proxy (langfuse-ingest) that holds the secret server-side.
export function logToLangfuse(
  traceName: string,
  params: {
    input?: unknown;
    output?: unknown;
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    level?: 'DEFAULT' | 'ERROR';
    statusMessage?: string;
    metadata?: Record<string, unknown>;
  }
): void {
  supabase.functions
    .invoke('langfuse-ingest', {
      body: {
        traceName,
        sessionId: getBrowserSessionId(),
        tags: ['client'],
        ...params,
      },
    })
    .catch(() => { /* tracing must never surface as a user-facing error */ });
}

export function setUserEmail(email: string): void {
  localStorage.setItem('user_email', email);
}

async function getUserCallCount(): Promise<number> {
  const uid = localStorage.getItem('user_id');
  if (!uid) return 0;
  const today = getTodayKeyIST();
  const start = `${today}T00:00:00+05:30`;
  const end = `${today}T23:59:59+05:30`;
  const { count } = await supabase
    .from('ai_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', uid)
    .gte('created_at', start)
    .lte('created_at', end);
  return count ?? 0;
}

async function getGlobalCallCount(): Promise<number> {
  const today = getTodayKeyIST();
  const start = `${today}T00:00:00+05:30`;
  const end = `${today}T23:59:59+05:30`;
  const { count } = await supabase
    .from('ai_sessions')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', start)
    .lte('created_at', end);
  return count ?? 0;
}

async function getUserDailyLimit(): Promise<number> {
  const uid = localStorage.getItem('user_id');
  if (!uid) return USER_DAILY_LIMIT_DEFAULT;
  const { data } = await supabase
    .from('profiles')
    .select('daily_ai_limit')
    .eq('id', uid)
    .maybeSingle();
  return data?.daily_ai_limit ?? USER_DAILY_LIMIT_DEFAULT;
}

async function checkQuota(): Promise<string | null> {
  const email = getUserEmail();
  if (email === ADMIN_EMAIL) return null;

  const limit = await getUserDailyLimit();
  if ((await getUserCallCount()) >= limit) return QUOTA_MSG;

  const global = await getGlobalCallCount();
  if (global >= GLOBAL_DAILY_LIMIT) return QUOTA_MSG;

  return null;
}

export async function getTodayAiCallsCount(): Promise<number> {
  return getUserCallCount();
}

// Key lives in Edge Function secrets — always enabled from the client's perspective.
export function isAiEnabled(): boolean {
  return true;
}

// Escape literal control characters (newline, tab, CR) inside JSON string values.
// Claude sometimes emits multi-line prose inside a JSON string without escaping the newlines,
// which produces "Expected ',' or '}' after property value" parse errors.
function sanitizeJsonControlChars(text: string): string {
  let inString = false;
  let escape = false;
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = text.charCodeAt(i);
    if (escape) { escape = false; result += ch; continue; }
    if (ch === '\\') { escape = true; result += ch; continue; }
    if (ch === '"') { inString = !inString; result += ch; continue; }
    if (inString && code < 0x20) {
      if (ch === '\n') result += '\\n';
      else if (ch === '\r') result += '\\r';
      else if (ch === '\t') result += '\\t';
      else result += `\\u${code.toString(16).padStart(4, '0')}`;
      continue;
    }
    result += ch;
  }
  return result;
}

function repairTruncatedJSON(text: string): unknown | null {
  if (!text) return null;

  let cleaned = text.trim()
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '');

  const start = cleaned.indexOf('{');
  if (start === -1) return null;
  cleaned = cleaned.substring(start);

  try { return JSON.parse(cleaned); } catch { /* continue */ }

  let inString = false;
  let escape = false;
  const stack: string[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }

  let repaired = cleaned;
  if (inString) repaired += '"';
  repaired = repaired.replace(/,\s*"[^"]*$/, '');
  repaired = repaired.replace(/:\s*$/, ': null');
  repaired = repaired.replace(/,\s*$/, '');
  repaired = repaired.replace(/"[^"]*:\s*$/, '');
  repaired = repaired.replace(/,\s*$/, '');

  while (stack.length > 0) {
    const open = stack.pop();
    repaired += (open === '{' ? '}' : ']');
  }

  try {
    const parsed = JSON.parse(repaired) as Record<string, unknown>;
    parsed._truncated = true;
    return parsed;
  } catch { return null; }
}

function extractJson(text: string): unknown | null {
  if (!text) return null;

  // Pass 1: raw attempts
  try { return JSON.parse(text); } catch { /* continue */ }

  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  try { return JSON.parse(cleaned); } catch { /* continue */ }

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try { return JSON.parse(cleaned.substring(firstBrace, lastBrace + 1)); } catch { /* continue */ }
  }

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch { /* continue */ }
  }

  // Pass 2: sanitize literal control characters in string values (e.g. unescaped newlines
  // inside the nanobanana_prompt_main field), then retry the same sequence.
  const sanitized = sanitizeJsonControlChars(cleaned);
  try { return JSON.parse(sanitized); } catch { /* continue */ }
  if (firstBrace !== -1 && lastBrace !== -1) {
    try { return JSON.parse(sanitizeJsonControlChars(cleaned.substring(firstBrace, lastBrace + 1))); } catch { /* continue */ }
  }

  const repaired = repairTruncatedJSON(sanitized);
  if (repaired) return repaired;

  return null;
}

export interface ClaudeStreamResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
}

export type ClaudeStreamOutcome =
  | { ok: true; result: ClaudeStreamResult }
  | { ok: false; error: string };

/**
 * claude-proxy always streams now (see that function for why: Supabase's
 * 150s limit is a request-*idle* timeout, not the actual 400s wall-clock
 * ceiling — a buffered response for a large max_tokens generation can miss
 * that window before ever sending a byte back). Every caller here only
 * ever consumed the concatenated text plus input/output token totals,
 * never individual content-block structure (tool-use blocks included —
 * Analyzer.tsx's web-search call only reads the text blocks too), so this
 * is the one place that parses Anthropic's SSE format; every caller below
 * gets back the same shape it always did.
 *
 * supabase.functions.invoke() doesn't expose a raw ReadableStream, so this
 * calls the function directly via fetch — replicating invoke()'s own
 * behavior of attaching the current session's JWT (falling back to the
 * anon key when signed out, matching invoke()'s own fallback).
 */
export async function callClaudeProxyStream(payload: Record<string, unknown>): Promise<ClaudeStreamOutcome> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const { data: sessionData } = await supabase.auth.getSession();
  const authToken = sessionData.session?.access_token ?? anonKey;

  let res: Response;
  try {
    res = await fetch(`${supabaseUrl}/functions/v1/claude-proxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to reach claude-proxy' };
  }

  const contentType = res.headers.get('content-type') ?? '';

  // claude-proxy returns a normal JSON body (not a stream) for errors that
  // happen before generation starts — missing secret, bad request, auth
  // failure, or Anthropic rejecting the request outright.
  if (!contentType.includes('text/event-stream')) {
    const json = await res.json().catch(() => null) as { type?: string; error?: { message?: string } } | null;
    return { ok: false, error: json?.error?.message ?? `claude-proxy returned ${res.status}` };
  }

  if (!res.body) return { ok: false, error: 'claude-proxy returned no response body' };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: string | null = null;
  let streamError: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE events are separated by a blank line; each event is one or more
    // "field: value" lines. Anthropic's format only ever uses "event:" and
    // "data:" here.
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? ''; // last chunk may be incomplete — keep it for next read

    for (const rawEvent of events) {
      const dataLine = rawEvent.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      let parsed: Record<string, unknown>;
      try { parsed = JSON.parse(dataLine.slice(5).trim()); } catch { continue; }

      const type = parsed.type as string | undefined;
      if (type === 'message_start') {
        const usage = (parsed.message as Record<string, unknown> | undefined)?.usage as Record<string, unknown> | undefined;
        inputTokens = (usage?.input_tokens as number) ?? 0;
      } else if (type === 'content_block_delta') {
        const delta = parsed.delta as Record<string, unknown> | undefined;
        if (delta?.type === 'text_delta') text += (delta.text as string) ?? '';
      } else if (type === 'message_delta') {
        const usage = parsed.usage as Record<string, unknown> | undefined;
        if (usage?.output_tokens != null) outputTokens = usage.output_tokens as number;
        const delta = parsed.delta as Record<string, unknown> | undefined;
        if (delta?.stop_reason) stopReason = delta.stop_reason as string;
      } else if (type === 'error') {
        const err = parsed.error as Record<string, unknown> | undefined;
        streamError = (err?.message as string) ?? 'Anthropic stream error';
      }
    }
  }

  if (streamError) return { ok: false, error: streamError };
  return { ok: true, result: { text, inputTokens, outputTokens, stopReason } };
}

export async function aiCall(
  prompt: string,
  system?: string,
  maxTokens: number = 16000,
  trace: TraceOptions = {}
): Promise<Record<string, unknown>> {
  const traceName = trace.traceName ?? 'claude-call';

  // MOCK_AI_ENABLED short-circuits the network call only — every caller's
  // downstream persistence (Storage upload, DB insert, session logging)
  // still runs for real against whatever this returns. One superset fixture
  // covers every known consumer's field names (Strategy, Campaign Wizard,
  // SMM Creatives) — see src/mocks/ai-fixtures.ts for the reasoning.
  if (MOCK_AI_ENABLED) {
    return { ...MOCK_STRATEGY_JSON, _inputTokens: 0, _outputTokens: 0 };
  }

  const quotaErr = await checkQuota();
  if (quotaErr) return { error: quotaErr };

  try {
    const outcome = await callClaudeProxyStream({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      system: system ?? DEFAULT_SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    });

    if (!outcome.ok) {
      logToLangfuse(traceName, { input: prompt, model: CLAUDE_MODEL, level: 'ERROR', statusMessage: outcome.error, metadata: trace.metadata });
      return { error: outcome.error };
    }

    const { text: rawText, inputTokens, outputTokens } = outcome.result;

    const parsed = extractJson(rawText);
    logToLangfuse(traceName, { input: prompt, output: parsed ?? rawText, model: CLAUDE_MODEL, inputTokens, outputTokens, metadata: trace.metadata });

    if (parsed) return { ...parsed as Record<string, unknown>, _inputTokens: inputTokens, _outputTokens: outputTokens };

    return { raw: rawText, _inputTokens: inputTokens, _outputTokens: outputTokens };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    logToLangfuse(traceName, { input: prompt, model: CLAUDE_MODEL, level: 'ERROR', statusMessage: msg, metadata: trace.metadata });
    return { error: msg };
  }
}

/**
 * Uses Claude Haiku vision to produce a rich visual description of an image
 * suitable for injection into a FLUX text-to-image prompt.
 * Returns null on any failure so callers can fall back gracefully.
 */
export async function describeImageForFlux(
  image: string | { base64: string; mimeType: string }
): Promise<string | null> {
  if (MOCK_AI_ENABLED) {
    return '[MOCK] A modern mid-rise apartment building, cream stucco facade with navy accents, golden hour lighting, professional real estate photography style.';
  }

  const imageSource = typeof image === 'string'
    ? { type: 'url' as const, url: image }
    : { type: 'base64' as const, media_type: image.mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', data: image.base64 };

  try {
    const outcome = await callClaudeProxyStream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: imageSource },
          {
            type: 'text',
            text: 'Describe this image in 3–4 sentences for use as a text-to-image model reference. Cover: the architectural subject and its visual characteristics (materials, style, color, scale), the composition and camera angle, the lighting quality (time of day, approximate Kelvin, shadow direction), the dominant color palette (hex codes if clearly identifiable), and the overall aesthetic style and mood. Do NOT mention any visible text, logos, watermarks, or people by name. Output only the visual description — no preamble, no labels.',
          },
        ],
      }],
    });

    if (!outcome.ok) {
      logToLangfuse('claude-vision-describe-image', { model: 'claude-haiku-4-5-20251001', level: 'ERROR', statusMessage: outcome.error });
      return null;
    }
    const text = outcome.result.text.trim();
    logToLangfuse('claude-vision-describe-image', {
      output: text,
      model: 'claude-haiku-4-5-20251001',
      inputTokens: outcome.result.inputTokens,
      outputTokens: outcome.result.outputTokens,
    });
    return text || null;
  } catch (err) {
    logToLangfuse('claude-vision-describe-image', { model: 'claude-haiku-4-5-20251001', level: 'ERROR', statusMessage: err instanceof Error ? err.message : 'Unknown error' });
    return null;
  }
}

/**
 * Extract STYLE ONLY from a reference image (CC-P5 Step 4): palette + layout
 * structure + text treatment. HARD RULE (in the prompt AND enforced downstream
 * by buildReferenceStyleBlock): no subject/content carry-over — the reference
 * informs style, never what the output depicts. Cheapest vision tier (Haiku).
 * Returns null on any failure so callers fall back to a reference-free prompt.
 */
export async function analyzeReferenceStyle(
  image: string | { base64: string; mimeType: string }
): Promise<ReferenceAnalysis | null> {
  if (MOCK_AI_ENABLED) {
    return {
      palette: ['#0A2540', '#F5F5F5', '#C9A24B'],
      layout: 'Full-bleed hero image across the top two-thirds; a solid colour band across the bottom third carries the headline and price, small logo top-left.',
      text_treatment: 'Bold uppercase sans-serif headline, oversized price in the accent colour, thin all-caps CTA; strong left-aligned size hierarchy.',
      mode: 'style_hints',
    };
  }

  const imageSource = typeof image === 'string'
    ? { type: 'url' as const, url: image }
    : { type: 'base64' as const, media_type: image.mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', data: image.base64 };

  try {
    const outcome = await callClaudeProxyStream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: imageSource },
          {
            type: 'text',
            text: 'Analyze ONLY the visual STYLE of this real-estate ad reference. Return STRICT JSON with exactly these keys: {"palette": ["#rrggbb", ...] (3-6 dominant hex colours), "layout": "1-2 sentences on where text vs. imagery sits (the layout zones/structure)", "text_treatment": "1-2 sentences on typography — weight, case, size hierarchy, copy placement"}. HARD RULE: describe STYLE ONLY. Do NOT describe, name, or reference the subject, building, people, location, or any specific content of the image. Output ONLY the JSON object, no preamble.',
          },
        ],
      }],
    });

    if (!outcome.ok) {
      logToLangfuse('claude-vision-reference-style', { model: 'claude-haiku-4-5-20251001', level: 'ERROR', statusMessage: outcome.error });
      return null;
    }
    const parsed = extractJson(outcome.result.text);
    logToLangfuse('claude-vision-reference-style', {
      output: JSON.stringify(parsed),
      model: 'claude-haiku-4-5-20251001',
      inputTokens: outcome.result.inputTokens,
      outputTokens: outcome.result.outputTokens,
    });
    if (!isValidReferenceAnalysis(parsed)) return null;
    // Stamp the mode so both reference paths share one typed shape (RB-P0). The
    // client CreativeGenerator flow is always style_hints; replicate_layout is
    // set by the Strategy replicate path when its zone extraction lands (Rung 2).
    return { ...parsed, palette: sanitizePalette(parsed.palette), mode: 'style_hints' };
  } catch (err) {
    logToLangfuse('claude-vision-reference-style', { model: 'claude-haiku-4-5-20251001', level: 'ERROR', statusMessage: err instanceof Error ? err.message : 'Unknown error' });
    return null;
  }
}

const ZONE_VISION_MODEL = 'claude-sonnet-4-6';
const ZONE_PROMPT =
  'You are a layout-analysis tool. Analyze this real-estate ad and return the position of every distinct ZONE as STRICT JSON. ' +
  'Output ONLY: {"zones":[{"role":"headline|subheadline|price|cta|badge|checklist|logo|photo|footer|other","bbox":[x,y,w,h],"align":"left|center|right","font_scale":number,"weight":"normal|bold","color":"#rrggbb"}]}. ' +
  'bbox is NORMALIZED 0..1 with x,y = top-left corner and w,h = width,height as fractions of the full image. ' +
  'font_scale = approximate text cap-height as a fraction of image height (0 for photo/logo). ' +
  'Include EVERY text block, each badge/stat cell as a SEPARATE zone, each bullet/checklist group as ONE zone, the logo zone(s), and the main photo zone. ' +
  'Do NOT name the building, company, or location. Output only the JSON object.';

/**
 * Vision pass for replicate_layout mode: locates the reference ad's zones as
 * normalized bounding boxes + font hints (Sonnet — better spatial reasoning than
 * Haiku). Deduped (fragmented headings merged) and bbox-clamped. Returns null on
 * failure so the caller can fall back to generic default layers.
 */
export async function analyzeReferenceZones(
  image: string | { base64: string; mimeType: string },
): Promise<ReferenceZone[] | null> {
  if (MOCK_AI_ENABLED) {
    return [
      { role: 'logo', bbox: [0.40, 0.03, 0.20, 0.08], align: 'center', fontScale: 0, weight: 'normal', color: '#c9a961' },
      { role: 'headline', bbox: [0.08, 0.12, 0.84, 0.12], align: 'center', fontScale: 0.09, weight: 'bold', color: '#ffffff' },
      { role: 'price', bbox: [0.08, 0.28, 0.5, 0.06], align: 'left', fontScale: 0.04, weight: 'bold', color: '#f59e0b' },
      { role: 'photo', bbox: [0.0, 0.38, 1.0, 0.5], align: 'center', fontScale: 0, weight: 'normal', color: '#000000' },
      { role: 'cta', bbox: [0.08, 0.9, 0.4, 0.06], align: 'left', fontScale: 0.035, weight: 'bold', color: '#ffffff' },
    ];
  }

  const imageSource = typeof image === 'string'
    ? { type: 'url' as const, url: image }
    : { type: 'base64' as const, media_type: image.mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', data: image.base64 };

  try {
    const outcome = await callClaudeProxyStream({
      model: ZONE_VISION_MODEL,
      max_tokens: 2000,
      messages: [{ role: 'user', content: [
        { type: 'image', source: imageSource },
        { type: 'text', text: ZONE_PROMPT },
      ] }],
    });
    if (!outcome.ok) {
      logToLangfuse('claude-vision-reference-zones', { model: ZONE_VISION_MODEL, level: 'ERROR', statusMessage: outcome.error });
      return null;
    }
    const parsed = extractJson(outcome.result.text) as { zones?: unknown[] } | null;
    logToLangfuse('claude-vision-reference-zones', {
      output: JSON.stringify(parsed), model: ZONE_VISION_MODEL,
      inputTokens: outcome.result.inputTokens, outputTokens: outcome.result.outputTokens,
    });
    if (!parsed || !Array.isArray(parsed.zones)) return null;
    // Normalize the vision's snake_case font_scale -> fontScale, then validate.
    const normalized = parsed.zones.map((z) => {
      const o = z as Record<string, unknown>;
      return { ...o, fontScale: typeof o.fontScale === 'number' ? o.fontScale : (typeof o.font_scale === 'number' ? o.font_scale : 0) };
    });
    const valid = normalized.filter(isValidReferenceZone).map((z) => ({ ...z, bbox: clampBbox(z.bbox) }));
    if (!valid.length) return null;
    return dedupeZones(valid);
  } catch (err) {
    logToLangfuse('claude-vision-reference-zones', { model: ZONE_VISION_MODEL, level: 'ERROR', statusMessage: err instanceof Error ? err.message : 'Unknown error' });
    return null;
  }
}

export async function aiVision(
  messages: unknown[],
  system: string,
  trace: TraceOptions = {}
): Promise<Record<string, unknown>> {
  const traceName = trace.traceName ?? 'claude-vision';

  // Same superset fixture as aiCall — covers the Strategy/Campaign Wizard
  // reference-image path (stage1-with-image reuses the same expected shape
  // as stage1-without-image). Other aiVision consumers with genuinely
  // different shapes (SMM screenshot-metric extraction, ad-review scoring)
  // are NOT in this mock facility's scope — they'll get mismatched fields
  // if exercised under VITE_MOCK_AI, same as any untested edge case.
  if (MOCK_AI_ENABLED) {
    return { ...MOCK_STRATEGY_JSON, _inputTokens: 0, _outputTokens: 0 };
  }

  const quotaErr = await checkQuota();
  if (quotaErr) return { error: quotaErr };

  try {
    const outcome = await callClaudeProxyStream({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      system,
      messages,
    });

    if (!outcome.ok) {
      logToLangfuse(traceName, { input: redactImages(messages), model: CLAUDE_MODEL, level: 'ERROR', statusMessage: outcome.error, metadata: trace.metadata });
      return { error: outcome.error };
    }

    const { text: rawText, inputTokens, outputTokens } = outcome.result;

    const parsed = extractJson(rawText);
    logToLangfuse(traceName, { input: redactImages(messages), output: parsed ?? rawText, model: CLAUDE_MODEL, inputTokens, outputTokens, metadata: trace.metadata });

    if (parsed) return { ...parsed as Record<string, unknown>, _inputTokens: inputTokens, _outputTokens: outputTokens };

    return { raw: rawText, _inputTokens: inputTokens, _outputTokens: outputTokens };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    logToLangfuse(traceName, { input: redactImages(messages), model: CLAUDE_MODEL, level: 'ERROR', statusMessage: msg, metadata: trace.metadata });
    return { error: msg };
  }
}
