import { describe, it, expect } from 'vitest';
import { linkRows, siteRows, sortRows, summaryFigures, gapRows, radioRows } from './ops-drawer.js';

describe('gapRows', () => {
  it('numbers zones, finds the nearest site and shortens the advice', () => {
    const zones = [{ centroid: { lat: 52.11, lng: 5.11 }, areaKm2: 3.14 }, { centroid: { lat: 52.00, lng: 5.00 }, areaKm2: 0.4 }];
    const rows = gapRows(zones, [{ id: 'a', name: 'Ridge', lat: 52.10, lng: 5.10 }, { id: 'b', name: 'Barn', lat: 52.3, lng: 5.3 }], (a) => (a < 1 ? 'Small gap — raise the mast.' : 'Medium gap — deploy a relay.'));
    expect(rows[0]).toMatchObject({ n: 1, areaKm2: 3.14, nearest: 'Ridge', advice: 'Medium gap' });
    expect(rows[0].distanceM).toBeGreaterThan(1000);
    expect(rows[0].distanceM).toBeLessThan(1500);
    expect(rows[1]).toMatchObject({ n: 2, nearest: 'Ridge', advice: 'Small gap' });
    expect(gapRows([{ centroid: { lat: 0, lng: 0 }, areaKm2: 1 }], [])[0]).toMatchObject({ nearest: '—', distanceM: null });
  });
});

describe('radioRows', () => {
  it('lists the arsenal with the roles each radio was assigned to', () => {
    const r1 = { id: 'r1', label: 'DP4801', role: 'handheld', freqRangeMHz: [136, 174], powerW: 5, rxSensDbm: -116, antennaGainDbi: 2.15, feederLossDb: 0 };
    const r2 = { id: 'r2', label: 'XPR 5550', role: 'mobile', freqRangeMHz: [403, 470], powerW: 45 };
    const roles = [{ label: 'Operator (manpack)', radio: r1 }, { label: 'HQ (static)', radio: r2 }, { label: 'Mobile command post (veh.)', radio: r2 }, { label: 'Rebro / repeater (static)', radio: null }];
    const rows = radioRows([r1, r2], roles);
    expect(rows[0]).toMatchObject({ label: 'DP4801', role: 'handheld', band: '136–174', bandLo: 136, powerW: 5, carriedBy: 'Operator' });
    expect(rows[1]).toMatchObject({ band: '403–470', feederLossDb: 0, antennaGainDbi: null, carriedBy: 'HQ, Mobile command post' });
    expect(radioRows([r1], [])[0].carriedBy).toBe('not assigned');
  });
});

const sites = [
  { id: 's1', name: 'Ridge', lat: 52.10, lng: 5.10, txHeightM: 25 },
  { id: 's2', name: 'Barn', lat: 52.08, lng: 5.14, powerW: 10, azimuthDeg: 240 },
  { id: 's3', name: 'Lone', lat: 52.00, lng: 5.00 },
];
const links = [
  { id: 'l1', a: 's1', b: 's2', label: '', freqMHz: 450 },
  { id: 'l2', a: 's2', b: 's3', label: 'Backhaul' },
  { id: 'l9', a: 's1', b: 'gone' },
];
const checks = {
  l1: { budget: { marginDb: 14 }, obstructed: false },
  l2: { budget: { marginDb: -3 }, obstructed: true },
};
const defaults = { heightM: 10, powerW: 5, eirpDbm: (w) => 10 * Math.log10(w * 1000) + 2.15 };

describe('linkRows', () => {
  it('names, measures and classifies links; drops a link to a missing site', () => {
    const rows = linkRows(links, sites, (l) => checks[l.id] ?? null);
    expect(rows.map((r) => r.id)).toEqual(['l1', 'l2']);
    expect(rows[0]).toMatchObject({ name: 'Ridge – Barn', ends: 'Ridge → Barn', freqMHz: 450, marginDb: 14, status: 'ok', statusText: 'closes' });
    expect(rows[0].lengthM).toBeGreaterThan(3000);
    expect(rows[0].lengthM).toBeLessThan(4000);
    expect(rows[1]).toMatchObject({ name: 'Backhaul', marginDb: -3, status: 'bad' });
  });
  it('marks an unchecked link', () => {
    const [r] = linkRows([links[0]], sites);
    expect(r).toMatchObject({ marginDb: null, status: 'unknown', statusText: 'not checked' });
  });
});

describe('siteRows', () => {
  it('falls back to the panel height and power and flags which are its own', () => {
    const lr = linkRows(links, sites, (l) => checks[l.id] ?? null);
    const rows = siteRows(sites, lr, links, defaults);
    expect(rows[0]).toMatchObject({ name: 'Ridge', heightM: 25, ownHeight: true, powerW: 5, ownPower: false, links: 1, status: 'ok', azimuthDeg: null });
    expect(rows[1]).toMatchObject({ heightM: 10, ownHeight: false, powerW: 10, ownPower: true, azimuthDeg: 240, links: 2, status: 'bad', statusText: '2 of 2 checked' });
    expect(rows[2]).toMatchObject({ links: 1, status: 'bad' });
    expect(Math.round(rows[1].eirpDbm)).toBe(42);
  });
  it('reads "no links" and "not checked" states', () => {
    expect(siteRows([sites[2]], [], [], defaults)[0]).toMatchObject({ links: 0, status: 'unknown', statusText: 'no links' });
    const lr = linkRows([links[0]], sites);
    expect(siteRows([sites[0]], lr, [links[0]], defaults)[0]).toMatchObject({ status: 'unknown', statusText: 'links not checked' });
  });
});

describe('sortRows', () => {
  const rows = [{ n: 'b', v: 2, s: 'ok' }, { n: 'A', v: null, s: 'bad' }, { n: 'c', v: 1, s: 'warn' }];
  it('sorts strings case-insensitively and numbers with nulls last', () => {
    expect(sortRows(rows, 'n').map((r) => r.n)).toEqual(['A', 'b', 'c']);
    expect(sortRows(rows, 'v').map((r) => r.v)).toEqual([1, 2, null]);
    expect(sortRows(rows, 'v', 'desc').map((r) => r.v)).toEqual([2, 1, null]);
  });
  it('sorts status worst first by default', () => {
    expect(sortRows(rows.map((r) => ({ status: r.s })), 'status').map((r) => r.status)).toEqual(['bad', 'warn', 'ok']);
  });
});

describe('summaryFigures', () => {
  it('formats the three figures and handles no summary', () => {
    expect(summaryFigures(null)).toBeNull();
    expect(summaryFigures({ coveredPct: 71.4, deadZones: [{}], weakestDbm: -101, weakestBelow: false }))
      .toEqual({ covered: '71 %', zones: '1 dead zone', weakest: '≥ -101 dBm' });
  });
});
