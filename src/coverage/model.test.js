import { describe, it, expect } from 'vitest';
import {
  fsplDb,
  wattsToDbm,
  dbmToWatts,
  maxRangeM,
  receivedDbm,
  knifeEdgeJ,
  deygoutLossDb,
  earthBulgeM,
  classifyDbm,
  haversineM,
  COVERAGE_CLASS,
  DEFAULT_FLOOR_DBM,
  EFFECTIVE_EARTH_R,
} from './model.js';

describe('unit conversions', () => {
  it('wattsToDbm matches known anchors', () => {
    expect(wattsToDbm(1)).toBeCloseTo(30, 6); // 1 W = 30 dBm
    expect(wattsToDbm(0.001)).toBeCloseTo(0, 6); // 1 mW = 0 dBm
    expect(wattsToDbm(5)).toBeCloseTo(36.99, 2); // 5 W handheld
  });

  it('dbmToWatts is the inverse of wattsToDbm', () => {
    for (const w of [0.001, 0.1, 1, 5, 25, 50]) {
      expect(dbmToWatts(wattsToDbm(w))).toBeCloseTo(w, 9);
    }
  });
});

describe('fsplDb', () => {
  it('matches the engineering form 32.45 + 20log10(dKm) + 20log10(fMHz)', () => {
    expect(fsplDb(1000, 100)).toBeCloseTo(72.45, 1);
    expect(fsplDb(10000, 400)).toBeCloseTo(32.45 + 20 + 20 * Math.log10(400), 1);
  });

  it('adds 6 dB per doubling of distance', () => {
    const d1 = fsplDb(2000, 150);
    const d2 = fsplDb(4000, 150);
    expect(d2 - d1).toBeCloseTo(6.02, 2);
  });

  it('clamps distance below 1 m instead of diverging at the transmitter', () => {
    expect(fsplDb(0, 150)).toBe(fsplDb(1, 150));
    expect(Number.isFinite(fsplDb(0, 150))).toBe(true);
  });
});

describe('maxRangeM ↔ receivedDbm consistency', () => {
  it('signal at maxRangeM equals the floor', () => {
    const params = { eirpDbm: 37, freqMHz: 150, rxGainDbi: 0 };
    const range = maxRangeM({ ...params, floorDbm: DEFAULT_FLOOR_DBM });
    expect(receivedDbm(params, range)).toBeCloseTo(DEFAULT_FLOOR_DBM, 6);
  });

  it('higher EIRP extends range', () => {
    expect(maxRangeM({ eirpDbm: 40, freqMHz: 150 })).toBeGreaterThan(
      maxRangeM({ eirpDbm: 30, freqMHz: 150 }),
    );
  });
});

describe('knife-edge diffraction', () => {
  it('J(v) is 0 for clear paths (v ≤ -0.78)', () => {
    expect(knifeEdgeJ(-0.78)).toBe(0);
    expect(knifeEdgeJ(-5)).toBe(0);
    expect(knifeEdgeJ(-Infinity)).toBe(0);
  });

  it('J(0) is the classic ~6 dB grazing loss', () => {
    expect(knifeEdgeJ(0)).toBeCloseTo(6.03, 1);
  });

  it('loss grows monotonically with v', () => {
    expect(knifeEdgeJ(1)).toBeGreaterThan(knifeEdgeJ(0));
    expect(knifeEdgeJ(3)).toBeGreaterThan(knifeEdgeJ(1));
  });

  it('deygoutLossDb returns 0 with no profile (flat-earth fallback)', () => {
    expect(deygoutLossDb(null, 10, 10, 150, 5000)).toBe(0);
    expect(deygoutLossDb([], 10, 10, 150, 5000)).toBe(0);
  });

  it('deygoutLossDb penalises an obstruction above the line of sight', () => {
    const profile = [{ d: 2500, h: 80 }]; // 80 m hill mid-path, terminals at 10 m
    const loss = deygoutLossDb(profile, 10, 10, 150, 5000);
    expect(loss).toBeGreaterThan(6); // well past grazing
  });

  it('deygoutLossDb is 0 for terrain well below the path', () => {
    const profile = [{ d: 2500, h: -100 }];
    expect(deygoutLossDb(profile, 10, 10, 150, 5000)).toBe(0);
  });
});

describe('earthBulgeM', () => {
  it('matches d1·d2 / 2·Re_eff and peaks mid-path', () => {
    expect(earthBulgeM(5000, 5000)).toBeCloseTo((5000 * 5000) / (2 * EFFECTIVE_EARTH_R), 6);
    expect(earthBulgeM(5000, 5000)).toBeGreaterThan(earthBulgeM(1000, 9000));
  });
});

describe('classifyDbm', () => {
  const t = { excellent: -85, good: -95, marginal: -103, none: -110 };

  it('maps levels to the s1..s5 class indices', () => {
    expect(classifyDbm(-80, t, -120)).toBe(COVERAGE_CLASS.EXCELLENT);
    expect(classifyDbm(-90, t, -120)).toBe(COVERAGE_CLASS.GOOD);
    expect(classifyDbm(-100, t, -120)).toBe(COVERAGE_CLASS.MARGINAL);
    expect(classifyDbm(-108, t, -120)).toBe(COVERAGE_CLASS.POOR);
    expect(classifyDbm(-115, t, -120)).toBe(COVERAGE_CLASS.NONE);
  });

  it('drops below-floor levels to TRANSPARENT (not painted)', () => {
    expect(classifyDbm(-130, t, -120)).toBe(COVERAGE_CLASS.TRANSPARENT);
  });

  it('treats thresholds as inclusive lower bounds', () => {
    expect(classifyDbm(-85, t, -120)).toBe(COVERAGE_CLASS.EXCELLENT);
    expect(classifyDbm(-95, t, -120)).toBe(COVERAGE_CLASS.GOOD);
  });
});

describe('haversineM', () => {
  it('one degree of longitude at the equator is ~111.19 km', () => {
    expect(haversineM(0, 0, 0, 1)).toBeCloseTo(111195, -1);
  });

  it('is symmetric and zero for identical points', () => {
    expect(haversineM(0, 0, 0, 0)).toBe(0);
    expect(haversineM(10, 20, 30, 40)).toBeCloseTo(haversineM(30, 40, 10, 20), 6);
  });
});
