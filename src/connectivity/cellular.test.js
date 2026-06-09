import { describe, it, expect } from 'vitest';
import {
  CELL_BANDS,
  CELL_DEFAULTS,
  RADIO_TYPES,
  bandPreset,
  cellDefaults,
  selectTowers,
  towersToTxs,
  thresholdsForSensitivity,
} from './cellular.js';

describe('band presets', () => {
  it('maps each preset key to the documented frequency', () => {
    expect(bandPreset('n28-700').freqMHz).toBe(700);
    expect(bandPreset('b20-800').freqMHz).toBe(800);
    expect(bandPreset('b8-900').freqMHz).toBe(900);
    expect(bandPreset('b3-1800').freqMHz).toBe(1800);
    expect(bandPreset('b1-2100').freqMHz).toBe(2100);
    expect(bandPreset('b7-2600').freqMHz).toBe(2600);
    expect(bandPreset('n78-3500').freqMHz).toBe(3500);
  });

  it('falls back to 2100 B1 for an unknown key', () => {
    expect(bandPreset('nope').freqMHz).toBe(2100);
  });

  it('exposes the seven presets and four radio types', () => {
    expect(CELL_BANDS).toHaveLength(7);
    expect(RADIO_TYPES.map((r) => r.key)).toEqual(['GSM', 'UMTS', 'LTE', 'NR']);
  });
});

describe('macro defaults', () => {
  it('are the documented macro-cell values', () => {
    expect(CELL_DEFAULTS.eirpDbm).toBe(58);
    expect(CELL_DEFAULTS.txHeightM).toBe(30);
    expect(CELL_DEFAULTS.rxHeightM).toBe(1.5);
    expect(CELL_DEFAULTS.rxSensDbm).toBe(-100);
  });

  it('cellDefaults() returns an editable copy', () => {
    const d = cellDefaults();
    d.eirpDbm = 40;
    expect(CELL_DEFAULTS.eirpDbm).toBe(58); // original untouched
  });
});

describe('thresholdsForSensitivity', () => {
  it('derives a descending scale from RX sensitivity', () => {
    const t = thresholdsForSensitivity(-100);
    expect(t).toEqual({ excellent: -75, good: -85, marginal: -95, none: -100 });
  });
  it('defaults to the LTE reference when unset', () => {
    expect(thresholdsForSensitivity().none).toBe(-100);
  });
});

describe('selectTowers', () => {
  const cells = [
    { lat: 52.37, lon: 4.90, radio: 'LTE' }, // Amsterdam
    { lat: 52.09, lon: 5.12, radio: 'LTE' }, // Utrecht
    { lat: 51.92, lon: 4.48, radio: 'UMTS' }, // Rotterdam
    { lat: 53.22, lon: 6.57, radio: 'NR' }, // Groningen
    { lat: 52.37, lon: 4.91, radio: 'GSM' }, // Amsterdam (2G)
  ];

  it('filters by radio type', () => {
    expect(selectTowers(cells, { radio: 'LTE' })).toHaveLength(2);
    expect(selectTowers(cells, { radio: 'NR' })).toHaveLength(1);
  });

  it('filters by bounding box', () => {
    const bbox = { west: 4.7, east: 5.0, south: 52.2, north: 52.5 }; // around Amsterdam
    const r = selectTowers(cells, { bbox });
    expect(r.every((c) => c.lon >= 4.7 && c.lon <= 5.0 && c.lat >= 52.2 && c.lat <= 52.5)).toBe(true);
    expect(r).toHaveLength(2); // the two Amsterdam cells
  });

  it('sorts by proximity to the viewport centre', () => {
    const center = { lat: 51.92, lng: 4.48 }; // Rotterdam
    const r = selectTowers(cells, { center });
    expect(r[0].radio).toBe('UMTS'); // Rotterdam tower is nearest
  });

  it('caps to maxN', () => {
    expect(selectTowers(cells, { maxN: 2 })).toHaveLength(2);
  });

  it('combines radio + bbox + cap', () => {
    const bbox = { west: 4.7, east: 5.2, south: 52.0, north: 52.5 };
    const r = selectTowers(cells, { radio: 'LTE', bbox, maxN: 5 });
    expect(r).toHaveLength(2);
    expect(r.every((c) => c.radio === 'LTE')).toBe(true);
  });
});

describe('towersToTxs', () => {
  it('maps lon→lng and attaches the tower height', () => {
    const txs = towersToTxs([{ lat: 52.37, lon: 4.90, radio: 'LTE' }], 30);
    expect(txs).toEqual([{ lat: 52.37, lng: 4.9, txHeightM: 30 }]);
  });
  it('defaults the height to the macro default', () => {
    expect(towersToTxs([{ lat: 1, lon: 2 }])[0].txHeightM).toBe(CELL_DEFAULTS.txHeightM);
  });
});
