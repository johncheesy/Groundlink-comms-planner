import { describe, it, expect } from 'vitest';
import {
  parseRssiCsv,
  predictDbm,
  fitCalibration,
  deviationBucket,
  calibrationFile,
  MAX_POINTS,
} from './calibration.js';
import { fsplDb } from '../coverage/model.js';

// Synthetic coordinates only (OPSEC) — a 0..1 degree test square.

describe('parseRssiCsv', () => {
  it('parses the documented format with a radio column', () => {
    const csv = 'lat,lon,dBm,radio_id\n0.5,0.5,-87,prc152\n0.6,0.4,-101,prc152\n';
    const { points, skipped, error } = parseRssiCsv(csv);
    expect(error).toBeNull();
    expect(skipped).toBe(0);
    expect(points).toEqual([
      { lat: 0.5, lon: 0.5, dBm: -87, radioId: 'prc152' },
      { lat: 0.6, lon: 0.4, dBm: -101, radioId: 'prc152' },
    ]);
  });

  it('accepts header aliases and missing radio column', () => {
    const csv = 'Latitude,LONGITUDE,RSSI\n0.1,0.2,-95\n';
    const { points, error } = parseRssiCsv(csv);
    expect(error).toBeNull();
    expect(points[0]).toEqual({ lat: 0.1, lon: 0.2, dBm: -95, radioId: null });
  });

  it('skips out-of-range and garbage rows, counts them', () => {
    const csv = [
      'lat,lon,dbm',
      '0.5,0.5,-90',     // valid
      '99,0.5,-90',      // lat out of range
      '0.5,0.5,12',      // positive dBm
      '0.5,0.5,-900',    // below -160
      'a,b,c',           // garbage
    ].join('\n');
    const { points, skipped } = parseRssiCsv(csv);
    expect(points).toHaveLength(1);
    expect(skipped).toBe(4);
  });

  it('handles quoted fields and CRLF', () => {
    const csv = 'lat,lon,dbm,radio\r\n0.5,0.5,-90,"PRC, 152"\r\n';
    const { points } = parseRssiCsv(csv);
    expect(points[0].radioId).toBe('PRC, 152');
  });

  it('rejects a missing header and empty input', () => {
    expect(parseRssiCsv('0.5,0.5,-90').error).toMatch(/header/i);
    expect(parseRssiCsv('').error).toMatch(/header/i);
    expect(parseRssiCsv('foo,bar,baz\n1,2,3').error).toMatch(/lat, lon and dBm/);
  });

  it(`caps at ${MAX_POINTS} points`, () => {
    const rows = Array.from({ length: MAX_POINTS + 10 }, () => '0.5,0.5,-90');
    const { points, skipped } = parseRssiCsv('lat,lon,dbm\n' + rows.join('\n'));
    expect(points).toHaveLength(MAX_POINTS);
    expect(skipped).toBe(10);
  });
});

describe('predictDbm', () => {
  const params = { eirpDbm: 40, freqMHz: 150, rxGainDbi: 0, clutterDb: 0, rxHeightM: 1.5 };

  it('matches free-space maths with no DEM', () => {
    // ~11.1 km due north of the tx on the synthetic square.
    const pt = { lat: 0.6, lon: 0.5 };
    const tx = { lat: 0.5, lng: 0.5, txHeightM: 10 };
    const got = predictDbm(pt, [tx], params, null);
    const distM = 0.1 * 111194.93; // 0.1° of latitude
    expect(got).toBeCloseTo(40 - fsplDb(distM, 150), 1);
  });

  it('takes the strongest of several transmitters', () => {
    const near = { lat: 0.51, lng: 0.5, txHeightM: 10 };
    const far = { lat: 0.9, lng: 0.5, txHeightM: 10 };
    const pt = { lat: 0.5, lon: 0.5 };
    const both = predictDbm(pt, [far, near], params, null);
    const nearOnly = predictDbm(pt, [near], params, null);
    expect(both).toBeCloseTo(nearOnly, 6);
  });

  it('loses signal behind a ridge when a DEM is present', () => {
    // Flat at 0 m except a 200 m wall between tx and rx.
    const dem = { sample: (lng) => (lng > 0.54 && lng < 0.56 ? 200 : 0) };
    const pt = { lat: 0.5, lon: 0.6 };
    const tx = { lat: 0.5, lng: 0.5, txHeightM: 10 };
    const withTerrain = predictDbm(pt, [tx], params, dem);
    const flat = predictDbm(pt, [tx], params, null);
    expect(withTerrain).toBeLessThan(flat - 5); // knife-edge loss is real
  });
});

describe('fitCalibration', () => {
  it('fits the mean delta per radio and reports spread', () => {
    const samples = [
      { radioId: 'a', measuredDbm: -90, predictedDbm: -84 }, // delta -6
      { radioId: 'a', measuredDbm: -80, predictedDbm: -76 }, // delta -4
      { radioId: 'b', measuredDbm: -70, predictedDbm: -73 }, // delta +3
    ];
    const fits = fitCalibration(samples);
    expect(fits).toHaveLength(2);
    const a = fits.find((f) => f.radioId === 'a');
    expect(a.n).toBe(2);
    expect(a.offsetDb).toBe(-5);
    expect(a.rmseBefore).toBeCloseTo(5.1, 1);
    expect(a.rmseAfter).toBe(1); // residuals ±1 after removing the mean
    const b = fits.find((f) => f.radioId === 'b');
    expect(b.offsetDb).toBe(3);
    expect(b.rmseAfter).toBe(0);
  });

  it('sorts by sample count and drops non-finite samples', () => {
    const fits = fitCalibration([
      { radioId: 'rare', measuredDbm: -90, predictedDbm: -90 },
      { radioId: 'common', measuredDbm: -90, predictedDbm: -91 },
      { radioId: 'common', measuredDbm: -92, predictedDbm: -91 },
      { radioId: 'common', measuredDbm: NaN, predictedDbm: -91 },
    ]);
    expect(fits[0].radioId).toBe('common');
    expect(fits[0].n).toBe(2);
  });
});

describe('deviationBucket', () => {
  it('classifies the three bands', () => {
    expect(deviationBucket(5)).toBe('conservative');
    expect(deviationBucket(-5)).toBe('optimistic');
    expect(deviationBucket(2)).toBe('agree');
    expect(deviationBucket(-3)).toBe('agree');
  });
});

describe('calibrationFile', () => {
  it('serializes offsets without any coordinates', () => {
    const fits = fitCalibration([{ radioId: 'a', measuredDbm: -90, predictedDbm: -85 }]);
    const file = calibrationFile(fits, { generated: '2026-06-13T00:00:00Z' });
    expect(file.format).toBe('groundlink-calibration');
    expect(file.radios[0]).toEqual({
      radioId: 'a', offsetDb: -5, n: 1, rmseBeforeDb: 5, rmseAfterDb: 0, sdDeltaDb: 0,
    });
    expect(JSON.stringify(file)).not.toMatch(/lat|lon/i);
  });
});
