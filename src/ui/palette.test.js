import { describe, it, expect } from 'vitest';
import { matchScore, rankPalette } from './palette.js';

/**
 * palette.js — pure ranking model for the ⌘K command palette (M20 §4).
 *
 * matchScore(query, label, keywords?) → number (0 = no match; higher = better;
 * prefix > word-start > subsequence/fuzzy).
 *
 * rankPalette(query, providers, { parseCoordinate? }) → ordered sections
 * [{ key, title, items }]; fixed section order Objects · Actions · Go to ·
 * Tabs; max 6 items per section; empty sections dropped. A query that parses
 * as a coordinate yields a single Go-to coordinate item.
 */

const providers = [
  {
    key: 'objects',
    title: 'Objects',
    items: [
      { label: 'Mast Alpha' },
      { label: 'Mast Bravo' },
      { label: 'Repeater A' },
      { label: 'Waypoint 1' },
    ],
  },
  {
    key: 'actions',
    title: 'Actions',
    items: [
      { label: 'Recompute coverage', keywords: 'run analyse rf' },
      { label: 'Toggle 3D terrain', keywords: 'view tilt' },
      { label: 'Export report', keywords: 'pdf word excel' },
      { label: 'Master volume' }, // deliberate "mast" near-miss for ranking
    ],
  },
  {
    key: 'tabs',
    title: 'Tabs',
    items: [
      { label: 'Coverage' },
      { label: 'Radios' },
      { label: 'Comms plan' },
    ],
  },
];

describe('matchScore — ranking rules', () => {
  it('returns 0 for no match and >0 for a hit', () => {
    expect(matchScore('zzz', 'Mast Alpha')).toBe(0);
    expect(matchScore('mast', 'Mast Alpha')).toBeGreaterThan(0);
  });

  it('prefix beats word-start beats fuzzy', () => {
    const prefix = matchScore('mast', 'Mast Alpha');
    const wordStart = matchScore('alpha', 'Mast Alpha');
    const fuzzy = matchScore('mta', 'Mast Alpha'); // subsequence only
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(fuzzy);
    expect(fuzzy).toBeGreaterThan(0);
  });

  it('is case-insensitive', () => {
    expect(matchScore('MAST', 'mast alpha')).toBe(matchScore('mast', 'Mast Alpha'));
  });

  it('matches against keywords too, but below a label hit', () => {
    const viaLabel = matchScore('recompute', 'Recompute coverage', 'run analyse rf');
    const viaKeyword = matchScore('analyse', 'Recompute coverage', 'run analyse rf');
    expect(viaKeyword).toBeGreaterThan(0);
    expect(viaLabel).toBeGreaterThan(viaKeyword);
  });
});

describe('rankPalette — sections', () => {
  it('keeps the fixed section order: objects above actions on a shared hit', () => {
    const out = rankPalette('mast', providers);
    expect(out.map((s) => s.key)).toEqual(['objects', 'actions']);
    expect(out[0].items.map((i) => i.label)).toEqual(['Mast Alpha', 'Mast Bravo']);
    expect(out[1].items.map((i) => i.label)).toEqual(['Master volume']);
  });

  it('drops sections with no matches', () => {
    const out = rankPalette('coverage', providers);
    const keys = out.map((s) => s.key);
    expect(keys).not.toContain('objects');
    expect(keys).toContain('actions');
    expect(keys).toContain('tabs');
  });

  it('orders items within a section by score', () => {
    const out = rankPalette('cov', providers);
    const tabs = out.find((s) => s.key === 'tabs');
    expect(tabs.items[0].label).toBe('Coverage'); // prefix above any fuzzy hit
  });

  it('caps each section at 6 items', () => {
    const many = [{
      key: 'objects',
      title: 'Objects',
      items: Array.from({ length: 10 }, (_, i) => ({ label: `Mast ${i + 1}` })),
    }];
    const out = rankPalette('mast', many);
    expect(out[0].items).toHaveLength(6);
  });

  it('empty query browses: every provider listed, capped, in order', () => {
    const out = rankPalette('', providers);
    expect(out.map((s) => s.key)).toEqual(['objects', 'actions', 'tabs']);
    for (const s of out) expect(s.items.length).toBeLessThanOrEqual(6);
  });
});

describe('rankPalette — coordinate queries', () => {
  // injected parser keeps the test synthetic — no real-world grid strings
  const parseCoordinate = (text) =>
    text === '00XX0000000000' ? { lat: 0, lng: 0 } : null;

  it('a parsable coordinate becomes a single Go-to item', () => {
    const out = rankPalette('00XX0000000000', providers, { parseCoordinate });
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe('goto');
    expect(out[0].items).toHaveLength(1);
    expect(out[0].items[0].point).toEqual({ lat: 0, lng: 0 });
    expect(out[0].items[0].type).toBe('coordinate');
  });

  it('non-coordinate text ranks providers normally', () => {
    const out = rankPalette('mast', providers, { parseCoordinate });
    expect(out[0].key).toBe('objects');
  });
});
