import { describe, it, expect } from 'vitest';
import {
  p1812Loss,
  receivedDbmP1812,
  terminalClutterDb,
  invCumNorm,
  medianEffectiveEarthKm,
  refractivityForLatitude,
  beta0Percent,
} from './p1812.js';
import { classifyDbm, COVERAGE_CLASS } from './model.js';
import { buildProfileP1812 } from '../workers/profile.js';

/**
 * All profiles are SYNTHETIC (distances + heights only — no coordinates,
 * per the OPSEC rule). Reference values for the anchor cases are hand-derived
 * from the ITU-R P.1812-6 Annex 1 equations with the default temperate
 * climate (ΔN = 45 → ae = 8931.6 km, N0 = 325); the derivations are in the
 * comments. Tolerance for the composite anchors is the E2 acceptance band
 * (±3 dB); closed-form anchors are tighter.
 */

/** Flat profile at `elevM`, `n+1` points spanning distKm. */
function flatProfile(distKm, n = 10, elevM = 0, clutterM) {
  return Array.from({ length: n + 1 }, (_, i) => ({
    distM: (i / n) * distKm * 1000,
    terrainM: elevM,
    ...(clutterM === undefined ? {} : { clutterM }),
  }));
}

/** Flat profile with a single ridge of `ridgeM` at the middle sample. */
function ridgeProfile(distKm, ridgeM, n = 10) {
  const p = flatProfile(distKm, n, 0, 0);
  p[n / 2].terrainM = ridgeM;
  return p;
}

describe('guards', () => {
  it('throws outside the 30–6000 MHz validity range', () => {
    const prof = flatProfile(5);
    expect(() => p1812Loss({ freqMHz: 29, profile: prof })).toThrow(RangeError);
    expect(() => p1812Loss({ freqMHz: 6001, profile: prof })).toThrow(RangeError);
    expect(() => p1812Loss({ freqMHz: 150, profile: prof })).not.toThrow();
    expect(() => p1812Loss({ freqMHz: 30, profile: prof })).not.toThrow();
    expect(() => p1812Loss({ freqMHz: 6000, profile: prof })).not.toThrow();
  });

  it('throws on a missing / degenerate profile', () => {
    expect(() => p1812Loss({ freqMHz: 150 })).toThrow(RangeError);
    expect(() => p1812Loss({ freqMHz: 150, profile: [{ distM: 0, terrainM: 0 }] })).toThrow(RangeError);
    expect(() =>
      p1812Loss({ freqMHz: 150, profile: [{ distM: 0, terrainM: 0 }, { distM: 0, terrainM: 0 }] }),
    ).toThrow(RangeError);
  });
});

describe('Annex 1 anchor cases (synthetic profiles)', () => {
  it('clear LoS path collapses to free space: 5 km flat, 100 m masts, 150 MHz', () => {
    // Full first-Fresnel clearance (mid-path radius 50 m < 100 m masts),
    // spherical-earth clearance hse = 99.65 m > hreq = 27.6 m → Ld50 = 0.
    // Expected Lb = Lbfs = 92.4 + 20log10(0.15 GHz) + 20log10(5 km) = 89.90 dB
    // (troposcatter sits ~42 dB above — no measurable contribution).
    const { lossDb, components } = p1812Loss({
      freqMHz: 150,
      txHeightM: 100,
      rxHeightM: 100,
      profile: flatProfile(5),
    });
    expect(components.diffraction50Db).toBeCloseTo(0, 6);
    expect(lossDb).toBeCloseTo(89.90, 1);
  });

  it('single dominant ridge matches the Bullington construction: ±3 dB', () => {
    // 10 km flat sea-level path, 60 m ridge at mid-path, 10 m antennas,
    // 150 MHz. Hand-derived per §4.2 with ae = 8931.6 km:
    //   trans-horizon, Stim = Srim = 10.28 m/km, db = 5 km, νb = 1.029,
    //   J(νb) = 14.11 dB → Lbull = 23.34 dB.
    //   Smooth path: hstd = hsrd = −19 m → h'ts = h'rs = 29 m,
    //   Lbulls = 3.95 dB, Ldsph = 5.68 dB → Ld50 = 25.07 dB.
    //   Lbfs(10 km) = 95.92 dB → Lb ≈ 120.99 dB.
    const { lossDb } = p1812Loss({
      freqMHz: 150,
      txHeightM: 10,
      rxHeightM: 10,
      profile: ridgeProfile(10, 60),
    });
    expect(Math.abs(lossDb - 120.99)).toBeLessThanOrEqual(3);
  });

  it('low antennas over a smooth path agree with the plane-earth model', () => {
    // 10 km flat path, 150 MHz, 10 m / 2 m antennas: mid-path Fresnel radius
    // ≈ 71 m ≫ ray height → sub-path spherical-earth diffraction dominates
    // (this is exactly what plain FSPL+knife-edge misses). Independent
    // cross-check: the two-ray plane-earth loss
    //   Lpe = 40·log10(d) − 20·log10(h1) − 20·log10(h2) = 134.0 dB
    // — a different model entirely, expected to land within a few dB here.
    const { lossDb, components } = p1812Loss({
      freqMHz: 150,
      txHeightM: 10,
      rxHeightM: 2,
      profile: flatProfile(10),
    });
    expect(lossDb).toBeGreaterThan(components.fsplDb + 4);
    expect(Math.abs(lossDb - 133.98)).toBeLessThanOrEqual(6);
  });

  it('loss grows monotonically with distance on flat terrain', () => {
    const losses = [5, 10, 20, 40].map(
      (km) =>
        p1812Loss({ freqMHz: 450, txHeightM: 10, rxHeightM: 2, profile: flatProfile(km, 20) }).lossDb,
    );
    for (let i = 1; i < losses.length; i++) expect(losses[i]).toBeGreaterThan(losses[i - 1]);
  });
});

