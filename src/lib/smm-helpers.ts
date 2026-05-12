export function toIsoDate(s: string | undefined | null): string | null {
  if (!s) return null;
  const trimmed = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const today = new Date();
  const tryYear = today.getFullYear();
  let d = new Date(`${trimmed} ${tryYear}`);
  if (isNaN(d.getTime())) return null;
  const oneDayMs = 24 * 60 * 60 * 1000;
  if (d.getTime() < today.getTime() - oneDayMs) {
    d = new Date(`${trimmed} ${tryYear + 1}`);
    if (isNaN(d.getTime())) return null;
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function toIsoTime(s: string | undefined | null): string {
  if (!s) return '';
  const trimmed = String(s).trim();
  if (/^\d{2}:\d{2}$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?$/);
  if (!m) return '';
  let h = parseInt(m[1], 10);
  const mm = m[2];
  const ampm = m[3]?.toUpperCase();
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  if (h < 0 || h > 23) return '';
  return `${String(h).padStart(2, '0')}:${mm}`;
}

export function prettifyTime(s: string): string {
  if (!s) return '';
  const m = s.match(/^(\d{2}):(\d{2})$/);
  if (!m) return s;
  let h = parseInt(m[1], 10);
  const mm = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${mm} ${ampm}`;
}

export function dayFromIso(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

export function normalizePlatform(p: string | undefined | null): string {
  const v = String(p ?? '').trim().toLowerCase();
  if (v === 'instagram' || v === 'facebook' || v === 'both') return v;
  return 'both';
}

export function normalizePostType(t: string | undefined | null): string {
  const v = String(t ?? '').trim().toLowerCase();
  if (v === 'reel' || v === 'carousel' || v === 'static' || v === 'story' || v === 'video') return v;
  return 'static';
}

export const PLATFORM_OPTIONS = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'both', label: 'Both (IG + FB)' },
];

export const POST_TYPE_OPTIONS = [
  { value: 'reel', label: 'Reel' },
  { value: 'carousel', label: 'Carousel' },
  { value: 'static', label: 'Static Image' },
  { value: 'story', label: 'Story' },
  { value: 'video', label: 'Video' },
];

export function prettifyPlatform(v: string): string {
  return PLATFORM_OPTIONS.find(o => o.value === v)?.label || v;
}

export function prettifyType(v: string): string {
  return POST_TYPE_OPTIONS.find(o => o.value === v)?.label || v;
}

export type PendingPost = {
  _id: string;
  _edited?: boolean;
  date: string;
  day?: string;
  platform: string;
  type: string;
  category?: string;
  topic: string;
  time?: string;
  captionEn?: string;
  captionOd?: string;
  hashtags?: string[];
  nanoPrompt?: string;
  reelScript?: string;
};
