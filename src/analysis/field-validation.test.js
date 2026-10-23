import { describe, it, expect } from 'vitest';
import { errorStats, compareEngines, fieldSummary, FIELD_ENGINES, HIT_DB } from './field-validation.js';
import { bestDbmAt } from '../coverage/cell.js';

// Synthetic positions only (OPSEC).
const txs = [{ lat: 0, lng: 0, txHeightM: 20 }];
const params = { eirpDbm: 40, freqMHz: 450, rxGainDbi: 0, rxHeightM: 1.5, txHeightM: 20, thresholds: {}, engine: 'p1812' };

describe('errorStats', () => {
  it('bias, RMSE, spread and hit shares', () => {
    const s = errorStats([2, -2, 10, -4]);
    expect(s.n).toBe(4);
    expect(s.biasDb).toBe(1.5);
    expect(s.rmseDb).toBeCloseTo(Math.sqrt((4 + 4 + 100 + 16) / 4), 1);
    expect(s.withinPct).toBe(75); // |e| ≤ 6
    expect(s.optimisticPct).toBe(25); // e > 6
    expect(HIT_DB).toBe(6);
  });

  it('empty input gives nulls, not NaN', () => {
    expect(errorStats([])).toMatchObject({ n: 0, biasDb: null, rmseDb: null });
  });
});

describe('compareEngines', () => {
  const flatDem = { id: 'flat', sample: () => 0 };
  const points = [0.05, 0.1, 0.2].map((lon) => ({ lat: 0, lon }));
  // "Measurements" equal to the P.1812 prediction itself → zero error there.
  const truth = points.map((pt) => ({ ...pt, dBm: bestDbmAt(pt.lon, pt.lat, { txs, params, dem: flatDem }) }));

  it('scores every model set-up with the map math', () => {
    const r = compareEngines(truth, txs, params, { dem: flatDem });
    expect(r.map((x) => x.id)).toEqual(FIELD_ENGINES.map((e) => e.id));
    const p1812 = r.find((x) => x.id === 'p1812');
    expect(p1812.stats.n).toBe(3);
    expect(p1812.stats.rmseDb).toBe(0);
  });

  it('marks P.1812 unusable without terrain, like the map', () => {
    const r = compareEngines(truth, txs, params, { dem: null });
    expect(r.find((x) => x.id === 'p1812').stats.n).toBe(0);
    expect(r.find((x) => x.id === 'deygout').stats.n).toBe(3);
  });
});

describe('fieldSummary', () => {
  it('carries statistics and distances but no coordinates', () => {
    const points = [{ lat: 0.01, lon: 0.02, dBm: -80 }, { lat: 0.05, lon: 0.0, dBm: -90 }];
    const results = [{ id: 'p1812', label: 'P.1812', stats: errorStats([1, -1]) }];
    const s = fieldSummary({ results, points, txs, params, terrain: 'GLO-30', clutter: 'worldcover', label: 'test', generated: '2026-10-22' });
    expect(s).toMatchObject({ format: 'groundlink-field-validation', points: 2, setting: { freqMHz: 450, txCount: 1 } });
    expect(s.distanceKm.max).toBeGreaterThan(5);
    const json = JSON.stringify(s);
    expect(json).not.toMatch(/"lat"|"lon"|"lng"/);
  });
});
