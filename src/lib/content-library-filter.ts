// Pure Content Library filtering (CC-P5 Step 2/5) — extracted from
// ContentLibrary.tsx so the source+search filter logic is unit-testable
// without mounting the component or mocking Supabase.

export type LibrarySource = 'all' | 'planner' | 'creatives' | 'calendar';

export interface LibraryItem {
  key: string;
  source: 'planner' | 'creatives' | 'calendar';
  sortDate: number;
  dateLabel: string;
  title: string;
  subtitle: string;
  thumbnailUrl?: string;
  status?: string;
}

/** Source-tab filter + case-insensitive search over title/subtitle. */
export function filterLibraryItems<T extends LibraryItem>(items: T[], source: LibrarySource, search: string): T[] {
  const q = search.trim().toLowerCase();
  return items.filter((i) => {
    if (source !== 'all' && i.source !== source) return false;
    if (q && !(i.title.toLowerCase().includes(q) || i.subtitle.toLowerCase().includes(q))) return false;
    return true;
  });
}

/** Per-source counts for the filter-bar badges (plus the 'all' total). */
export function libraryCounts(items: LibraryItem[]): Record<LibrarySource, number> {
  return {
    all: items.length,
    planner: items.filter((i) => i.source === 'planner').length,
    creatives: items.filter((i) => i.source === 'creatives').length,
    calendar: items.filter((i) => i.source === 'calendar').length,
  };
}