describe('time / location percentiles', () => {
  const prof = ridgeProfile(10, 60);
  const base = { freqMHz: 150, txHeightM: 10, rxHeightM: 10, profile: prof };

  it('smaller time percentage never predicts more loss (p = 10 ≤ p = 50)', () => {
    const l50 = p1812Loss({ ...base, p: 50 }).lossDb;
    const l10 = p1812Loss({ ...base, p: 10 }).lossDb;
    const l1 = p1812Loss({ ...base, p: 1 }).lossDb;
    expect(l10).toBeLessThanOrEqual(l50);
    expect(l1).toBeLessThanOrEqual(l10);
  });

  it('location percentile shifts by the log-normal term (σL = 5.5 dB)', () => {
    const l50 = p1812Loss({ ...base, pL: 50 }).lossDb;
    const l90 = p1812Loss({ ...base, pL: 90 }).lossDb;
    const l10 = p1812Loss({ ...base, pL: 10 }).lossDb;
    // I(0.9) = −1.2816 → +7.05 dB at 90% of locations, symmetric at 10%.
    expect(l90 - l50).toBeCloseTo(5.5 * 1.2816, 1);
    expect(l50 - l10).toBeCloseTo(5.5 * 1.2816, 1);
  });
});

describe('clutter', () => {
  it('zero clutter heights reproduce the terrain-only loss (no double-count)', () => {
    const bare = p1812Loss({ freqMHz: 450, profile: flatProfile(10) }).lossDb;
    const zeroClutter = p1812Loss({ freqMHz: 450, profile: flatProfile(10, 10, 0, 0) }).lossDb;
    expect(zeroClutter).toBe(bare);
  });

  it('mid-path clutter adds diffraction loss', () => {
    const prof = flatProfile(10, 10, 0, 0);
    for (let i = 4; i <= 6; i++) prof[i].clutterM = 20; // tree belt mid-path
    const bare = p1812Loss({ freqMHz: 450, txHeightM: 10, rxHeightM: 10, profile: flatProfile(10, 10, 0, 0) });
    const cluttered = p1812Loss({ freqMHz: 450, txHeightM: 10, rxHeightM: 10, profile: prof });
    expect(cluttered.lossDb).toBeGreaterThan(bare.lossDb);
  });

  it('terminal clutter applies the §4.7 height-gain correction', () => {
    // 15 m clutter over a 1.5 m handheld at 150 MHz:
    // hdif = 13.5 m, θclut = 26.57°, Knu = 0.1325, ν = 2.509 →
    // J(ν) − 6.03 = 14.88 dB (hand-derived).
    expect(terminalClutterDb(0.15, 15, 1.5)).toBeCloseTo(14.88, 1);
    // Antenna above the clutter → no correction.
    expect(terminalClutterDb(0.15, 15, 20)).toBe(0);
    expect(terminalClutterDb(0.15, 0, 1.5)).toBe(0);

    const prof = flatProfile(10, 10, 0, 0);
    prof[10].clutterM = 15; // rx end inside clutter
    const bare = p1812Loss({ freqMHz: 150, txHeightM: 30, rxHeightM: 1.5, profile: flatProfile(10, 10, 0, 0) });
    const inClutter = p1812Loss({ freqMHz: 150, txHeightM: 30, rxHeightM: 1.5, profile: prof });
    expect(inClutter.components.clutterRxDb).toBeCloseTo(14.88, 1);
    expect(inClutter.lossDb - bare.lossDb).toBeCloseTo(14.88, 1);
  });
});

