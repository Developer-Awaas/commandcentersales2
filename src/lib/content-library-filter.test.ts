import { describe, it, expect } from 'vitest';
import { filterLibraryItems, libraryCounts, type LibraryItem } from './content-library-filter';

const mk = (key: string, source: LibraryItem['source'], title: string, subtitle = ''): LibraryItem => ({
  key, source, title, subtitle, sortDate: 0, dateLabel: '1 Aug 2026',
});

const items: LibraryItem[] = [
  mk('p1', 'planner', 'Awareness plan', 'goal: reach'),
  mk('c1', 'creatives', 'Diwali creative', 'festive greeting'),
  mk('c2', 'creatives', 'Amenity spotlight', 'rooftop pool'),
  mk('k1', 'calendar', 'Floor plan reveal', 'swipe to explore'),
];

describe('filterLibraryItems', () => {
  it('returns all when source=all and no search', () => {
    expect(filterLibraryItems(items, 'all', '')).toHaveLength(4);
  });
  it('filters by source', () => {
    expect(filterLibraryItems(items, 'creatives', '').map((i) => i.key)).toEqual(['c1', 'c2']);
    expect(filterLibraryItems(items, 'planner', '').map((i) => i.key)).toEqual(['p1']);
    expect(filterLibraryItems(items, 'calendar', '').map((i) => i.key)).toEqual(['k1']);
  });
  it('search matches title OR subtitle, case-insensitive', () => {
    expect(filterLibraryItems(items, 'all', 'POOL').map((i) => i.key)).toEqual(['c2']);
    expect(filterLibraryItems(items, 'all', 'plan').map((i) => i.key).sort()).toEqual(['k1', 'p1']);
  });
  it('combines source + search', () => {
    expect(filterLibraryItems(items, 'creatives', 'plan')).toHaveLength(0);
    expect(filterLibraryItems(items, 'calendar', 'floor').map((i) => i.key)).toEqual(['k1']);
  });
});

describe('libraryCounts', () => {
  it('counts per source and total', () => {
    expect(libraryCounts(items)).toEqual({ all: 4, planner: 1, creatives: 2, calendar: 1 });
  });
});
