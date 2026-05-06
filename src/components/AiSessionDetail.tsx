import { X, CheckCircle, Sparkles } from 'lucide-react';
import { CopyButton } from './ui/CopyButton';

interface AiSession {
  id: string;
  session_type: string;
  input_summary?: string;
  input_data?: Record<string, unknown>;
  output_data?: Record<string, unknown>;
  health_score?: number | null;
  created_at: string;
  recommendations?: string[];
  actions_taken?: string[];
}

interface Props {
  session: AiSession;
  onClose: () => void;
}

const SESSION_TYPE_STYLES: Record<string, string> = {
  strategy: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  quick_generate: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  full_strategy: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  ad_config: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  creative: 'bg-pink-500/10 text-pink-400 border-pink-500/30',
  ad_review: 'bg-pink-500/10 text-pink-400 border-pink-500/30',
  analysis: 'bg-[#2dd4a8]/10 text-[#2dd4a8] border-[#2dd4a8]/30',
  organic: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  research: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
};

const SESSION_TYPE_LABEL: Record<string, string> = {
  strategy: 'Strategy',
  quick_generate: 'Quick Generate',
  full_strategy: 'Full Strategy',
  ad_config: 'Ad Config',
  creative: 'Creative',
  ad_review: 'Ad Review',
  analysis: 'Analysis',
  organic: 'Organic',
  research: 'Research',
};

function SectionHeader({ num, title }: { num?: number; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      {num != null && (
        <span className="w-6 h-6 rounded-full bg-[#2dd4a8]/20 border border-[#2dd4a8]/30 text-[#2dd4a8] text-[10px] font-bold flex items-center justify-center flex-shrink-0">
          {num}
        </span>
      )}
      <div className="flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[#2dd4a8]">{title}</p>
        <div className="h-px bg-[#1e2e24] mt-1.5" />
      </div>
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-border last:border-0">
      <span className="text-xs text-text-tertiary min-w-[160px] flex-shrink-0">{label}</span>
      <span className="text-xs text-text-primary flex-1 leading-relaxed">{value || '—'}</span>
      {value && <CopyButton text={value} />}
    </div>
  );
}

function TextCard({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2">
      <p className="text-sm text-text-primary leading-relaxed bg-[#0a0f0d] rounded-lg p-3 border border-border flex-1">
        {text}
      </p>
      <CopyButton text={text} />
    </div>
  );
}

