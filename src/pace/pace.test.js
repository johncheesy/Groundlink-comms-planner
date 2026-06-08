import { describe, it, expect } from 'vitest';
import { buildPace } from './pace.js';

const mk = (bands) => ({ bands, inputs: {} });

describe('buildPace — four-tier PACE consolidation', () => {
  it('resolves a full mix into four distinct tiers', () => {
    const mix = mk([
      { band: 'HF NVIS', rank: 1, pace: 'Contingency', why: 'hf', separateModule: true },
      { band: 'VHF', rank: 2, pace: 'Primary', why: 'vhf', separateModule: false },
      { band: 'Satcom', rank: 3, pace: 'Emergency', why: 'sat', separateModule: false },
      { band: 'UHF', rank: 4, pace: 'Alternate', why: 'uhf', separateModule: false },
    ]);
    const plan = buildPace({ mix });
    expect(plan.legs.map((l) => l.tier)).toEqual(['Primary', 'Alternate', 'Contingency', 'Emergency']);
    expect(plan.legs[0].band).toBe('VHF'); // top terrestrial wins Primary, not HF at rank 1
    expect(plan.legs[1].band).toBe('UHF');
    expect(plan.legs[2].band).toBe('HF NVIS');
    expect(plan.legs[2].status).toBe('separate');
    expect(plan.legs[3].band).toBe('Satcom');
    expect(plan.legs[3].status).toBe('asset');
    expect(plan.gaps).toEqual([]);
  });

  it('always assigns satcom to the Emergency leg', () => {
    const plan = buildPace({
      mix: mk([
        { band: 'VHF', rank: 1, pace: 'Primary', why: 'vhf' },
        { band: 'Satcom', rank: 2, pace: 'Emergency', why: 'sat' },
      ]),
    });
    const e = plan.legs.find((l) => l.tier === 'Emergency');
    expect(e.band).toBe('Satcom');
    expect(e.asset).toBe('satcom');
  });

  it('surfaces gaps honestly for a minimal mix', () => {
    const plan = buildPace({
      mix: mk([
        { band: 'VHF', rank: 1, pace: 'Primary', why: 'vhf' },
        { band: 'Satcom', rank: 2, pace: 'Emergency', why: 'sat' },
      ]),
    });
    expect(plan.legs[0].band).toBe('VHF');
    expect(plan.legs[1].status).toBe('gap'); // no 2nd terrestrial, no drone
    expect(plan.legs[2].status).toBe('gap');
    expect(plan.gaps).toEqual(['Alternate', 'Contingency']);
  });

  it('uses an airborne relay as the Alternate leg when a drone relay is active', () => {
    const plan = buildPace({
      mix: mk([
        { band: 'VHF', rank: 1, pace: 'Primary', why: 'vhf' },
        { band: 'Satcom', rank: 2, pace: 'Emergency', why: 'sat' },
      ]),
      drone: { relay: true, altitudeM: 120 },
    });
    expect(plan.legs[1].asset).toBe('airborne');
    expect(plan.legs[1].role).toContain('120 m');
  });

  it('keeps HF on Contingency and leaves the drone unused when a 2nd band exists', () => {
    const plan = buildPace({
      mix: mk([
        { band: 'VHF', rank: 1, pace: 'Primary', why: 'vhf' },
        { band: 'UHF', rank: 2, pace: 'Alternate', why: 'uhf' },
        { band: 'HF NVIS', rank: 3, pace: 'Contingency', why: 'hf', separateModule: true },
        { band: 'Satcom', rank: 4, pace: 'Emergency', why: 'sat' },
      ]),
      drone: { relay: true, altitudeM: 100 },
    });
    expect(plan.legs[1].band).toBe('UHF'); // UHF is the Alternate; drone not consumed
    expect(plan.legs[2].band).toBe('HF NVIS');
    expect(plan.gaps).toEqual([]);
  });

  it('derives topology from the site count', () => {
    const mix = mk([
      { band: 'VHF', rank: 1, pace: 'Primary', why: 'v' },
      { band: 'Satcom', rank: 2, pace: 'Emergency', why: 's' },
    ]);
    expect(buildPace({ mix }).structure.topology).toBe('standalone');
    expect(buildPace({ mix, sites: { fixed: [{}], recommended: [] } }).structure.topology).toBe('single-hub');
    const multi = buildPace({ mix, sites: { fixed: [{}], recommended: [{}, {}] } });
    expect(multi.structure.topology).toBe('relay-network');
    expect(multi.structure.totalSites).toBe(3);
  });

  it('captures LoRa as a telemetry overlay, not a PACE tier', () => {
    const plan = buildPace({
      mix: mk([
        { band: 'VHF', rank: 1, pace: 'Primary', why: 'v' },
        { band: 'LoRa', rank: 2, pace: 'Contingency', why: 'lora' },
        { band: 'Satcom', rank: 3, pace: 'Emergency', why: 's' },
      ]),
    });
    expect(plan.overlays.map((o) => o.band)).toEqual(['LoRa']);
    expect(plan.legs.some((l) => l.band === 'LoRa')).toBe(false);
  });

  it('builds a readable summary naming the Primary band and coverage', () => {
    const plan = buildPace({
      mix: mk([
        { band: 'VHF', rank: 1, pace: 'Primary', why: 'v' },
        { band: 'Satcom', rank: 2, pace: 'Emergency', why: 's' },
      ]),
      coverage: { coveredFrac: 0.78, terrain: true },
      params: { rxHeightM: 1.5 },
    });
    expect(plan.summary).toContain('Primary VHF');
    expect(plan.summary).toContain('78%');
    expect(plan.summary).toContain('Emergency Satcom');
  });
});
