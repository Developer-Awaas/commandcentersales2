import { useRef, useState } from 'react';
import { AlertCircle, Megaphone, RefreshCw } from 'lucide-react';
import { getOrgId } from '../lib/constants';
import { supabase } from '../lib/supabase';
import { aiCall, isAiEnabled } from '../lib/ai-service';
import { logAiSession, logActivity } from '../lib/session-logger';
import { buildContext } from '../lib/context-builder';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { CopyButton } from '../components/ui/CopyButton';
import { Spinner } from '../components/ui/Spinner';

interface AiPillar {
  pillar?: string;
  name?: string;
  freq?: string;
  frequency?: string;
  purpose: string;
}

interface AiDayPlan {
  day: string;
  type: string;
  topic: string;
  captionEn: string;
  captionOd?: string;
  hashtags: string[];
  bestTime: string;
  nanoPrompt?: string;
  reelScript?: string;
}

interface AiOrganicResult {
  pillars?: AiPillar[];
  weekly?: AiDayPlan[];
  tips?: string[];
}

type ResultState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'raw'; text: string }
  | { status: 'ok'; data: AiOrganicResult };

const DAY_COLORS: Record<string, string> = {
  Monday: '#3b82f6',
  Tuesday: '#22c55e',
  Wednesday: '#2dd4a8',
  Thursday: '#eab308',
  Friday: '#ef4444',
  Saturday: '#ec4899',
  Sunday: '#6b7280',
};

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20">
      <AlertCircle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
      <p className="text-sm text-red-300 flex-1">{message}</p>
      <button onClick={onRetry} className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors flex-shrink-0">
        <RefreshCw size={12} /> Retry
      </button>
    </div>
  );
}

function RawFallback({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
        <p className="text-sm text-amber-300">Response received but could not be parsed as structured data.</p>
        <button onClick={onRetry} className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 ml-3 transition-colors flex-shrink-0">
          <RefreshCw size={12} /> Retry
        </button>
      </div>
      <Card className="p-4">
        <pre className="text-xs text-text-primary whitespace-pre-wrap font-mono leading-relaxed overflow-auto max-h-96">{text}</pre>
      </Card>
    </div>
  );
}

