import { supabase } from './supabase';
import { ADMIN_EMAIL } from './constants';

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

export async function aiCall(
  prompt: string,
  system?: string,
  maxTokens: number = 16000,
  trace: TraceOptions = {}
): Promise<Record<string, unknown>> {
  const traceName = trace.traceName ?? 'claude-call';

  const quotaErr = await checkQuota();
  if (quotaErr) return { error: quotaErr };

  try {
    const { data, error } = await supabase.functions.invoke('claude-proxy', {
      body: {
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        system: system ?? DEFAULT_SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      },
    });

    if (error) {
      logToLangfuse(traceName, { input: prompt, model: CLAUDE_MODEL, level: 'ERROR', statusMessage: error.message, metadata: trace.metadata });
      return { error: error.message };
    }

    // Anthropic errors come back as { type: 'error', error: { message: '...' } }
    if (data?.type === 'error' || data?.error) {
      const errMsg: string = (data?.error as Record<string,unknown>)?.message as string ?? JSON.stringify(data?.error) ?? 'Anthropic API error';
      logToLangfuse(traceName, { input: prompt, model: CLAUDE_MODEL, level: 'ERROR', statusMessage: errMsg, metadata: trace.metadata });
      return { error: errMsg };
    }

    const inputTokens: number = data?.usage?.input_tokens ?? 0;
    const outputTokens: number = data?.usage?.output_tokens ?? 0;

    const rawText: string = (data?.content ?? [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('');

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
  const imageSource = typeof image === 'string'
    ? { type: 'url' as const, url: image }
    : { type: 'base64' as const, media_type: image.mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', data: image.base64 };

  try {
    const { data, error } = await supabase.functions.invoke('claude-proxy', {
      body: {
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
      },
    });

    if (error) {
      logToLangfuse('claude-vision-describe-image', { model: 'claude-haiku-4-5-20251001', level: 'ERROR', statusMessage: error.message });
      return null;
    }
    const text = (data?.content ?? [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('')
      .trim();
    logToLangfuse('claude-vision-describe-image', {
      output: text,
      model: 'claude-haiku-4-5-20251001',
      inputTokens: data?.usage?.input_tokens,
      outputTokens: data?.usage?.output_tokens,
    });
    return text || null;
  } catch (err) {
    logToLangfuse('claude-vision-describe-image', { model: 'claude-haiku-4-5-20251001', level: 'ERROR', statusMessage: err instanceof Error ? err.message : 'Unknown error' });
    return null;
  }
}

export async function aiVision(
  messages: unknown[],
  system: string,
  trace: TraceOptions = {}
): Promise<Record<string, unknown>> {
  const traceName = trace.traceName ?? 'claude-vision';

  const quotaErr = await checkQuota();
  if (quotaErr) return { error: quotaErr };

  try {
    const { data, error } = await supabase.functions.invoke('claude-proxy', {
      body: {
        model: CLAUDE_MODEL,
        max_tokens: 16000,
        system,
        messages,
      },
    });

    if (error) {
      logToLangfuse(traceName, { input: redactImages(messages), model: CLAUDE_MODEL, level: 'ERROR', statusMessage: error.message, metadata: trace.metadata });
      return { error: error.message };
    }

    if (data?.type === 'error' || data?.error) {
      const errMsg: string = (data?.error as Record<string,unknown>)?.message as string ?? JSON.stringify(data?.error) ?? 'Anthropic API error';
      logToLangfuse(traceName, { input: redactImages(messages), model: CLAUDE_MODEL, level: 'ERROR', statusMessage: errMsg, metadata: trace.metadata });
      return { error: errMsg };
    }

    const inputTokens: number = data?.usage?.input_tokens ?? 0;
    const outputTokens: number = data?.usage?.output_tokens ?? 0;

    const rawText: string = (data?.content ?? [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('');

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
