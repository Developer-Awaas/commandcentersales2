import { describe, it, expect } from 'vitest';
import { isoDay, countByDate, buildMonthGrid, itemsForDate, upcomingItems, type AgendaItem } from './calendar-agenda';

const mk = (id: string, date: string, time: string | null = null): AgendaItem => ({
  id, date, time, title: `post ${id}`, status: 'planned', platform: 'instagram',
});

describe('isoDay', () => {
  it('formats a local date as YYYY-MM-DD without UTC shift', () => {
    // Local midnight — toISOString() would roll back a day in +TZ; isoDay must not.
    expect(isoDay(new Date(2026, 7, 3))).toBe('2026-08-03'); // month is 0-indexed → August
  });
});

describe('countByDate', () => {
  it('counts items per date', () => {
    const counts = countByDate([mk('a', '2026-08-03'), mk('b', '2026-08-03'), mk('c', '2026-08-04')]);
    expect(counts['2026-08-03']).toBe(2);
    expect(counts['2026-08-04']).toBe(1);
  });
  it('ignores rows with no date', () => {
    const counts = countByDate([mk('a', ''), mk('b', '2026-08-03')]);
    expect(counts['2026-08-03']).toBe(1);
    expect(Object.keys(counts)).toHaveLength(1);
  });
});

describe('buildMonthGrid', () => {
  it('returns a 6×7 grid', () => {
    const grid = buildMonthGrid(2026, 7, {});
    expect(grid).toHaveLength(6);
    grid.forEach((w) => expect(w).toHaveLength(7));
  });
  it('marks in-month vs adjacent-month cells and starts Sunday-first', () => {
    // Aug 2026: the 1st is a Saturday, so the first row is Jul 26–Aug 1.
    const grid = buildMonthGrid(2026, 7, {});
    expect(grid[0][0].iso).toBe('2026-07-26');
    expect(grid[0][0].inMonth).toBe(false);
    expect(grid[0][6].iso).toBe('2026-08-01');
    expect(grid[0][6].inMonth).toBe(true);
  });
  it('attaches counts to the right cells', () => {
    const grid = buildMonthGrid(2026, 7, { '2026-08-01': 3 });
    const aug1 = grid.flat().find((c) => c.iso === '2026-08-01');
    expect(aug1?.count).toBe(3);
  });
});

describe('itemsForDate', () => {
  it('filters to the date and sorts by time (untimed last)', () => {
    const items = [mk('a', '2026-08-03', '18:00'), mk('b', '2026-08-03', null), mk('c', '2026-08-03', '09:00'), mk('d', '2026-08-04', '10:00')];
    const res = itemsForDate(items, '2026-08-03').map((i) => i.id);
    expect(res).toEqual(['c', 'a', 'b']);
  });
});

describe('upcomingItems', () => {
  it('excludes past items and sorts by date then time', () => {
    const items = [mk('past', '2026-07-30'), mk('later', '2026-08-05', '10:00'), mk('soonPM', '2026-08-03', '18:00'), mk('soonAM', '2026-08-03', '09:00')];
    const res = upcomingItems(items, '2026-08-03', 5).map((i) => i.id);
    expect(res).toEqual(['soonAM', 'soonPM', 'later']);
  });
  it('respects the limit', () => {
    const items = Array.from({ length: 10 }, (_, i) => mk(String(i), `2026-08-1${i % 10}`));
    expect(upcomingItems(items, '2026-08-10', 3)).toHaveLength(3);
  });
});
