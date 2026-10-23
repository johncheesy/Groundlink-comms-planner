import { describe, it, expect, vi } from 'vitest';
import { createMission, SITE_RF_LIMITS } from './mission.js';
import { siteLabel } from './mission-tools.js';

// Synthetic positions only (OPSEC).
const mk = () => {
  const onChange = vi.fn();
  const m = createMission({ onChange });
  const a = m.addSite(10, 20, 'A');
  const b = m.addSite(10.1, 20.1, 'B');
  const c = m.addSite(10.2, 20.2, 'C');
  return { m, a, b, c, onChange };
};

describe('per-site mast height and power (M50)', () => {
  it('sets, clamps and clears overrides', () => {
    const { m, a } = mk();
    m.setSiteRf(a.id, { txHeightM: 25, powerW: 10 });
    expect(m.getSites()[0]).toMatchObject({ txHeightM: 25, powerW: 10 });
    m.setSiteRf(a.id, { txHeightM: 9999, powerW: 0 });
    expect(m.getSites()[0].txHeightM).toBe(SITE_RF_LIMITS.txHeightM[1]);
    expect(m.getSites()[0].powerW).toBe(SITE_RF_LIMITS.powerW[0]);
    m.setSiteRf(a.id, { txHeightM: null, powerW: null });
    expect(m.getSites()[0]).not.toHaveProperty('txHeightM');
    expect(m.getSites()[0]).not.toHaveProperty('powerW');
  });

  it('leaves a field alone when it is not part of the change', () => {
    const { m, a } = mk();
    m.setSiteRf(a.id, { txHeightM: 25, powerW: 10 });
    m.setSiteRf(a.id, { powerW: 5 });
    expect(m.getSites()[0]).toMatchObject({ txHeightM: 25, powerW: 5 });
  });

  it('labels a site with its own values', () => {
    expect(siteLabel({ name: 'Ridge' })).toBe('Ridge');
    expect(siteLabel({ name: 'Ridge', txHeightM: 25, powerW: 10 })).toBe('Ridge · 25 m · 10 W');
    expect(siteLabel({ name: '', powerW: 2.5 })).toBe('Site · 2.5 W');
  });
});

describe('radio links (M50)', () => {
  it('links two different existing sites once, in either direction', () => {
    const { m, a, b } = mk();
    expect(m.addLink(a.id, b.id, { label: 'Backhaul', freqMHz: 450 })).toMatchObject({ a: a.id, b: b.id, label: 'Backhaul', freqMHz: 450 });
    expect(m.addLink(b.id, a.id)).toBeNull(); // same pair
    expect(m.addLink(a.id, a.id)).toBeNull(); // self
    expect(m.addLink(a.id, 'nope')).toBeNull(); // missing site
    expect(m.getLinks()).toHaveLength(1);
    expect(m.summary().links).toBe(1);
  });

  it('drops a link when one of its sites goes', () => {
    const { m, a, b, c } = mk();
    m.addLink(a.id, b.id);
    m.addLink(b.id, c.id);
    m.removeSite(a.id);
    expect(m.getLinks().map((l) => [l.a, l.b])).toEqual([[b.id, c.id]]);
    m.clearSites();
    expect(m.getLinks()).toEqual([]);
  });

  it('renames and removes links; ignores a bad band', () => {
    const { m, a, b } = mk();
    const l = m.addLink(a.id, b.id, { freqMHz: 'x' });
    expect(l).not.toHaveProperty('freqMHz');
    m.renameLink(l.id, 'Hilltop');
    expect(m.getLinks()[0].label).toBe('Hilltop');
    m.removeLink(l.id);
    expect(m.getLinks()).toEqual([]);
  });

  it('clearAll removes links', () => {
    const { m, a, b } = mk();
    m.addLink(a.id, b.id);
    m.clearAll();
    expect(m.getLinks()).toEqual([]);
  });
});
