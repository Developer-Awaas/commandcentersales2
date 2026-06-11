import { supabase } from './supabase';
import { ADMIN_EMAIL } from './constants';

const STORAGE_KEY = 'claude_api_key';
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
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

// Resolution order:
// 1. localStorage 'claude_api_key' (admin's per-browser key — takes priority)
// 2. VITE_ANTHROPIC_API_KEY env var (fallback for pilot users without a per-browser key)
// Both are app-wide reads — there's no per-user/org storage yet. See .env.example for setup.
export function getApiKey(): string | null {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) return stored;
  const envKey = import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined;
  return envKey || null;
}

export async function getTodayAiCallsCount(): Promise<number> {
  return getUserCallCount();
}

export function setApiKey(key: string): void {
  localStorage.setItem(STORAGE_KEY, key);
}

export function isAiEnabled(): boolean {
  const key = getApiKey();
  return typeof key === 'string' && key.trim().length > 0;
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

  const repaired = repairTruncatedJSON(text);
  if (repaired) return repaired;

  return null;
}

export async function aiCall(
  prompt: string,
  system?: string,
  maxTokens: number = 16000
): Promise<Record<string, unknown>> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { error: 'API key not configured. Go to Settings to add your Claude API key.' };
  }

  const quotaErr = await checkQuota();
  if (quotaErr) return { error: quotaErr };

  try {
    const res = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        system: system ?? DEFAULT_SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      let errMsg = `API error ${res.status}`;
      try {
        const parsed = JSON.parse(errBody);
        if (parsed?.error?.message) errMsg = parsed.error.message;
      } catch {
        // ignore
      }
      return { error: errMsg };
    }

    const data = await res.json();
    const inputTokens: number = data?.usage?.input_tokens ?? 0;
    const outputTokens: number = data?.usage?.output_tokens ?? 0;

    const rawText: string = (data?.content ?? [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('');

    const parsed = extractJson(rawText);
    if (parsed) return { ...parsed as Record<string, unknown>, _inputTokens: inputTokens, _outputTokens: outputTokens };

    return { raw: rawText, _inputTokens: inputTokens, _outputTokens: outputTokens };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { error: msg };
  }
}

export async function aiVision(
  messages: unknown[],
  system: string
): Promise<Record<string, unknown>> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { error: 'API key not configured. Go to Settings to add your Claude API key.' };
  }

  const quotaErr = await checkQuota();
  if (quotaErr) return { error: quotaErr };

  try {
    const res = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 16000,
        system,
        messages,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      let errMsg = `API error ${res.status}`;
      try {
        const parsed = JSON.parse(errBody);
        if (parsed?.error?.message) errMsg = parsed.error.message;
      } catch {
        // ignore
      }
      return { error: errMsg };
    }

    const data = await res.json();
    const inputTokens: number = data?.usage?.input_tokens ?? 0;
    const outputTokens: number = data?.usage?.output_tokens ?? 0;

    const rawText: string = (data?.content ?? [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('');

    const parsed = extractJson(rawText);
    if (parsed) return { ...parsed as Record<string, unknown>, _inputTokens: inputTokens, _outputTokens: outputTokens };

    return { raw: rawText, _inputTokens: inputTokens, _outputTokens: outputTokens };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { error: msg };
  }
}
