import { describe, it, expect } from 'vitest';
import { buildPace, radioBand, legFilled } from './pace.js';

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

describe('radioBand', () => {
  it('names bands by role first, then frequency', () => {
    expect(radioBand({ role: 'repeater', defaultFreqMHz: 150 })).toBe('VHF'); // 136–174 MHz is VHF, not UHF
    expect(radioBand({ role: 'handheld', defaultFreqMHz: 450 })).toBe('UHF');
    expect(radioBand({ role: 'hf', defaultFreqMHz: 7 })).toBe('HF NVIS');
    expect(radioBand({ role: 'satcom', defaultFreqMHz: 1620 })).toBe('Satcom');
    expect(radioBand({ role: 'lora', defaultFreqMHz: 868 })).toBe('LoRa');
    expect(radioBand({ role: 'base', defaultFreqMHz: 5800 })).toBe('Backhaul');
    expect(radioBand({ role: 'handheld', freqRangeMHz: [136, 174] })).toBe('VHF');
    expect(radioBand(null)).toBeNull();
  });
});

describe('buildPace — with the radios carried', () => {
  const vhfRep = { label: 'SLR 5500', role: 'repeater', defaultFreqMHz: 150 };
  const vhfHand = { label: 'R7', role: 'handheld', defaultFreqMHz: 150 };
  const vhfBase = { label: 'DM4600e base', role: 'base', defaultFreqMHz: 150 };
  const ptp = { label: 'Rocket 5AC', role: 'base', defaultFreqMHz: 5800 };
  const mix = mk([
    { band: 'HF NVIS', rank: 1, pace: 'Contingency', why: 'hf', separateModule: true },
    { band: 'VHF', rank: 2, pace: 'Primary', why: 'vhf' },
    { band: 'Satcom', rank: 3, pace: 'Emergency', why: 'sat' },
  ]);

  it('names carried radios and marks uncarried bands as recommendations', () => {
    const plan = buildPace({ mix, arsenal: [vhfRep, vhfHand, ptp] });
    expect(plan.legs[0]).toMatchObject({ band: 'VHF', status: 'ok' });
    expect(plan.legs[0].radios).toEqual(['SLR 5500', 'R7']);
    expect(plan.legs[0].freqMHz).toBe(150);
    expect(plan.legs[2]).toMatchObject({ band: 'HF NVIS', status: 'recommend' });
    expect(plan.legs[3]).toMatchObject({ band: 'Satcom', status: 'recommend' });
    expect(plan.toAcquire).toEqual([{ tier: 'Contingency', band: 'HF NVIS' }, { tier: 'Emergency', band: 'Satcom' }]);
    expect(plan.summary).toContain('Not in your equipment');
    expect(plan.structure.backhaul).toEqual(['Rocket 5AC']);
    expect(plan.legs.some((l) => l.band === 'Backhaul')).toBe(false); // data backbone, not a voice leg
  });

  it('uses talk-around on the Primary band as Alternate when base or vehicle sets are carried', () => {
    const plan = buildPace({ mix, arsenal: [vhfRep, vhfHand, vhfBase] });
    expect(plan.legs[1]).toMatchObject({ tier: 'Alternate', band: 'VHF', status: 'ok' });
    expect(plan.legs[1].role).toContain('talk-around');
    expect(plan.legs[1].radios).toEqual(['DM4600e base']);
  });

  it('prefers a carried second band over talk-around, and a carried band over an uncarried one', () => {
    const uhf = { label: 'Hytera UHF', role: 'handheld', defaultFreqMHz: 450 };
    const plan = buildPace({ mix, arsenal: [vhfRep, vhfBase, uhf] });
    expect(plan.legs[1]).toMatchObject({ band: 'UHF', status: 'ok' }); // carried but not in the mix
  });

  it('reads a VHF structure as VHF (not UHF)', () => {
    const plan = buildPace({
      mix: mk([{ band: 'Satcom', rank: 1, pace: 'Emergency', why: 's' }]),
      structures: [{ name: 'Talk-in', infra: vhfRep, field: vhfHand }],
    });
    expect(plan.legs[0].band).toBe('VHF');
    expect(plan.legs.some((l) => l.band === 'UHF')).toBe(false);
  });

  it('lets a chosen cellular tier replace a buy recommendation', () => {
    const plan = buildPace({ mix, arsenal: [vhfRep], cellForPace: 'contingency', ewThreat: 'low' });
    expect(plan.legs[2].band).toBe('Cellular (LTE/4G)');
    expect(legFilled(plan.legs[2])).toBe(true);
    expect(legFilled(plan.legs[3])).toBe(false); // satcom not carried
  });
});

