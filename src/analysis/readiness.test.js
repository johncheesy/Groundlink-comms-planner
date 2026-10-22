import { describe, it, expect } from 'vitest';
import {
  computeReadiness, MIN_ASSESSED, READINESS_DIMS,
  dimCoverage, dimPace, dimDeconfliction, dimLinkQuality, dimPower, dimSatcom,
} from './readiness.js';

const none = { coverage: null, pace: null, deconfliction: null, linkQuality: null, power: null, satcom: null };

describe('computeReadiness: no score on thin evidence', () => {
  it('nothing assessed → pending, no score', () => {
    const r = computeReadiness(none);
    expect(r).toMatchObject({ score: null, tier: null, assessed: 0, total: READINESS_DIMS.length, pending: true });
  });
  it('an AOI alone (only satcom is automatic) must not read 100', () => {
    const r = computeReadiness({ ...none, satcom: dimSatcom({ bestStatus: 'ok' }) });
    expect(r.score).toBeNull();
    expect(r.pending).toBe(true);
    expect(r.assessed).toBe(1);
  });
  it('two dimensions are still not enough', () => {
    const r = computeReadiness({ ...none, satcom: 100, coverage: 100 });
    expect(r.score).toBeNull();
    expect(r.assessed).toBe(2);
  });
  it('three dimensions produce a score and report how many it rests on', () => {
    const r = computeReadiness({ ...none, satcom: 100, coverage: 100, pace: 40 });
    expect(MIN_ASSESSED).toBe(3);
    expect(r.pending).toBe(false);
    expect(r.assessed).toBe(3);
    expect(r.total).toBe(6);
    expect(r.score).toBe(80);
    expect(r.tier).toBe('high');
  });
});

describe('computeReadiness: scoring and tiers', () => {
  it('averages only assessed dimensions (unassessed are left out, not zero)', () => {
    expect(computeReadiness({ ...none, coverage: 60, pace: 60, linkQuality: 60 }).score).toBe(60);
  });
  it('tier boundaries: 75 high, 40 mid, below low', () => {
    const at = (n) => computeReadiness({ ...none, coverage: n, pace: n, linkQuality: n }).tier;
    expect(at(75)).toBe('high');
    expect(at(74)).toBe('mid');
    expect(at(40)).toBe('mid');
    expect(at(39)).toBe('low');
  });
  it('all six assessed', () => {
    const r = computeReadiness({ coverage: 100, pace: 100, deconfliction: 100, linkQuality: 100, power: 100, satcom: 100 });
    expect(r.score).toBe(100);
    expect(r.assessed).toBe(6);
  });
});

describe('dimension helpers', () => {
  it('coverage clamps and tolerates missing data', () => {
    expect(dimCoverage(null)).toBeNull();
    expect(dimCoverage({ coveredPct: 140 })).toBe(100);
    expect(dimCoverage({ coveredPct: -5 })).toBe(0);
    expect(dimCoverage({ coveredFracAoi: 0.456 })).toBe(46);
    expect(dimCoverage({})).toBeNull();
  });
  it('pace: share of legs with something assigned', () => {
    expect(dimPace(null)).toBeNull();
    expect(dimPace({ legs: [] })).toBeNull();
    expect(dimPace({ legs: [{ status: 'ok' }, { status: 'asset' }, { status: 'gap' }, { status: 'recommend' }] })).toBe(50);
  });
  it('deconfliction: none = 100, errors weigh more than warnings, floor 0', () => {
    expect(dimDeconfliction(null)).toBeNull();
    expect(dimDeconfliction([])).toBe(100);
    expect(dimDeconfliction([{ severity: 'error' }])).toBe(75);
    expect(dimDeconfliction([{ severity: 'warn' }, { severity: 'warn' }])).toBe(80);
    expect(dimDeconfliction(Array(10).fill({ severity: 'error' }))).toBe(0);
  });
  it('link quality: 20 dB average margin = 100', () => {
    expect(dimLinkQuality(null)).toBeNull();
    expect(dimLinkQuality({})).toBeNull();
    expect(dimLinkQuality({ a: { marginDb: 10 }, b: { marginDb: 30 } })).toBe(100);
    expect(dimLinkQuality({ a: { marginDb: -5 } })).toBe(0);
  });
  it('power and satcom map to percentages', () => {
    expect(dimPower(null)).toBeNull();
    expect(dimPower({ minEnduranceH: 36, missionHours: 72 })).toBe(50);
    expect(dimPower({ minEnduranceH: 200, missionHours: 72 })).toBe(100);
    expect(dimSatcom({ bestStatus: 'warn' })).toBe(60);
    expect(dimSatcom(null)).toBeNull();
    expect(dimSatcom({ bestStatus: 'weird' })).toBeNull();
  });
});
