import { describe, it, expect } from 'vitest';
import {
  NO_SERVER,
  MARGIN_SINGLE,
  DEFAULT_INTERFERENCE_DB,
  quantizeMarginDb,
  dequantizeMargin,
  buildServerImage,
  serverLegend,
  SERVER_PALETTE_FALLBACK,
  CI_NONE,
  quantizeCiDb,
  dequantizeCi,
  ciBand,
  buildInterferenceImage,
} from './bestserver.js';

const PAL = [
  [10, 20, 30],
  [40, 50, 60],
  [70, 80, 90],
];
const CONTEST = [200, 200, 200];

describe('margin quantization', () => {
  it('round-trips at quarter-dB resolution and clamps to the reserved 255', () => {
    expect(quantizeMarginDb(0)).toBe(0);
    expect(quantizeMarginDb(6)).toBe(24);
    expect(dequantizeMargin(quantizeMarginDb(6))).toBe(6);
    expect(quantizeMarginDb(100)).toBe(254); // never collides with MARGIN_SINGLE
    expect(quantizeMarginDb(-3)).toBe(0);
    expect(MARGIN_SINGLE).toBe(255);
  });
});

describe('buildServerImage', () => {
  // 2×2 grid: site 0 | site 1 / no-signal | site 0 (tight margin)
  const servers = Uint8Array.from([0, 1, NO_SERVER, 0]);
  const marginQ = Uint8Array.from([MARGIN_SINGLE, quantizeMarginDb(12), 0, quantizeMarginDb(3)]);

  it('colours each cell by its winning site; no-signal stays transparent', () => {
    const { data, counts, covered } = buildServerImage(servers, marginQ, { palette: PAL });
    expect([data[0], data[1], data[2], data[3]]).toEqual([10, 20, 30, 255]); // site 0
    expect([data[4], data[5], data[6], data[7]]).toEqual([40, 50, 60, 255]); // site 1
    expect(data[11]).toBe(0); // NO_SERVER → alpha 0
    expect([data[12], data[13], data[14]]).toEqual([10, 20, 30]); // site 0 again
    expect(counts).toEqual([2, 1]);
    expect(covered).toBe(3);
  });

  it('interference mode paints the contested band where the margin is tight', () => {
    const { data, contested, counts } = buildServerImage(servers, marginQ, {
      palette: PAL,
      interference: true,
      thresholdDb: DEFAULT_INTERFERENCE_DB,
      contestColor: CONTEST,
    });
    // cell 3: 3 dB margin ≤ 6 dB → contested colour; counts keep the winner.
    expect([data[12], data[13], data[14]]).toEqual(CONTEST);
    expect(contested).toBe(1);
    expect(counts).toEqual([2, 1]);
    // cell 1: 12 dB margin → keeps its site colour.
    expect([data[4], data[5], data[6]]).toEqual([40, 50, 60]);
  });

  it('single-source cells are never contested (reserved margin value)', () => {
    const { data, contested } = buildServerImage(
      Uint8Array.from([0]),
      Uint8Array.from([MARGIN_SINGLE]),
      { palette: PAL, interference: true, thresholdDb: 50, contestColor: CONTEST },
    );
    expect(contested).toBe(0);
    expect([data[0], data[1], data[2]]).toEqual([10, 20, 30]);
  });

  it('cycles the palette past its length and tolerates a tighter threshold', () => {
    const servers5 = Uint8Array.from([0, 1, 2, 3, 4]);
    const margins5 = Uint8Array.from([255, 255, 255, 255, 255]);
    const { data } = buildServerImage(servers5, margins5, { palette: PAL });
    expect([data[12], data[13], data[14]]).toEqual(PAL[0]); // site 3 → palette[0]
    expect([data[16], data[17], data[18]]).toEqual(PAL[1]); // site 4 → palette[1]
    expect(SERVER_PALETTE_FALLBACK).toHaveLength(8);
  });
});

