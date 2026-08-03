// Pure date-bucketing helpers for the Dashboard calendar (CC-P5 Step 3).
// Kept free of React / Supabase so they're unit-testable in isolation.

export interface AgendaItem {
  id: string;
  date: string;          // 'YYYY-MM-DD' (smm_calendar.post_date)
  time: string | null;   // 'HH:MM[:SS]' or null (smm_calendar.post_time)
  title: string;
  status: string;        // planned | created | posted | skipped
  platform: string;
}

export interface MonthCell {
  iso: string;           // 'YYYY-MM-DD'
  day: number;           // 1..31
  inMonth: boolean;      // false for leading/trailing days of adjacent months
  count: number;         // number of agenda items on this day
}

/** YYYY-MM-DD for a Date in LOCAL time (avoids UTC off-by-one on toISOString). */
export function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Count of agenda items per 'YYYY-MM-DD'. */
export function countByDate(items: AgendaItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    if (!it.date) continue;
    out[it.date] = (out[it.date] ?? 0) + 1;
  }
  return out;
}

/**
 * A 6-row × 7-col month grid (Sunday-first) for the given year/month
 * (month is 0-indexed, like Date). Leading/trailing cells come from the
 * adjacent months with inMonth=false. `counts` maps 'YYYY-MM-DD' → count.
 */
export function buildMonthGrid(year: number, month: number, counts: Record<string, number>): MonthCell[][] {
  const first = new Date(year, month, 1);
  const startOffset = first.getDay(); // 0=Sun
  const gridStart = new Date(year, month, 1 - startOffset);

  const weeks: MonthCell[][] = [];
  const cursor = new Date(gridStart);
  for (let w = 0; w < 6; w++) {
    const row: MonthCell[] = [];
    for (let d = 0; d < 7; d++) {
      const iso = isoDay(cursor);
      row.push({
        iso,
        day: cursor.getDate(),
        inMonth: cursor.getMonth() === month,
        count: counts[iso] ?? 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(row);
  }
  return weeks;
}

/** Items on a specific 'YYYY-MM-DD', sorted by time (untimed last). */
export function itemsForDate(items: AgendaItem[], iso: string): AgendaItem[] {
  return items
    .filter((it) => it.date === iso)
    .sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99'));
}

/**
 * Upcoming items from `todayIso` forward (inclusive), sorted by date then time,
 * limited to `limit`. Past items are excluded.
 */
export function upcomingItems(items: AgendaItem[], todayIso: string, limit = 5): AgendaItem[] {
  return items
    .filter((it) => it.date >= todayIso)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return (a.time ?? '99:99').localeCompare(b.time ?? '99:99');
    })
    .slice(0, limit);
}
