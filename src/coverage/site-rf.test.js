import { describe, it, expect } from 'vitest';
import { withGain, normalizeAntenna } from './antenna.js';
import { txDbmAt, bestDbmAt } from './cell.js';
import { normalizeRadio, activeSetToCoverage } from '../radios/model.js';
import { describeAssumptions } from '../analysis/assumptions.js';
import { predictDbm } from '../analysis/calibration.js';
import { linkBudget } from '../analysis/path-profile.js';
import { linkStatus, linkFeatures } from '../map/radio-links.js';
import { parseSiteRf } from '../ui/site-rf-popup.js';

describe('antenna gain from the radio set (M50)', () => {
  it('picks the preset with that gain and shape, else Custom', () => {
    expect(withGain({ preset: 'dipole' }, 6).preset).toBe('collinear');
    expect(withGain({ preset: 'collinear' }, 2.15).preset).toBe('dipole');
    const c = withGain({ preset: 'dipole' }, 3);
    expect(c).toMatchObject({ preset: 'custom', gainDbi: 3, beamwidthDeg: 360 });
  });
  it('keeps the antenna (and its pointing) when the gain is the same or missing', () => {
    const y = normalizeAntenna({ preset: 'yagi3', azimuthDeg: 45 });
    expect(withGain(y, 7)).toEqual(y);
    expect(withGain(y, undefined)).toEqual(y);
    expect(withGain(y, 9)).toMatchObject({ preset: 'custom', beamwidthDeg: 70, azimuthDeg: 45 });
  });
  it('radio model carries feeder loss to the coverage controls', () => {
    const r = normalizeRadio({ role: 'repeater', powerW: 25, feederLossDb: 3 });
    expect(r.feederLossDb).toBe(3);
    expect(normalizeRadio({ role: 'repeater' }).feederLossDb).toBe(0);
    expect(normalizeRadio({ feederLossDb: 99 }).feederLossDb).toBe(30);
    const v = activeSetToCoverage(r, normalizeRadio({ role: 'handheld' }));
    expect(v).toMatchObject({ txGainDbi: 6, txLossDb: 3 });
  });
  it('assumptions line names the loss', () => {
    const a = describeAssumptions({ freqMHz: 450, powerW: 25, txHeightM: 15, rxHeightM: 1.5, txLossDb: 3, terrainUsed: true, clutterRequested: false });
    expect(a.summary).toContain('loss 3 dB');
  });
});

describe('per-site power in the cell step (M50)', () => {
  const params = { eirpDbm: 40, freqMHz: 150, rxGainDbi: 0, rxHeightM: 1.5, engine: 'fallback' };
  const base = { lng: 20.05, lat: 10, rxElev: 1.5, clutterDb: 0, params, dem: null, clutter: null, useP1812: false, antenna: null };
  it('a site with its own EIRP shifts its level by the difference', () => {
    const t = { lat: 10, lng: 20, txHeightM: 10 };
    const ref = txDbmAt({ ...base, t, txElev: 10 });
    const own = txDbmAt({ ...base, t: { ...t, eirpDbm: 46 }, txElev: 10 });
    expect(own - ref).toBeCloseTo(6, 6);
  });
  it('the stronger site wins at a point between them', () => {
    const txs = [{ lat: 10, lng: 20 }, { lat: 10, lng: 20.1, eirpDbm: 50 }];
    const mid = bestDbmAt(20.05, 10, { txs, params });
    const weakOnly = bestDbmAt(20.05, 10, { txs: [txs[0]], params });
    expect(mid - weakOnly).toBeCloseTo(10, 1);
  });
  it('calibration prediction honours a site power too', () => {
    const pt = { lat: 10, lon: 20.05 };
    const ref = predictDbm(pt, [{ lat: 10, lng: 20 }], params, null);
    const own = predictDbm(pt, [{ lat: 10, lng: 20, eirpDbm: 43 }], params, null);
    expect(own - ref).toBeCloseTo(3, 6);
  });
});

describe('radio links: budget, status, features (M50)', () => {
  it('link budget adds the rx antenna gain', () => {
    const a = linkBudget({ distanceM: 10000, freqMHz: 450, txEirpDbm: 40, rxThreshDbm: -110 });
    const b = linkBudget({ distanceM: 10000, freqMHz: 450, txEirpDbm: 40, rxThreshDbm: -110, rxGainDbi: 6 });
    expect(b.marginDb - a.marginDb).toBeCloseTo(6, 6);
  });
  it('status from margin and Fresnel clearance', () => {
    expect(linkStatus(null)).toBe('unknown');
    expect(linkStatus({ budget: { marginDb: 15 }, obstructed: false })).toBe('ok');
    expect(linkStatus({ budget: { marginDb: 15 }, obstructed: true })).toBe('warn');
    expect(linkStatus({ budget: { marginDb: 4 }, obstructed: false })).toBe('warn');
    expect(linkStatus({ budget: { marginDb: -1 }, obstructed: false })).toBe('bad');
  });
  it('one line per link with both ends; label falls back to the site names', () => {
    const sites = [{ id: 's1', lat: 10, lng: 20, name: 'A' }, { id: 's2', lat: 10, lng: 20.1, name: 'B' }];
    const links = [{ id: 'l1', a: 's1', b: 's2', label: '' }, { id: 'l2', a: 's1', b: 'gone', label: 'x' }];
    const fc = linkFeatures(sites, links, new Map([['l1', { budget: { marginDb: 20 }, obstructed: false }]]));
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties).toMatchObject({ id: 'l1', label: 'A – B', status: 'ok' });
    expect(fc.features[0].properties.km).toBeCloseTo(11, 0);
  });
});

describe('site RF popover parsing (M50)', () => {
  it('empty means follow the panel; clamps; accepts a decimal comma', () => {
    expect(parseSiteRf('', '')).toEqual({ txHeightM: null, powerW: null });
    expect(parseSiteRf('25', '2,5')).toEqual({ txHeightM: 25, powerW: 2.5 });
    expect(parseSiteRf('0', '500')).toEqual({ txHeightM: 1, powerW: 100 });
    expect(parseSiteRf('abc', '')).toEqual({ error: 'Mast height is not a number' });
  });
});