describe('serverLegend', () => {
  it('orders by share, names from the tx list with fallbacks, drops empty sites', () => {
    const rows = serverLegend([2, 5, 0], 7, ['Alpha']);
    expect(rows.map((r) => r.index)).toEqual([1, 0]); // site 1 leads (5 of 7)
    expect(rows[0].name).toBe('Site 2'); // no name supplied → fallback
    expect(rows[1].name).toBe('Alpha');
    expect(rows[0].frac).toBeCloseTo(5 / 7, 6);
    expect(rows.find((r) => r.index === 2)).toBeUndefined(); // zero cells
  });
});

describe('interference (C/I) view', () => {
  const P = [[1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0], [5, 0, 0]];

  it('round-trips C/I through the byte encoding', () => {
    for (const db of [-10, -3, 0, 6.25, 12, 30, 53.5]) expect(dequantizeCi(quantizeCiDb(db))).toBeCloseTo(db, 6);
    expect(dequantizeCi(CI_NONE)).toBe(Infinity);
    expect(quantizeCiDb(-40)).toBe(0); // clamps, never collides with CI_NONE
    expect(quantizeCiDb(500)).toBe(254);
  });

  it('bands C/I at 20 / 12 / 6 / 0 dB', () => {
    expect(ciBand(Infinity)).toBe(0);
    expect(ciBand(20)).toBe(0);
    expect(ciBand(19.9)).toBe(1);
    expect(ciBand(12)).toBe(1);
    expect(ciBand(6)).toBe(2);
    expect(ciBand(0)).toBe(3);
    expect(ciBand(-0.1)).toBe(4);
  });

  it('paints only usable cells, colours by band, counts cells at risk', () => {
    const classes = new Uint8Array([0, 1, 2, 3, 255, 0]);
    const ciQ = new Uint8Array([CI_NONE, quantizeCiDb(15), quantizeCiDb(3), quantizeCiDb(30), CI_NONE, quantizeCiDb(-5)]);
    const res = buildInterferenceImage(classes, ciQ, { palette: P });
    expect(res.covered).toBe(4);
    expect(res.byBand).toEqual([1, 1, 0, 1, 1]);
    expect(res.atRisk).toBe(2); // 3 dB and −5 dB
    expect([...res.data.slice(0, 4)]).toEqual([1, 0, 0, 255]); // no interferer → clean
    expect([...res.data.slice(8, 12)]).toEqual([4, 0, 0, 255]); // 3 dB → band 3
    expect(res.data[3 * 4 + 3]).toBe(0); // poor cell not painted
    expect([...res.data.slice(20, 24)]).toEqual([5, 0, 0, 255]); // interferer wins
  });
});

describe('best-server zones only where the signal is usable (UI test U8)', () => {
  it('skips cells whose class is poor or none, and does not count them', () => {
    const servers = new Uint8Array([0, 0, 1, 1]);
    const marginQ = new Uint8Array([MARGIN_SINGLE, MARGIN_SINGLE, MARGIN_SINGLE, MARGIN_SINGLE]);
    const classes = new Uint8Array([0, 3, 2, 4]);
    const res = buildServerImage(servers, marginQ, { classes });
    expect(res.covered).toBe(2);
    expect(res.counts).toEqual([1, 1]);
    expect(res.data[1 * 4 + 3]).toBe(0);
    expect(res.data[3 * 4 + 3]).toBe(0);
  });
});

describe('raster edge fade (UI test U12)', () => {
  it('ramps alpha to the border and leaves the inside alone', async () => {
    const { fadeEdges } = await import('./coverage.js');
    const cols = 50, rows = 50;
    const data = new Uint8ClampedArray(cols * rows * 4).fill(255);
    fadeEdges(data, cols, rows, 0.1); // 5-cell band
    const a = (r, c) => data[(r * cols + c) * 4 + 3];
    expect(a(25, 25)).toBe(255);
    expect(a(25, 0)).toBeLessThan(40);
    expect(a(0, 0)).toBeLessThan(40);
    expect(a(25, 2)).toBeGreaterThan(a(25, 0));
    expect(a(25, 5)).toBe(255);
  });
});