function QuickGenerateOutput({ data }: { data: Record<string, unknown> }) {
  const icebreakers = (data.icebreakers as string[]) ?? [];
  const launchChecklist = (data.launchChecklist as string[]) ?? [];
  const hashtags = (data.hashtags as string[]) ?? [];

  return (
    <div className="flex flex-col gap-6">
      {!!data.idea && (
        <div className="px-4 py-3 rounded-xl bg-[#2dd4a8]/10 border border-[#2dd4a8]/20 flex items-start gap-2">
          <Sparkles size={14} className="text-[#2dd4a8] flex-shrink-0 mt-0.5" />
          <p className="text-sm text-[#2dd4a8]">{String(data.idea)}</p>
        </div>
      )}

      <div>
        <SectionHeader num={1} title="Ad Type" />
        <div className="flex flex-col">
          {!!data.adType && <FieldRow label="Ad Type" value={String(data.adType)} />}
          {!!data.objective && <FieldRow label="Ad Objective" value={String(data.objective)} />}
          {!!data.callToAction && <FieldRow label="CTA" value={String(data.callToAction)} />}
          {!!data.bidStrategy && <FieldRow label="Bid Strategy" value={String(data.bidStrategy)} />}
        </div>
      </div>

      <div>
        <SectionHeader num={2} title="Targeting & Audience" />
        <div className="flex flex-col">
          {!!data.locations && <FieldRow label="Locations" value={String(data.locations)} />}
          {!!data.gender && <FieldRow label="Gender" value={String(data.gender)} />}
          {!!data.ageRange && <FieldRow label="Age Group" value={String(data.ageRange)} />}
          {!!data.interests && <FieldRow label="Interests" value={String(data.interests)} />}
          {!!data.demographics && <FieldRow label="Demographics" value={String(data.demographics)} />}
          {!!data.occupations && <FieldRow label="Occupations" value={String(data.occupations)} />}
          {!!data.behaviors && <FieldRow label="Behaviors" value={String(data.behaviors)} />}
          {!!data.placements && <FieldRow label="Placements" value={String(data.placements)} />}
        </div>
      </div>

      <div>
        <SectionHeader num={3} title="Budget" />
        <div className="flex flex-col">
          {!!data.dailyBudget && <FieldRow label="Daily Budget" value={`₹${data.dailyBudget}`} />}
          {!!data.duration && <FieldRow label="Duration" value={`${data.duration} days`} />}
        </div>
      </div>

      <div>
        <SectionHeader num={4} title="Ad Creative" />
        {!!data.campaignName && (
          <div className="mb-3">
            <p className="text-[10px] text-text-tertiary uppercase tracking-widest mb-1.5">Campaign Name</p>
            <TextCard text={String(data.campaignName)} />
          </div>
        )}
        {!!data.primaryText && (
          <div className="mb-3">
            <p className="text-[10px] text-text-tertiary uppercase tracking-widest mb-1.5">Primary Text</p>
            <TextCard text={String(data.primaryText)} />
          </div>
        )}
        {!!data.primaryTextOdia && (
          <div className="mb-3">
            <p className="text-[10px] text-text-tertiary uppercase tracking-widest mb-1.5">Primary Text (Odia)</p>
            <TextCard text={String(data.primaryTextOdia)} />
          </div>
        )}
        {!!data.headline && (
          <div className="mb-3">
            <p className="text-[10px] text-text-tertiary uppercase tracking-widest mb-1.5">Headline</p>
            <TextCard text={String(data.headline)} />
          </div>
        )}
        {!!data.description && (
          <div className="mb-3">
            <p className="text-[10px] text-text-tertiary uppercase tracking-widest mb-1.5">Description</p>
            <TextCard text={String(data.description)} />
          </div>
        )}
      </div>

      {icebreakers.length > 0 && (
        <div>
          <SectionHeader num={5} title="Icebreakers" />
          <div className="flex flex-col gap-2">
            {icebreakers.map((item, i) => (
              <div key={i} className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-0">
                <span className="text-[11px] text-text-tertiary flex-shrink-0">{i + 1}.</span>
                <span className="text-sm text-text-primary flex-1">{item}</span>
                <CopyButton text={item} />
              </div>
            ))}
          </div>
        </div>
      )}

      {(!!data.creativePrompt || !!data.creativePromptStory) && (
        <div>
          <SectionHeader title="Creative Prompts" />
          {!!data.creativePrompt && (
            <div className="mb-3 p-4 rounded-xl border border-purple-500/30 bg-purple-500/5">
              <p className="text-[10px] text-purple-400 uppercase tracking-widest mb-2">Feed 1080×1080</p>
              <div className="flex items-start gap-2">
                <p className="text-sm text-text-primary italic leading-relaxed flex-1">{String(data.creativePrompt)}</p>
                <CopyButton text={String(data.creativePrompt)} />
              </div>
            </div>
          )}
          {!!data.creativePromptStory && (
            <div className="p-4 rounded-xl border border-purple-500/30 bg-purple-500/5">
              <p className="text-[10px] text-purple-400 uppercase tracking-widest mb-2">Story 1080×1920</p>
              <div className="flex items-start gap-2">
                <p className="text-sm text-text-primary italic leading-relaxed flex-1">{String(data.creativePromptStory)}</p>
                <CopyButton text={String(data.creativePromptStory)} />
              </div>
            </div>
          )}
        </div>
      )}

      {hashtags.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <SectionHeader title="Hashtags" />
            <CopyButton text={hashtags.join(' ')} />
          </div>
          <div className="flex flex-wrap gap-2">
            {hashtags.map((tag, i) => (
              <span key={i} className="px-2.5 py-1 rounded-full bg-[#111916] border border-border text-xs text-text-tertiary">
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {launchChecklist.length > 0 && (
        <div>
          <SectionHeader title="Launch Checklist" />
          <div className="flex flex-col gap-2">
            {launchChecklist.map((item, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <CheckCircle size={13} className="text-[#2dd4a8] flex-shrink-0" />
                <span className="text-sm text-text-primary">{item}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FullStrategyOutput({ data }: { data: Record<string, unknown> }) {
  const campaigns = (data.campaigns as Record<string, unknown>[]) ?? [];

  return (
    <div className="flex flex-col gap-5">
      {!!data.overview && (
        <div className="px-4 py-3.5 rounded-xl bg-[#2dd4a8]/10 border border-[#2dd4a8]/20">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#2dd4a8] mb-1.5">Strategic Overview</p>
          <p className="text-sm text-text-primary leading-relaxed">{String(data.overview)}</p>
        </div>
      )}
      {!!data.budgetAdvice && (
        <div className="px-4 py-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-400 mb-1.5">Budget Advice</p>
          <p className="text-sm text-amber-300 leading-relaxed">{String(data.budgetAdvice)}</p>
        </div>
      )}
      {campaigns.map((c, idx) => {
        const sections = [
          { title: 'Setup', keys: ['project', 'funnelStage', 'objective', 'audience'] },
          { title: 'Targeting', keys: ['locations', 'ageRange', 'gender', 'interests', 'demographics', 'occupations', 'educationLevel', 'lifeEvents', 'behaviors'] },
          { title: 'Placements', keys: ['placements', 'creativeFormat'] },
          { title: 'Budget', keys: ['budget'] },
          { title: 'Creative', keys: ['primaryText', 'headline'] },
          { title: 'Icebreakers', keys: ['icebreakers'] },
        ];
        return (
          <div key={idx} className="rounded-xl border border-border bg-[#111916] overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center gap-3">
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#2dd4a8]/10 text-[#2dd4a8] border border-[#2dd4a8]/20">
                Campaign {idx + 1}
              </span>
              <span className="text-sm font-medium text-text-primary">{String(c.project ?? `Campaign ${idx + 1}`)}</span>
              {!!c.funnelStage && <span className="text-xs text-text-tertiary">{String(c.funnelStage)}</span>}
            </div>
            <div className="px-5 py-4 flex flex-col gap-5">
              {sections.map((sec) => {
                const entries = sec.keys
                  .filter((k) => c[k] != null && c[k] !== '')
                  .map((k) => [k, c[k]] as [string, unknown]);
                if (!entries.length) return null;
                return (
                  <div key={sec.title}>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[#2dd4a8] mb-2 border-b border-border pb-1.5">{sec.title}</p>
                    {entries.map(([key, val]) => {
                      const label = key.replace(/([A-Z])/g, ' $1').trim();
                      const displayVal = Array.isArray(val) ? val.join(', ') : String(val ?? '');
                      return (
                        <div key={key} className="flex items-start justify-between gap-4 py-2 border-b border-border last:border-0">
                          <span className="text-xs text-text-tertiary min-w-[140px] flex-shrink-0 capitalize">{label}</span>
                          <span className="text-xs text-text-primary flex-1">{displayVal || '—'}</span>
                          {displayVal && <CopyButton text={displayVal} />}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AdReviewOutput({ data }: { data: Record<string, unknown> }) {
  const categoryScores = data.categoryScores as Record<string, unknown> | undefined;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4 p-4 rounded-xl bg-[#0a0f0d] border border-border">
        <div className="text-4xl font-bold text-[#2dd4a8]">{String(data.overallScore ?? '—')}</div>
        <div>
          <p className="text-sm font-medium text-text-primary">{String(data.verdict ?? '')}</p>
        </div>
      </div>
      {(data.strengths as string[])?.length > 0 && (
        <div>
          <p className="text-[10px] text-[#2dd4a8] font-semibold uppercase tracking-widest mb-2">Strengths</p>
          {(data.strengths as string[]).map((s, i) => (
            <div key={i} className="flex items-start gap-2 mb-1.5">
              <CheckCircle size={13} className="text-[#2dd4a8] flex-shrink-0 mt-0.5" />
              <span className="text-sm text-text-primary">{s}</span>
            </div>
          ))}
        </div>
      )}
      {(data.issues as string[])?.length > 0 && (
        <div>
          <p className="text-[10px] text-red-400 font-semibold uppercase tracking-widest mb-2">Issues</p>
          {(data.issues as string[]).map((s, i) => (
            <div key={i} className="flex items-start gap-2 mb-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0 mt-1.5" />
              <span className="text-sm text-text-primary">{s}</span>
            </div>
          ))}
        </div>
      )}
      {categoryScores && (
        <div>
          <p className="text-[10px] text-text-tertiary font-semibold uppercase tracking-widest mb-2">Category Scores</p>
          {Object.entries(categoryScores).map(([cat, score]) => (
            <FieldRow key={cat} label={cat} value={String(score)} />
          ))}
        </div>
      )}
    </div>
  );
}

function AnalysisOutput({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4 p-4 rounded-xl bg-[#0a0f0d] border border-border">
        <div className="text-4xl font-bold text-[#2dd4a8]">{String(data.healthScore ?? '—')}</div>
        <div>
          <p className="text-xs text-text-tertiary">Health Score</p>
        </div>
      </div>
      {!!data.scorecard && (
        <div>
          <p className="text-[10px] text-text-tertiary font-semibold uppercase tracking-widest mb-2">Scorecard</p>
          {Object.entries(data.scorecard as Record<string, unknown>).map(([k, v]) => (
            <FieldRow key={k} label={k} value={String(v)} />
          ))}
        </div>
      )}
      {(data.actions as string[])?.length > 0 && (
        <div>
          <p className="text-[10px] text-[#2dd4a8] font-semibold uppercase tracking-widest mb-2">Actions</p>
          {(data.actions as string[]).map((a, i) => (
            <div key={i} className="flex items-start gap-2 mb-1.5">
              <span className="text-[#2dd4a8] text-xs flex-shrink-0">{i + 1}.</span>
              <span className="text-sm text-text-primary">{a}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OrganicOutput({ data }: { data: Record<string, unknown> }) {
  const pillars = data.pillars as unknown[] | undefined;
  const weekly = data.weekly as unknown[] | undefined;

  return (
    <div className="flex flex-col gap-4">
      {pillars && pillars.length > 0 && (
        <div>
          <p className="text-[10px] text-[#2dd4a8] font-semibold uppercase tracking-widest mb-3">Content Pillars</p>
          {pillars.map((p, i) => (
            <div key={i} className="mb-2 p-3 rounded-lg bg-[#0a0f0d] border border-border">
              <p className="text-sm text-text-primary">{JSON.stringify(p)}</p>
            </div>
          ))}
        </div>
      )}
      {weekly && weekly.length > 0 && (
        <div>
          <p className="text-[10px] text-[#2dd4a8] font-semibold uppercase tracking-widest mb-3">Weekly Plan</p>
          {weekly.map((w, i) => (
            <div key={i} className="mb-2 p-3 rounded-lg bg-[#0a0f0d] border border-border">
              <p className="text-sm text-text-primary">{JSON.stringify(w)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CreativesOutput({ data }: { data: Record<string, unknown> }) {
  const variants = data.variants as Record<string, unknown>[] | undefined;
  return (
    <div className="flex flex-col gap-4">
      {variants?.map((v, i) => (
        <div key={i} className="p-4 rounded-xl border border-border bg-[#0a0f0d]">
          <p className="text-xs text-text-tertiary mb-2">Variant {i + 1}</p>
          {Object.entries(v).map(([k, val]) => (
            <FieldRow key={k} label={k} value={String(val)} />
          ))}
        </div>
      ))}
    </div>
  );
}

function GenericOutput({ data }: { data: Record<string, unknown> }) {
  return (
    <pre className="text-xs text-text-tertiary leading-relaxed bg-[#0a0f0d] rounded-lg p-4 border border-border overflow-x-auto whitespace-pre-wrap">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

function OutputSection({ session }: { session: AiSession }) {
  const data = session.output_data;
  if (!data || Object.keys(data).length === 0) {
    return <p className="text-sm text-text-tertiary">No output data recorded.</p>;
  }

  if ('idea' in data) return <QuickGenerateOutput data={data} />;
  if ('campaigns' in data) return <FullStrategyOutput data={data} />;
  if ('overallScore' in data) return <AdReviewOutput data={data} />;
  if ('healthScore' in data) return <AnalysisOutput data={data} />;
  if ('variants' in data) return <CreativesOutput data={data} />;
  if ('pillars' in data || 'weekly' in data) return <OrganicOutput data={data} />;
  return <GenericOutput data={data} />;
}

export function AiSessionDetail({ session, onClose }: Props) {
  const typeStyle = SESSION_TYPE_STYLES[session.session_type] ?? SESSION_TYPE_STYLES['strategy'];
  const typeLabel = SESSION_TYPE_LABEL[session.session_type] ?? session.session_type;
  const dateStr = new Date(session.created_at).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const inputData = session.input_data as Record<string, unknown> | undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm overflow-y-auto py-8"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative w-full mx-4 rounded-2xl border border-border flex flex-col"
        style={{ maxWidth: 900, background: '#111916' }}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-border rounded-t-2xl" style={{ background: '#111916' }}>
          <div className="flex items-center gap-3">
            <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${typeStyle}`}>
              {typeLabel}
            </span>
            <span className="text-xs text-text-tertiary">{dateStr}</span>
            {session.health_score != null && (
              <span className="text-xs font-semibold text-[#2dd4a8]">Score: {session.health_score}</span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-[#1e2e24] transition-all"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-6 flex flex-col gap-8">
          {session.input_summary && (
            <div>
              <SectionHeader title="Input Summary" />
              <p className="text-sm text-text-primary leading-relaxed">{session.input_summary}</p>
            </div>
          )}

          {inputData && Object.keys(inputData).length > 0 && (
            <div>
              <SectionHeader title="Input Data" />
              <div className="flex flex-col">
                {Object.entries(inputData).map(([k, v]) => (
                  <FieldRow key={k} label={k.replace(/_/g, ' ')} value={Array.isArray(v) ? v.join(', ') : String(v ?? '')} />
                ))}
              </div>
            </div>
          )}

          <div>
            <SectionHeader title="Output" />
            <OutputSection session={session} />
          </div>

          {session.recommendations && session.recommendations.length > 0 && (
            <div>
              <SectionHeader title="Recommendations" />
              <div className="flex flex-col gap-2">
                {session.recommendations.map((r, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-[#2dd4a8] text-xs flex-shrink-0 mt-0.5">{i + 1}.</span>
                    <span className="text-sm text-text-primary">{r}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {session.actions_taken && session.actions_taken.length > 0 && (
            <div>
              <SectionHeader title="Actions Taken" />
              <div className="flex flex-col gap-2">
                {session.actions_taken.map((a, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <CheckCircle size={13} className="text-[#2dd4a8] flex-shrink-0" />
                    <span className="text-sm text-text-primary">{a}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
