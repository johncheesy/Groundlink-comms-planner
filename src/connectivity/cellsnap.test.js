import { describe, it, expect, beforeEach } from 'vitest';
import {
  operatorForCell,
  parseSnapshotTowers,
  snapshotForBbox,
  loadSnapshotTowers,
  resetSnapshotCache,
} from './cellsnap.js';

// Synthetic test geometry only (abstract 0–1° squares — no real coordinates).

describe('operatorForCell', () => {
  it('maps known MCC-MNC pairs to current brands', () => {
    expect(operatorForCell(204, 8)).toBe('KPN');
    expect(operatorForCell(204, 4)).toBe('Vodafone');
    expect(operatorForCell(204, 16)).toBe('Odido');
    expect(operatorForCell(204, 2)).toBe('Odido'); // legacy Tele2 → current owner
    expect(operatorForCell(206, 1)).toBe('Proximus');
    expect(operatorForCell(262, 2)).toBe('Vodafone');
    expect(operatorForCell(208, 15)).toBe('Free');
  });

  it('falls back to the honest numeric label, never an invented brand', () => {
    expect(operatorForCell(310, 410)).toBe('MCC 310 · MNC 410');
    expect(operatorForCell(204, 99)).toBe('MCC 204 · MNC 99');
  });

  it('returns null when codes are absent', () => {
    expect(operatorForCell(null, 8)).toBeNull();
    expect(operatorForCell(204, undefined)).toBeNull();
  });
});

describe('parseSnapshotTowers', () => {
  const cell = (over = {}) => ({ lat: 0.5, lon: 0.5, radio: 'LTE', mcc: 204, net: 8, range: 2500, ...over });

  it('maps cells to towers with the operator resolved from MCC/MNC', () => {
    const towers = parseSnapshotTowers({ cells: [cell()] });
    expect(towers).toEqual([{ lat: 0.5, lon: 0.5, radio: 'LTE', operator: 'KPN', range: 2500 }]);
  });

  it('collapses colocated sector cells (same site, radio, operator) to one tower', () => {
    const towers = parseSnapshotTowers({
      cells: [
        cell(),
        cell({ lat: 0.50003, lon: 0.50002 }), // ~4 m away — a sector of the same site
        cell({ radio: 'NR' }), // different generation → its own tower
        cell({ net: 16 }), // different operator on the same mast → its own tower
      ],
    });
    expect(towers).toHaveLength(3);
    expect(towers.filter((t) => t.radio === 'LTE' && t.operator === 'KPN')).toHaveLength(1);
  });

  it('drops malformed rows and unknown radio values', () => {
    const towers = parseSnapshotTowers({
      cells: [cell({ lat: NaN }), cell({ radio: 'CDMA' }), null, cell({ lon: undefined })],
    });
    expect(towers).toEqual([]);
    expect(parseSnapshotTowers(null)).toEqual([]);
  });
});

describe('snapshotForBbox', () => {
  const index = {
    regions: [
      { region: 'WIDE', file: 'wide.json', bbox: { west: 0, south: 0, east: 10, north: 10 } },
      { region: 'TIGHT', file: 'tight.json', bbox: { west: 2, south: 2, east: 5, north: 5 } },
    ],
  };

  it('requires full containment; prefers the smallest covering region', () => {
    expect(snapshotForBbox(index, { west: 3, south: 3, east: 4, north: 4 })?.region).toBe('TIGHT');
    expect(snapshotForBbox(index, { west: 1, south: 1, east: 8, north: 8 })?.region).toBe('WIDE');
    expect(snapshotForBbox(index, { west: 9, south: 9, east: 11, north: 11 })).toBeNull();
    expect(snapshotForBbox(null, { west: 0, south: 0, east: 1, north: 1 })).toBeNull();
  });
});

describe('loadSnapshotTowers (injected fetch)', () => {
  beforeEach(() => resetSnapshotCache());

  const INDEX = {
    regions: [{ region: 'T', file: 't.json', bbox: { west: 0, south: 0, east: 1, north: 1 } }],
  };
  const SNAPSHOT = {
    region: 'T',
    generated: '2026-01-01T00:00:00.000Z',
    attribution: 'Cell data © OpenCelliD contributors (CC BY-SA 4.0)',
    cells: [{ lat: 0.5, lon: 0.5, radio: 'LTE', mcc: 204, net: 8 }],
  };
  const ok = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

  it('returns towers + source meta when a snapshot covers the bbox', async () => {
    const calls = [];
    const fetchImpl = (url) => { calls.push(url); return ok(url.endsWith('index.json') ? INDEX : SNAPSHOT); };
    const res = await loadSnapshotTowers({ west: 0.2, south: 0.2, east: 0.8, north: 0.8 }, fetchImpl);
    expect(res.towers).toHaveLength(1);
    expect(res.towers[0].operator).toBe('KPN');
    expect(res.meta.source).toBe('opencellid');
    expect(res.meta.region).toBe('T');
    expect(res.meta.generated).toBe('2026-01-01T00:00:00.000Z');
    expect(calls).toEqual(['cells/index.json', 'cells/t.json']);
  });

  it('returns null outside the snapshot (→ Overpass fallback)', async () => {
    const fetchImpl = () => ok(INDEX);
    expect(await loadSnapshotTowers({ west: 5, south: 5, east: 6, north: 6 }, fetchImpl)).toBeNull();
  });

  it('caches the index across calls within a session', async () => {
    let indexFetches = 0;
    const fetchImpl = (url) => {
      if (url.endsWith('index.json')) indexFetches += 1;
      return ok(url.endsWith('index.json') ? INDEX : SNAPSHOT);
    };
    await loadSnapshotTowers({ west: 0.2, south: 0.2, east: 0.8, north: 0.8 }, fetchImpl);
    await loadSnapshotTowers({ west: 0.3, south: 0.3, east: 0.7, north: 0.7 }, fetchImpl);
    expect(indexFetches).toBe(1);
  });

  it('degrades to null on any failure — missing index, 404 region, bad JSON', async () => {
    expect(await loadSnapshotTowers({ west: 0, south: 0, east: 1, north: 1 }, () => Promise.reject(new Error('offline')))).toBeNull();
    resetSnapshotCache();
    expect(await loadSnapshotTowers({ west: 0, south: 0, east: 1, north: 1 }, () => Promise.resolve({ ok: false }))).toBeNull();
    resetSnapshotCache();
    const fetchImpl = (url) => (url.endsWith('index.json') ? ok(INDEX) : Promise.resolve({ ok: false }));
    expect(await loadSnapshotTowers({ west: 0.2, south: 0.2, east: 0.8, north: 0.8 }, fetchImpl)).toBeNull();
  });

  it('an empty snapshot yields null, not an empty tower layer', async () => {
    const fetchImpl = (url) => ok(url.endsWith('index.json') ? INDEX : { region: 'T', cells: [] });
    expect(await loadSnapshotTowers({ west: 0.2, south: 0.2, east: 0.8, north: 0.8 }, fetchImpl)).toBeNull();
  });
});
