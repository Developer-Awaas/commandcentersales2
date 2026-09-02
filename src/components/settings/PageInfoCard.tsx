/**
 * Page Info — what Meta says about the Page this org publishes to.
 *
 * This is the only surface in the product that READS a Page rather than
 * writing to it, which is what makes it the demonstrable use of
 * pages_read_engagement: the follower count below comes from
 * GET /{page}?fields=name,fan_count,followers_count, and the @handle comes
 * from the same call's instagram_business_account expansion.
 *
 * Two deliberate constraints, both because this renders on camera during
 * Meta's app review recording:
 *
 *  1. FIXED MIN-HEIGHT. Loading, loaded and error all occupy the same box, so
 *     the "Choose a Page" control above never moves under it. A card that
 *     grows when data lands shifts the thing the reviewer is being asked to
 *     watch.
 *  2. AN ABSENT INSTAGRAM LINK IS NOT AN ERROR. A Page with no linked IG
 *     account simply omits that row. Rendering "none" or an error there would
 *     read as a broken connection on a Page that is working perfectly.
 */
import { useCallback, useEffect, useState } from 'react';
import { Instagram, Users, RefreshCw, AlertCircle } from 'lucide-react';
import { supabase, extractFunctionErrorMessage } from '../../lib/supabase';
import { Spinner } from '../ui/Spinner';

export interface PageInfo {
  page_id: string;
  name: string;
  fan_count: number | null;
  followers_count: number | null;
  ig_username: string | null;
}

interface PageInfoCardProps {
  /** The chosen publish target. Null renders nothing — there is nothing to describe. */
  pageId: string | null;
}

export function PageInfoCard({ pageId }: PageInfoCardProps) {
  const [info, setInfo] = useState<PageInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('meta-publish-targets', {
        body: { action: 'page_info', page_id: id },
      });
      const res = (data ?? {}) as Partial<PageInfo> & { ok?: boolean; error?: string };
      if (fnErr || !res.ok) {
        setInfo(null);
        setError(res.error ?? (await extractFunctionErrorMessage(fnErr, 'Could not load Page details')));
        return;
      }
      setInfo(res as PageInfo);
    } finally {
      setLoading(false);
    }
  }, []);

  // Covers both entry points the spec asks for with one effect: section mount
  // with a target already chosen, and a fresh selection changing pageId.
  useEffect(() => {
    if (!pageId) { setInfo(null); setError(null); return; }
    void load(pageId);
  }, [pageId, load]);

  if (!pageId) return null;

  // Followers is the number a marketer recognises. fan_count (Page likes) is
  // the older metric and is not returned for every Page, so it is the
  // fallback, labelled honestly rather than relabelled as followers.
  const followers = info?.followers_count ?? null;
  const likes = info?.fan_count ?? null;
  const count = followers ?? likes;
  const countLabel = followers !== null ? 'followers' : 'Page likes';

  return (
    <div className="flex flex-col gap-2 px-3 py-2.5 rounded-lg bg-surface border border-border min-h-[86px] justify-center">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-widest text-text-tertiary">Page info</span>
        <button
          onClick={() => void load(pageId)}
          disabled={loading}
          title="Reload from Meta"
          className="text-text-tertiary hover:text-text-primary disabled:opacity-40 transition-colors"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : undefined} />
        </button>
      </div>

      {loading && !info && (
        <span className="flex items-center gap-2 text-[11px] text-text-tertiary">
          <Spinner size="sm" /> Reading Page details from Meta…
        </span>
      )}

      {!loading && error && (
        <span className="flex items-start gap-1.5 text-[11px] text-amber-400">
          <AlertCircle size={12} className="mt-0.5 shrink-0" /> {error}
        </span>
      )}

      {info && !error && (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-text-primary truncate">{info.name}</span>
          <span className="flex items-center gap-1.5 text-[11px] text-text-secondary">
            <Users size={11} className="shrink-0 text-text-tertiary" />
            {count === null
              ? <span className="text-text-tertiary">Follower count not reported for this Page</span>
              : <><strong className="text-text-primary tabular-nums">{count.toLocaleString('en-IN')}</strong> {countLabel}</>}
          </span>
          {/* Omitted entirely when the Page has no linked Instagram account. */}
          {info.ig_username && (
            <span className="flex items-center gap-1.5 text-[11px] text-text-secondary">
              <Instagram size={11} className="shrink-0 text-text-tertiary" />
              <span className="text-text-primary">@{info.ig_username}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