describe('helpers and contracts', () => {
  it('invCumNorm matches the Attachment 2 anchors', () => {
    expect(invCumNorm(0.5)).toBeCloseTo(0, 3);
    expect(invCumNorm(0.01)).toBeCloseTo(2.3263, 2);
    expect(invCumNorm(0.99)).toBeCloseTo(-2.3263, 2);
    expect(invCumNorm(0.1)).toBeCloseTo(1.2816, 2);
  });

  it('median effective earth radius for ΔN = 45 is ≈ 8931 km (k50 = 1.402)', () => {
    expect(medianEffectiveEarthKm(45)).toBeCloseTo(6371 * (157 / 112), 6);
    expect(medianEffectiveEarthKm(45) / 6371).toBeCloseTo(1.402, 3);
  });

  it('refractivity table is keyed by latitude band', () => {
    expect(refractivityForLatitude(5)).toEqual({ deltaN: 55, N0: 355 });
    expect(refractivityForLatitude(-45)).toEqual({ deltaN: 45, N0: 325 });
    expect(refractivityForLatitude(65)).toEqual({ deltaN: 38, N0: 310 });
  });

  it('β0 stays in a sane percentage band', () => {
    for (const lat of [0, 30, 45, 60, 75]) {
      for (const d of [5, 50, 500]) {
        const b = beta0Percent(lat, d);
        expect(b).toBeGreaterThan(0);
        expect(b).toBeLessThan(50);
      }
    }
  });

  it('receivedDbmP1812 mirrors the model.js link-budget contract', () => {
    const profile = flatProfile(5);
    const opts = { txHeightM: 100, rxHeightM: 100 };
    const { lossDb } = p1812Loss({ freqMHz: 150, ...opts, profile });
    const dbm = receivedDbmP1812({ eirpDbm: 40, freqMHz: 150, rxGainDbi: 3 }, profile, opts);
    expect(dbm).toBeCloseTo(40 - lossDb + 3, 9);
  });

  it('field strength follows E = 199.36 + 20log f − Lb', () => {
    const r = p1812Loss({ freqMHz: 450, profile: flatProfile(10) });
    expect(r.fieldStrengthDbuV).toBeCloseTo(199.36 + 20 * Math.log10(0.45) - r.lossDb, 9);
  });

  it('classified output stays on the worker raster contract', () => {
    // Strong nearby link → usable class; weak distant link → still a valid
    // class index. Downstream (paint, recommend, export) only sees classes.
    const near = receivedDbmP1812(
      { eirpDbm: 37, freqMHz: 150 },
      flatProfile(2, 10, 0, 0),
      { txHeightM: 30, rxHeightM: 1.5 },
    );
    const cls = classifyDbm(near);
    expect(Object.values(COVERAGE_CLASS)).toContain(cls);
    expect(cls).toBeLessThanOrEqual(COVERAGE_CLASS.MARGINAL);
  });
});

describe('buildProfileP1812 (worker profile contract)', () => {
  const dem = { sample: (lng, lat) => 100 + lng * 10 + lat }; // synthetic plane
  const landcover = { sample: () => 10 }; // WorldCover "tree cover" → 20 m

  it('includes both endpoints, raw heights and clutter heights', () => {
    const prof = buildProfileP1812({ lng: 0, lat: 0 }, { lng: 1, lat: 0 }, 12000, dem, landcover);
    expect(prof[0].distM).toBe(0);
    expect(prof[prof.length - 1].distM).toBe(12000);
    expect(prof[0].terrainM).toBe(100);
    expect(prof[prof.length - 1].terrainM).toBe(110);
    expect(prof.every((pt) => pt.clutterM === 20)).toBe(true);
    expect(prof.length).toBeGreaterThanOrEqual(11); // ~1 km spacing
  });

  it('uses zero clutter without a land-cover sampler (terrain-only mode)', () => {
    const prof = buildProfileP1812({ lng: 0, lat: 0 }, { lng: 1, lat: 0 }, 12000, dem, null);
    expect(prof.every((pt) => pt.clutterM === 0)).toBe(true);
  });
});
