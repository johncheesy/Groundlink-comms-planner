import { describe, it, expect } from 'vitest';
import { recommendMix } from './mix.js';

const bandNames = (r) => r.bands.map((b) => b.band);
const byBand = (r, name) => r.bands.find((b) => b.band === name);

describe('recommendMix', () => {
  it('always proposes Satcom and VHF', () => {
    const r = recommendMix({});
    expect(bandNames(r)).toContain('Satcom');
    expect(bandNames(r)).toContain('VHF');
    expect(byBand(r, 'Satcom').pace).toBe('Emergency');
  });

  it('urban AOI → UHF ranked first', () => {
    const r = recommendMix({ aoiAreaKm2: 9, urbanFrac: 0.6, coverageFrac: 0.9 });
    expect(r.bands[0].band).toBe('UHF');
    expect(byBand(r, 'UHF').pace).toBe('Primary');
    expect(byBand(r, 'UHF').why).toMatch(/60%/);
  });

  it('long route → HF NVIS present and flagged as a separate module', () => {
    const r = recommendMix({ routeLengthKm: 60, ruggednessM: 150 });
    const hf = byBand(r, 'HF NVIS');
    expect(hf).toBeTruthy();
    expect(hf.separateModule).toBe(true);
    expect(hf.pace).toBe('Contingency');
    expect(hf.why).toMatch(/NVIS/);
  });

  it('60 km hilly route → recommends HF NVIS + VHF with readable rationale', () => {
    const r = recommendMix({ routeLengthKm: 60, ruggednessM: 180, coverageFrac: 0.4 });
    const names = bandNames(r);
    expect(names).toContain('HF NVIS');
    expect(names).toContain('VHF');
    for (const b of r.bands) expect(b.why.length).toBeGreaterThan(20); // human-readable
  });

  it('does not propose UHF for an open, non-urban area', () => {
    const r = recommendMix({ aoiAreaKm2: 400, urbanFrac: 0.05 });
    expect(bandNames(r)).not.toContain('UHF');
  });

  it('adds LoRa only when many fixed points exist', () => {
    expect(bandNames(recommendMix({ pointCount: 3 }))).not.toContain('LoRa');
    expect(bandNames(recommendMix({ pointCount: 12 }))).toContain('LoRa');
  });

  it('ranks are dense and ordered from 1', () => {
    const r = recommendMix({ aoiAreaKm2: 9, urbanFrac: 0.6, routeLengthKm: 70, pointCount: 10 });
    const ranks = r.bands.map((b) => b.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(ranks[0]).toBe(1);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it('echoes normalised inputs for the M6 contract', () => {
    const r = recommendMix({ urbanFrac: 5, pointCount: 3.6 });
    expect(r.inputs.urbanFrac).toBe(1); // clamped
    expect(r.inputs.pointCount).toBe(4); // rounded
  });
});
