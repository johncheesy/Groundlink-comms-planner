import { describe, it, expect, vi } from 'vitest';
import {
  parseTle, toSatrecs, satrecEpochMs, subpointAt, lookAnglesAt, constellationWindow,
} from './leo-pass.js';
import { loadGroupTle, TLE_TTL_MS } from './leo-tle.js';

/**
 * One public CelesTrak element set (Iridium 106, epoch 2026-09-16). Orbital
 * elements are public data, not a site coordinate — the observer positions
 * below are derived from the satellite's own sub-point, never a real site.
 */
const TLE_3LINE = `IRIDIUM 106
1 41917U 17003A   26259.91085878  .00000199  00000+0  64071-4 0  9993
2 41917  86.3944  50.1752 0001924  87.5308 272.6108 14.34216945506359`;
const TLE_2LINE = TLE_3LINE.split('\n').slice(1).join('\n');

const oneSat = () => toSatrecs(parseTle(TLE_3LINE));

describe('parseTle', () => {
  it('parses the 3-line CelesTrak format with names', () => {
    const t = parseTle(TLE_3LINE);
    expect(t).toHaveLength(1);
    expect(t[0].name).toBe('IRIDIUM 106');
    expect(t[0].line1.startsWith('1 41917U')).toBe(true);
    expect(t[0].line2.startsWith('2 41917')).toBe(true);
  });
  it('falls back to the catalogue number when there is no name line', () => {
    const t = parseTle(TLE_2LINE);
    expect(t).toHaveLength(1);
    expect(t[0].name).toBe('41917');
  });
  it('ignores junk and unpaired lines', () => {
    const t = parseTle(`garbage\n1 only a line one\n\n${TLE_3LINE}\n2 orphan`);
    expect(t).toHaveLength(1);
    expect(t[0].name).toBe('IRIDIUM 106');
  });
  it('handles empty input', () => {
    expect(parseTle('')).toEqual([]);
    expect(parseTle(undefined)).toEqual([]);
    expect(toSatrecs([])).toEqual([]);
  });
});

describe('SGP4 geometry sanity', () => {
  it('recovers the element-set epoch', () => {
    const [s] = oneSat();
    const d = new Date(satrecEpochMs(s.satrec));
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(8); // September
    expect(d.getUTCDate()).toBe(16);
  });
  it('sub-point altitude is a LEO altitude', () => {
    const [s] = oneSat();
    const sp = subpointAt(s.satrec, satrecEpochMs(s.satrec));
    expect(sp.heightKm).toBeGreaterThan(700);
    expect(sp.heightKm).toBeLessThan(900);
    expect(Math.abs(sp.latDeg)).toBeLessThanOrEqual(90);
    expect(Math.abs(sp.lngDeg)).toBeLessThanOrEqual(180);
  });
  it('an observer at the sub-point sees the satellite near zenith', () => {
    const [s] = oneSat();
    const t = satrecEpochMs(s.satrec);
    const sp = subpointAt(s.satrec, t);
    const la = lookAnglesAt(s.satrec, t, sp.latDeg, sp.lngDeg);
    expect(la.elevDeg).toBeGreaterThan(85);
    expect(la.azDeg).toBeGreaterThanOrEqual(0);
    expect(la.azDeg).toBeLessThan(360);
    expect(la.rangeKm).toBeCloseTo(sp.heightKm, -1);
  });
  it('an observer at the antipode does not see it', () => {
    const [s] = oneSat();
    const t = satrecEpochMs(s.satrec);
    const sp = subpointAt(s.satrec, t);
    const la = lookAnglesAt(s.satrec, t, -sp.latDeg, ((sp.lngDeg + 360) % 360) - 180);
    expect(la.elevDeg).toBeLessThan(-60);
  });
});