function DayCard({ day }: { day: AiDayPlan }) {
  const color = DAY_COLORS[day.day] ?? '#7a9988';
  return (
    <Card className="overflow-hidden">
      <div className="flex">
        <div className="w-1 flex-shrink-0" style={{ backgroundColor: color }} />
        <div className="flex-1 p-5">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <p className="text-sm font-bold text-text-primary">{day.day}</p>
              <p className="text-xs text-text-tertiary mt-0.5">{day.type} · Best time {day.bestTime}</p>
            </div>
            <p className="text-xs font-medium px-2.5 py-1 rounded-full border flex-shrink-0" style={{ color, backgroundColor: `${color}15`, borderColor: `${color}30` }}>
              {day.type}
            </p>
          </div>

          <p className="text-sm font-semibold text-text-primary mb-3">{day.topic}</p>

          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Caption (English)</p>
              <CopyButton text={day.captionEn} />
            </div>
            <p className="text-xs text-text-primary leading-relaxed bg-surface rounded-lg p-3 border border-border">{day.captionEn}</p>
          </div>

          {day.captionOd && (
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Caption (Odia)</p>
                <CopyButton text={day.captionOd} />
              </div>
              <p className="text-xs text-text-primary leading-relaxed bg-surface rounded-lg p-3 border border-border">{day.captionOd}</p>
            </div>
          )}

          {day.nanoPrompt && (
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Nanobanana Prompt</p>
                <CopyButton text={day.nanoPrompt} />
              </div>
              <div className="rounded-lg border p-3" style={{ background: '#0d4a3810', borderColor: '#2dd4a830' }}>
                <p className="text-xs text-text-primary leading-relaxed font-mono">{day.nanoPrompt}</p>
              </div>
            </div>
          )}

          {day.reelScript && (
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Reel Script</p>
                <CopyButton text={day.reelScript} />
              </div>
              <div className="rounded-lg border p-3 bg-[#1e2e2410] border-border">
                <p className="text-xs text-text-primary leading-relaxed whitespace-pre-wrap">{day.reelScript}</p>
              </div>
            </div>
          )}

          {day.hashtags && day.hashtags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {day.hashtags.map((tag) => (
                <span key={tag} className="px-2 py-0.5 rounded-md text-[11px] text-text-tertiary border border-border bg-surface">{tag}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function AiOrganicOutput({ data, onRetry }: { data: AiOrganicResult; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      {data.pillars && data.pillars.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-3">Content Pillars</p>
          <div className="grid grid-cols-4 gap-4">
            {data.pillars.map((pillar, i) => (
              <Card key={i} className="p-4">
                <p className="text-sm font-semibold text-text-primary mb-1">{pillar.pillar ?? pillar.name}</p>
                <p className="text-[11px] text-[#2dd4a8] mb-2">{pillar.freq ?? pillar.frequency}</p>
                <p className="text-xs text-text-tertiary leading-relaxed">{pillar.purpose}</p>
              </Card>
            ))}
          </div>
        </div>
      )}

      {data.weekly && data.weekly.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-3">Weekly Plan</p>
          <div className="flex flex-col gap-4">
            {data.weekly.map((day) => <DayCard key={day.day} day={day} />)}
          </div>
        </div>
      )}

      {data.tips && data.tips.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-3">Tips & Best Practices</p>
          <Card className="p-4">
            <ul className="flex flex-col gap-2">
              {data.tips.map((tip, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-text-primary">
                  <span className="text-[#2dd4a8] font-bold mt-0.5 flex-shrink-0">{i + 1}.</span>
                  <span className="leading-relaxed">{tip}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <div className="flex justify-end">
        <button onClick={onRetry} className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-[#2dd4a8] transition-colors">
          <RefreshCw size={12} /> Regenerate
        </button>
      </div>
    </div>
  );
}

export function Organic() {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ResultState>({ status: 'idle' });
  const resultRef = useRef<HTMLDivElement>(null);

  async function handleGenerate() {
    setSubmitting(true);
    setResult({ status: 'idle' });

    try {
      if (!isAiEnabled()) {
        setResult({ status: 'error', message: 'Add your Claude API key in Settings to generate an AI content plan.' });
        setSubmitting(false);
        return;
      }

      const [orgRes, projectsRes] = await Promise.all([
        supabase.from('organizations').select('name').eq('id', getOrgId()).maybeSingle(),
        supabase.from('projects').select('name,locality,city,price_range_lacs,usps').eq('org_id', getOrgId()).eq('status', 'active'),
      ]);

      const orgName = orgRes.data?.name ?? 'Real Estate Company';
      const projects = projectsRes.data ?? [];

      const projectList = projects.length > 0
        ? projects.map((p: { name: string; locality?: string; city?: string; price_range_lacs?: string; usps?: string }) =>
            `- ${p.name} (${p.locality ?? ''}${p.city ? `, ${p.city}` : ''}) — Price: ${p.price_range_lacs ?? 'N/A'} Lacs — USPs: ${p.usps ?? 'N/A'}`
          ).join('\n')
        : '- No active projects found';

      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);

      await supabase.from('organic_plans').insert({
        org_id: getOrgId(),
        week_start: weekStart.toISOString().split('T')[0],
        status: 'draft',
      });

      const context = await buildContext();
      const basePrompt = `Generate a weekly organic social media content plan for Instagram and Facebook.
COMPANY: ${orgName}
PROJECTS:
${projectList}
TONE: Professional & Premium
VERNACULAR: Odia enabled

Return ONLY a JSON object:
{"pillars":[{"pillar":"name","freq":"how often","purpose":"why"}],"weekly":[{"day":"Monday","type":"Carousel or Reel or Static","topic":"topic","captionEn":"FULL Instagram caption with emojis","captionOd":"Odia version","hashtags":["15 real hashtags"],"bestTime":"12:30 PM","nanoPrompt":"image prompt if needed","reelScript":"script if reel"}],"tips":["tip"]}

Include all 7 days. Make content specific to the projects above.`;
      const prompt = context ? basePrompt + '\n\n' + context : basePrompt;

      const res = await aiCall(prompt);

      if (res.error) {
        setResult({ status: 'error', message: String(res.error) });
      } else if (res.raw) {
        setResult({ status: 'raw', text: String(res.raw) });
      } else {
        setResult({ status: 'ok', data: res as AiOrganicResult });
        logAiSession(supabase, {
          sessionType: 'organic',
          inputSummary: `Weekly organic plan for ${orgName}`,
          inputData: { projectCount: projects.length },
          outputData: res,
        });
        logActivity(supabase, {
          action: 'generated_organic_plan',
          entityType: 'ai_session',
          details: { projectCount: projects.length },
        });
      }
    } catch (err: unknown) {
      setResult({ status: 'error', message: err instanceof Error ? err.message : 'Unknown error' });
    }

    setSubmitting(false);
    setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }

  return (
    <div className="p-8 min-h-screen bg-surface">
      <div className="flex items-center justify-between mb-7">
        <div className="flex items-center gap-3">
          <Megaphone size={20} className="text-[#2dd4a8]" />
          <div>
            <h1 className="text-xl font-semibold text-text-primary">Organic</h1>
            <p className="text-text-tertiary text-xs mt-0.5">Plan your weekly Instagram and Facebook content</p>
          </div>
        </div>
        <Button onClick={handleGenerate} disabled={submitting}>
          {submitting ? <Spinner size="sm" /> : <Megaphone size={14} />}
          {submitting ? 'Generating…' : 'Generate Plan'}
        </Button>
      </div>

      {result.status !== 'idle' && (
        <div ref={resultRef} className="flex flex-col gap-6">
          {result.status === 'error' && <ErrorBanner message={result.message} onRetry={handleGenerate} />}
          {result.status === 'raw' && <RawFallback text={result.text} onRetry={handleGenerate} />}
          {result.status === 'ok' && <AiOrganicOutput data={result.data} onRetry={handleGenerate} />}
        </div>
      )}
    </div>
  );
}
