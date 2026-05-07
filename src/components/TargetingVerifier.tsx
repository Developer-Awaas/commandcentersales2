import { useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getOrgId } from '../lib/constants';
import { aiCall, isAiEnabled } from '../lib/ai-service';
import { Spinner } from './ui/Spinner';
import { CopyButton } from './ui/CopyButton';

type KeywordStatus = 'available' | 'not_found' | 'partial' | 'skip';

interface KeywordItem {
  keyword: string;
  category: 'interest' | 'demographic' | 'behavior';
  status: KeywordStatus;
}

interface Replacement {
  original: string;
  alternatives: string[];
  reason: string;
  altStatuses: Record<number, KeywordStatus>;
}

interface Props {
  interests: string[];
  demographics: string[];
  behaviors: string[];
  platform: string;
  onRegenerate?: (verified: string[], unavailable: string[]) => void;
}

const STATUS_OPTIONS: { value: KeywordStatus; label: string }[] = [
  { value: 'available', label: 'Available ✅' },
  { value: 'not_found', label: 'Not Found ❌' },
  { value: 'partial', label: 'Partial Match ⚠️' },
  { value: 'skip', label: 'Skip ➖' },
];

function KeywordRow({
  item,
  onChange,
}: {
  item: KeywordItem;
  onChange: (status: KeywordStatus) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-border last:border-0">
      <span className="text-sm text-text-primary flex-1">{item.keyword}</span>
      <select
        value={item.status}
        onChange={(e) => onChange(e.target.value as KeywordStatus)}
        className="bg-surface-sunken border border-border rounded-lg text-xs text-text-primary px-2 py-1.5 focus:outline-none focus:border-brand transition-colors"
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

export function TargetingVerifier({ interests, demographics, behaviors, platform, onRegenerate }: Props) {
  const [items, setItems] = useState<KeywordItem[]>(() => {
    const i: KeywordItem[] = [
      ...interests.filter(Boolean).map((k) => ({ keyword: k, category: 'interest' as const, status: 'available' as KeywordStatus })),
      ...demographics.filter(Boolean).map((k) => ({ keyword: k, category: 'demographic' as const, status: 'available' as KeywordStatus })),
      ...behaviors.filter(Boolean).map((k) => ({ keyword: k, category: 'behavior' as const, status: 'available' as KeywordStatus })),
    ];
    return i;
  });

  const [replacements, setReplacements] = useState<Replacement[]>([]);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  const notFoundItems = items.filter((i) => i.status === 'not_found');
  const availableItems = items.filter((i) => i.status === 'available');

  function updateStatus(index: number, status: KeywordStatus) {
    setItems((prev) => prev.map((item, i) => i === index ? { ...item, status } : item));
    setSaved(false);
    setReplacements([]);
  }

  function updateAltStatus(repIdx: number, altIdx: number, status: KeywordStatus) {
    setReplacements((prev) =>
      prev.map((r, i) =>
        i === repIdx
          ? { ...r, altStatuses: { ...r.altStatuses, [altIdx]: status } }
          : r
      )
    );
  }

  async function handleGenerateReplacements() {
    if (!isAiEnabled()) return;
    setLoading(true);

    const notFoundList = notFoundItems.map((i) => `${i.keyword} (${i.category})`).join(', ');
    const availableList = availableItems.map((i) => i.keyword).join(', ');

    const prompt = `These targeting keywords were NOT FOUND in ${platform}: ${notFoundList}.
Suggest ALTERNATIVE keywords that are commonly available in Meta's targeting system. Only suggest well-known, widely available options.
For each not-found keyword, suggest 2-3 alternatives.

Verified AVAILABLE keywords (prefer suggesting similar ones): ${availableList || 'none yet'}.

Return JSON:
{"replacements":[{"original":"not found keyword","alternatives":["alternative 1","alternative 2","alternative 3"],"reason":"why these alternatives work"}]}`;

    const res = await aiCall(prompt);
    const reps = (res.replacements as Array<{ original: string; alternatives: string[]; reason: string }> | undefined) ?? [];
    setReplacements(reps.map((r) => ({ ...r, altStatuses: {} })));

    await saveToDb(items, reps);
    setSaved(true);
    setLoading(false);

    if (onRegenerate) {
      const verified = availableItems.map((i) => i.keyword);
      const unavailable = notFoundItems.map((i) => i.keyword);
      onRegenerate(verified, unavailable);
    }
  }

  async function saveToDb(
    kws: KeywordItem[],
    reps: Array<{ original: string; alternatives: string[]; reason: string }>
  ) {
    const orgId = getOrgId();
    const rows = kws
      .filter((k) => k.status !== 'skip')
      .map((k) => ({
        org_id: orgId,
        keyword: k.keyword,
        category: k.category,
        platform,
        status: k.status === 'partial' ? 'not_found' : k.status,
        times_suggested: 1,
      }));

    if (rows.length > 0) {
      await supabase.from('targeting_keywords').upsert(rows, {
        onConflict: 'keyword,category,platform',
        ignoreDuplicates: false,
      });
    }

    const altRows = reps.flatMap((r) =>
      r.alternatives.map((alt) => ({
        org_id: orgId,
        keyword: alt,
        category: kws.find((k) => k.keyword === r.original)?.category ?? 'interest',
        platform,
        status: 'available',
        times_suggested: 1,
      }))
    );

    if (altRows.length > 0) {
      await supabase.from('targeting_keywords').upsert(altRows, {
        onConflict: 'keyword,category,platform',
        ignoreDuplicates: false,
      });
    }
  }

  const interestItems = items.filter((i) => i.category === 'interest');
  const demographicItems = items.filter((i) => i.category === 'demographic');
  const behaviorItems = items.filter((i) => i.category === 'behavior');
  const interestStart = 0;
  const demographicStart = interestItems.length;
  const behaviorStart = demographicStart + demographicItems.length;

  if (items.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-surface-elevated overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2 mb-0.5">
          <ShieldCheck size={15} className="text-brand" />
          <span className="text-sm font-medium text-text-primary">Verify Targeting</span>
        </div>
        <p className="text-xs text-text-tertiary ml-[23px]">
          Check each keyword in your ad platform. Mark unavailable ones for AI replacement.
        </p>
      </div>

      <div className="px-5 py-4 flex flex-col gap-5">
        {interestItems.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-3">Interests</p>
            {interestItems.map((item, i) => (
              <KeywordRow key={item.keyword} item={item} onChange={(s) => updateStatus(interestStart + i, s)} />
            ))}
          </div>
        )}

        {demographicItems.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-3">Demographics</p>
            {demographicItems.map((item, i) => (
              <KeywordRow key={item.keyword} item={item} onChange={(s) => updateStatus(demographicStart + i, s)} />
            ))}
          </div>
        )}

        {behaviorItems.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-3">Behaviors</p>
            {behaviorItems.map((item, i) => (
              <KeywordRow key={item.keyword} item={item} onChange={(s) => updateStatus(behaviorStart + i, s)} />
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-text-tertiary">
            {notFoundItems.length > 0
              ? `${notFoundItems.length} item${notFoundItems.length !== 1 ? 's' : ''} marked Not Found`
              : 'All keywords marked as available'}
          </p>
          <button
            onClick={handleGenerateReplacements}
            disabled={notFoundItems.length === 0 || loading || !isAiEnabled()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed bg-brand text-white hover:bg-brand-hover"
          >
            {loading ? <Spinner size="sm" /> : <RefreshCw size={13} />}
            {loading ? 'Generating…' : 'Generate Replacements'}
          </button>
        </div>

        {saved && replacements.length === 0 && (
          <p className="text-xs text-brand">Keywords saved. No replacements generated.</p>
        )}

        {replacements.length > 0 && (
          <div className="flex flex-col gap-4 pt-2 border-t border-border">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-brand">Suggested Replacements</p>
            {replacements.map((rep, repIdx) => (
              <div key={repIdx} className="rounded-lg border border-border bg-surface-sunken p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-red-400 line-through">{rep.original}</span>
                  <span className="text-[10px] text-text-tertiary">→</span>
                  <span className="text-[11px] text-text-tertiary">{rep.reason}</span>
                </div>
                {rep.alternatives.map((alt, altIdx) => (
                  <div key={altIdx} className="flex items-center justify-between gap-4 py-2 border-b border-border last:border-0">
                    <span className="text-sm text-text-primary flex-1">{alt}</span>
                    <CopyButton text={alt} />
                    <select
                      value={rep.altStatuses[altIdx] ?? 'available'}
                      onChange={(e) => updateAltStatus(repIdx, altIdx, e.target.value as KeywordStatus)}
                      className="bg-surface-sunken border border-border rounded-lg text-xs text-text-primary px-2 py-1.5 focus:outline-none focus:border-brand transition-colors"
                    >
                      {STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
