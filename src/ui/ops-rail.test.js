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
    expect(tileModel({}).map((x) => x.key).slice(0, 5)).toEqual(['coverage', 'readiness', 'link', 'gaps', 'pace']);
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

describe('tileModel — tiles 6 to 11', () => {
  it('has eleven tiles in order when everything is present, nine without drone and cellular', () => {
    const keys = tileModel({ drone: { hasDrone: true, altM: 100 }, cellular: { on: true, towerCount: 3, best: { operator: 'KPN', radio: 'LTE', distanceM: 800 } } }).map((t) => t.key);
    expect(keys).toEqual(['coverage', 'readiness', 'link', 'gaps', 'pace', 'drone', 'power', 'cellular', 'spectrum', 'satcom', 'teams']);
    expect(tileModel({}).map((t) => t.key)).toEqual(['coverage', 'readiness', 'link', 'gaps', 'pace', 'power', 'spectrum', 'satcom', 'teams']);
  });
  it('drone shows the gain over a ground mast', () => {
    expect(byKey(tileModel({ drone: { hasDrone: true, altM: 100, result: { gainPts: 12.4, altFrac: 0.83 } } })).drone)
      .toMatchObject({ value: '100 m AGL', sub: '+12 pts vs ground · 83 % at height', tone: 'ok' });
    expect(byKey(tileModel({ drone: { hasDrone: true, altM: 50, computing: true } })).drone.sub).toBe('computing…');
  });
  it('endurance is the tightest battery node against the mission length', () => {
    const power = { missionHours: 8, rows: [{ name: 'HQ', supply: 'mains' }, { name: 'Operator', supply: 'battery', enduranceHours: 6.5 }, { name: 'Relay', supply: 'battery', enduranceHours: 11 }] };
    expect(byKey(tileModel({ power })).power).toMatchObject({ value: '6.5 h', sub: 'limiting: Operator · mission 8 h', tone: 'warn' });
    expect(byKey(tileModel({ power: { ...power, missionHours: 4 } })).power.tone).toBe('ok');
    expect(byKey(tileModel({ power: { ...power, missionHours: 20 } })).power.tone).toBe('bad');
    expect(byKey(tileModel({})).power).toMatchObject({ value: '—', sub: 'no power plan' });
  });
  it('cellular names the best network and distance; spectrum counts conflicts', () => {
    expect(byKey(tileModel({ cellular: { on: true, towerCount: 12, best: { operator: 'KPN', radio: 'LTE', distanceM: 1500 } } })).cellular)
      .toMatchObject({ value: 'KPN LTE', sub: '12 towers · nearest 1.5 km', tone: 'ok' });
    expect(byKey(tileModel({ spectrum: { radios: 3, errors: 1, warnings: 2 } })).spectrum).toMatchObject({ value: '3 conflicts', tone: 'bad' });
    expect(byKey(tileModel({ spectrum: { radios: 2, errors: 0, warnings: 0 } })).spectrum).toMatchObject({ value: '0 conflicts', sub: '2 radios clear', tone: 'ok' });
    expect(byKey(tileModel({ spectrum: { radios: 1 } })).spectrum).toMatchObject({ value: '—', sub: 'add a second radio to check' });
  });
  it('satcom reads the best GEO look angle; teams sums users', () => {
    expect(byKey(tileModel({ satcom: { bestGeo: { label: 'Inmarsat 4-F2', elevation: 27.6, status: 'ok' } } })).satcom)
      .toMatchObject({ value: '28°', sub: 'Inmarsat 4-F2 · clear look angle', tone: 'ok' });
    expect(byKey(tileModel({ satcom: { bestGeo: null } })).satcom).toMatchObject({ value: '—', tone: 'bad' });
    expect(byKey(tileModel({ teams: { teamCount: 3, operatorCount: 14, channelsNeeded: 2 } })).teams)
      .toMatchObject({ value: '3 teams', sub: '14 users · 2 channels' });
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
