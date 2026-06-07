import { describe, it, expect } from 'vitest';
import { normalizeRadio, thresholdsFromSens, activeSetToCoverage } from './model.js';

describe('normalizeRadio', () => {
  it('fills missing fields from role defaults', () => {
    const r = normalizeRadio({ label: 'Test HT', role: 'handheld', freqRangeMHz: [136, 174] });
    expect(r.defaultHeightM).toBe(1.5);
    expect(r.rxSensDbm).toBe(-116);
    expect(r.defaultFreqMHz).toBeCloseTo(155);
    expect(r.source).toBe('manual');
    expect(r.id).toBeTruthy();
  });

  it('keeps provided values and flags unknown roles back to handheld', () => {
    const r = normalizeRadio({ label: 'Odd', role: 'banana', powerW: 25, rxSensDbm: -119 });
    expect(r.role).toBe('handheld');
    expect(r.powerW).toBe(25);
    expect(r.rxSensDbm).toBe(-119);
  });
});

describe('thresholdsFromSens', () => {
  it('derives sens / +7 / +15 / +25', () => {
    expect(thresholdsFromSens(-116)).toEqual({
      excellent: -91,
      good: -101,
      marginal: -109,
      none: -116,
    });
  });
});

describe('activeSetToCoverage (talk-in binding link)', () => {
  it('takes tx from infra, rx height + sensitivity from field', () => {
    const infra = normalizeRadio({ label: 'Repeater', role: 'repeater', freqRangeMHz: [148, 152], powerW: 25 });
    const field = normalizeRadio({ label: 'HT', role: 'handheld', freqRangeMHz: [148, 152], rxSensDbm: -118 });
    const c = activeSetToCoverage(infra, field);
    expect(c.powerW).toBe(25); // from infra
    expect(c.txHeightM).toBe(15); // repeater default
    expect(c.rxHeightM).toBe(1.5); // handheld default
    expect(c.rxSensDbm).toBe(-118); // field unit
    expect(c.thresholds.none).toBe(-118);
  });

  it('returns null with no radios', () => {
    expect(activeSetToCoverage(null, null)).toBeNull();
  });

  it('flags HF and satcom transmitters as having no meaningful raster', () => {
    const hf = normalizeRadio({ label: 'HF', role: 'hf', freqRangeMHz: [1.6, 30] });
    const sat = normalizeRadio({ label: 'Sat', role: 'satcom', freqRangeMHz: [1616, 1626] });
    const rep = normalizeRadio({ label: 'Rptr', role: 'repeater', freqRangeMHz: [148, 152] });
    expect(activeSetToCoverage(hf, hf).rasterMeaningful).toBe(false);
    expect(activeSetToCoverage(sat, sat).rasterMeaningful).toBe(false);
    expect(activeSetToCoverage(rep, rep).rasterMeaningful).toBe(true);
  });
});
