import { describe, it, expect } from 'vitest';
import { tileModel, addEvent, MAX_EVENTS } from './ops-rail.js';

const byKey = (tiles) => Object.fromEntries(tiles.map((t) => [t.key, t]));
const cov = { coveredPct: 71.4, deadZones: [{ areaKm2: 3.1 }, { areaKm2: 1.4 }], weakestDbm: -101 };
const pace = { legs: [
  { tier: 'primary', status: 'ok' }, { tier: 'alternate', status: 'ok' },
  { tier: 'contingency', status: 'recommend' }, { tier: 'emergency', status: 'gap' },
] };

describe('tileModel', () => {
  it('shows a dash with a reason everywhere before any run', () => {
    const t = byKey(tileModel({}));
    expect(t.coverage).toMatchObject({ value: '—', sub: 'no run yet', tone: 'none' });
    expect(t.readiness).toMatchObject({ value: '—', tone: 'none' });
    expect(t.readiness.sub).toMatch(/run coverage/);
    expect(t.link).toMatchObject({ value: '—', sub: 'no radio links', tone: 'none' });
    expect(t.gaps).toMatchObject({ value: '—', tone: 'none' });
    expect(t.pace).toMatchObject({ value: '—', sub: 'no plan yet', tone: 'none' });
    expect(tileModel({}).map((x) => x.key)).toEqual(['coverage', 'readiness', 'link', 'gaps', 'pace']);
  });

  it('coverage rounds the percentage and goes amber when stale', () => {
    expect(byKey(tileModel({ coverage: cov, modelLabel: 'P.1812 · ±6 dB', cellM: 185 })).coverage)
      .toMatchObject({ value: '71 %', sub: 'P.1812 · ±6 dB · 185 m cells', tone: 'ok' });
    expect(byKey(tileModel({ coverage: cov, coverageStale: true })).coverage)
      .toMatchObject({ tone: 'warn', sub: expect.stringMatching(/^stale/) });
  });

  it('readiness stays grey until coverage and a PACE plan exist, even with a score', () => {
    const readiness = { score: 100, tier: 'high', assessed: 3, total: 6, dims: {} };
    expect(byKey(tileModel({ coverage: cov, readiness })).readiness).toMatchObject({ value: '—', tone: 'none' });
    expect(byKey(tileModel({ coverage: cov, readiness })).readiness.sub).toMatch(/PACE/);
    expect(byKey(tileModel({ coverage: cov, pace, readiness })).readiness)
      .toMatchObject({ value: '100', tone: 'ok', sub: '3 of 6 checks' });
    expect(byKey(tileModel({ coverage: cov, pace, readiness: { ...readiness, score: 55, tier: 'mid' } })).readiness.tone).toBe('warn');
    expect(byKey(tileModel({ coverage: cov, pace, readiness: { score: null, assessed: 1, total: 6 } })).readiness)
      .toMatchObject({ value: '—', sub: '1 of 6 checks — more needed' });
  });

  it('weakest link picks the smallest margin and colours by threshold', () => {
    const links = [{ name: 'A–B', marginDb: 14, status: 'ok' }, { name: 'B–C', marginDb: 6, status: 'warn' }];
    expect(byKey(tileModel({ links })).link).toMatchObject({ value: '+6 dB', sub: 'B–C', tone: 'warn' });
    expect(byKey(tileModel({ links: [{ name: 'X', marginDb: -3, status: 'bad' }] })).link).toMatchObject({ value: '−3 dB', tone: 'bad' });
    expect(byKey(tileModel({ links: [{ name: 'X', marginDb: 12, status: 'ok' }] })).link.tone).toBe('ok');
    expect(byKey(tileModel({ links: [], linkCount: 2 })).link).toMatchObject({ value: '—', sub: '2 links not checked' });
  });

  it('dead zones sum the area and name the largest', () => {
    expect(byKey(tileModel({ coverage: cov })).gaps).toMatchObject({ value: '2', sub: '4.5 km² · largest 3.1 km²', tone: 'warn' });
    expect(byKey(tileModel({ coverage: { ...cov, deadZones: [] } })).gaps).toMatchObject({ value: '0', tone: 'ok' });
  });

  it('PACE counts carried tiers and marks the ones to acquire', () => {
    const t = byKey(tileModel({ pace })).pace;
    expect(t).toMatchObject({ value: '2 of 4', sub: '1 to acquire', tone: 'warn' });
    expect(t.boxes.map((b) => b.state)).toEqual(['ok', 'ok', 'warn', 'none']);
    const all = { legs: pace.legs.map((l) => ({ ...l, status: 'ok' })) };
    expect(byKey(tileModel({ pace: all })).pace).toMatchObject({ value: '4 of 4', tone: 'ok' });
  });
});

describe('addEvent', () => {
  it('prepends, caps and skips an immediate repeat', () => {
    let ev = [];
    for (let i = 0; i < MAX_EVENTS + 3; i++) ev = addEvent(ev, { t: '10:00', text: `e${i}` });
    expect(ev).toHaveLength(MAX_EVENTS);
    expect(ev[0].text).toBe(`e${MAX_EVENTS + 2}`);
    const same = addEvent(ev, { t: '10:01', text: ev[0].text });
    expect(same).toBe(ev);
  });
});