describe('constellationWindow', () => {
  it('reports a satellite overhead now, then a gap within 2 h', () => {
    const sats = oneSat();
    const t = satrecEpochMs(sats[0].satrec);
    const sp = subpointAt(sats[0].satrec, t);
    const w = constellationWindow({ sats, latDeg: sp.latDeg, lngDeg: sp.lngDeg, fromMs: t });
    expect(w.satCount).toBe(1);
    expect(w.nowVisible).toBe(1);
    expect(w.bestNow.name).toBe('IRIDIUM 106');
    expect(w.bestNow.elevDeg).toBeGreaterThan(85);
    expect(w.nextPass).toBeNull();               // visible now → no "next pass"
    expect(w.gaps.length).toBeGreaterThanOrEqual(1); // a single LEO sat cannot cover 2 h
    expect(w.longestGapMin).toBeGreaterThan(30);
    expect(w.availabilityPct).toBeGreaterThan(0);
    expect(w.availabilityPct).toBeLessThan(100);
    expect(w.worst.elevDeg).toBeLessThan(w.maskDeg);
  });
  it('counts duplicates independently (two sets → two visible)', () => {
    const sats = toSatrecs(parseTle(`${TLE_3LINE}\n${TLE_3LINE}`));
    const t = satrecEpochMs(sats[0].satrec);
    const sp = subpointAt(sats[0].satrec, t);
    const w = constellationWindow({ sats, latDeg: sp.latDeg, lngDeg: sp.lngDeg, fromMs: t, horizonMin: 10 });
    expect(w.satCount).toBe(2);
    expect(w.nowVisible).toBe(2);
  });
  it('from the antipode: nothing now, and any next pass rises later and clears the mask', () => {
    const sats = oneSat();
    const t = satrecEpochMs(sats[0].satrec);
    const sp = subpointAt(sats[0].satrec, t);
    const w = constellationWindow({
      sats, latDeg: -sp.latDeg, lngDeg: ((sp.lngDeg + 360) % 360) - 180, fromMs: t, horizonMin: 180,
    });
    expect(w.nowVisible).toBe(0);
    expect(w.gaps[0].startMs).toBe(t);
    if (w.nextPass) {
      expect(w.nextPass.riseMs).toBeGreaterThan(t);
      expect(w.nextPass.peakElevDeg).toBeGreaterThanOrEqual(w.maskDeg);
      expect(w.nextPass.peakMs).toBeGreaterThanOrEqual(w.nextPass.riseMs);
    }
  });
  it('empty constellation → one open-ended gap, zero availability', () => {
    const w = constellationWindow({ sats: [], latDeg: 0, lngDeg: 0, fromMs: 0, horizonMin: 60 });
    expect(w.nowVisible).toBe(0);
    expect(w.bestNow).toBeNull();
    expect(w.worst).toBeNull();
    expect(w.nextPass).toBeNull();
    expect(w.gaps).toEqual([{ startMs: 0, endMs: 3_600_000, openEnded: true }]);
    expect(w.longestGapMin).toBe(60);
    expect(w.availabilityPct).toBe(0);
  });
  it('honours the elevation mask', () => {
    const sats = oneSat();
    const t = satrecEpochMs(sats[0].satrec);
    const sp = subpointAt(sats[0].satrec, t);
    const loose = constellationWindow({ sats, latDeg: sp.latDeg, lngDeg: sp.lngDeg, fromMs: t, maskDeg: 0 });
    const strict = constellationWindow({ sats, latDeg: sp.latDeg, lngDeg: sp.lngDeg, fromMs: t, maskDeg: 60 });
    expect(loose.availabilityPct).toBeGreaterThan(strict.availabilityPct);
  });
});

describe('loadGroupTle', () => {
  const memStorage = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), _m: m };
  };
  const okFetch = (body = TLE_3LINE) => vi.fn(async () => ({ ok: true, status: 200, text: async () => body }));

  it('fetches, caches, and reuses within the TTL', async () => {
    const storage = memStorage();
    const fetchImpl = okFetch();
    const a = await loadGroupTle('iridium-NEXT', { fetchImpl, storage, now: 1000 });
    expect(a.fromCache).toBe(false);
    expect(a.text).toContain('IRIDIUM 106');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://celestrak.org/NORAD/elements/gp.php?GROUP=iridium-NEXT&FORMAT=tle');
    const b = await loadGroupTle('iridium-NEXT', { fetchImpl, storage, now: 1000 + TLE_TTL_MS - 1 });
    expect(b.fromCache).toBe(true);
    expect(b.stale).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('re-fetches after the TTL', async () => {
    const storage = memStorage();
    const fetchImpl = okFetch();
    await loadGroupTle('globalstar', { fetchImpl, storage, now: 0 });
    await loadGroupTle('globalstar', { fetchImpl, storage, now: TLE_TTL_MS + 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('serves a stale copy when the network fails', async () => {
    const storage = memStorage();
    await loadGroupTle('ses', { fetchImpl: okFetch(), storage, now: 0 });
    const failing = vi.fn(async () => { throw new Error('offline'); });
    const r = await loadGroupTle('ses', { fetchImpl: failing, storage, now: TLE_TTL_MS + 1 });
    expect(r.stale).toBe(true);
    expect(r.fromCache).toBe(true);
    expect(r.text).toContain('IRIDIUM 106');
  });
  it('throws when there is neither network nor cache', async () => {
    const failing = vi.fn(async () => ({ ok: false, status: 503, text: async () => '' }));
    await expect(loadGroupTle('ses', { fetchImpl: failing, storage: memStorage(), now: 0 })).rejects.toThrow(/503/);
  });
  it('rejects a non-TLE body (e.g. an HTML error page)', async () => {
    const html = okFetch('<html>rate limited</html>');
    await expect(loadGroupTle('ses', { fetchImpl: html, storage: memStorage(), now: 0 })).rejects.toThrow(/not TLE/);
  });
  it('survives a broken storage object', async () => {
    const broken = { getItem: () => { throw new Error('nope'); }, setItem: () => { throw new Error('nope'); } };
    const r = await loadGroupTle('ses', { fetchImpl: okFetch(), storage: broken, now: 0 });
    expect(r.fromCache).toBe(false);
  });
});
