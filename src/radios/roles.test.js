import { describe, it, expect } from 'vitest';
import { assignRoles, scoreForRole, NODE_ROLES } from './roles.js';

const arsenal = [
  { label: 'HH VHF', role: 'handheld', defaultFreqMHz: 150, powerW: 5 },
  { label: 'Veh UHF', role: 'mobile', defaultFreqMHz: 450, powerW: 25 },
  { label: 'Repeater VHF', role: 'repeater', defaultFreqMHz: 150, powerW: 50 },
  { label: 'HF manpack', role: 'hf', defaultFreqMHz: 6, powerW: 20 },
  { label: 'Iridium', role: 'satcom', defaultFreqMHz: 1620, powerW: 7 },
];

const byKey = (rows, key) => rows.find((x) => x.key === key);

describe('assignRoles — node-role assignment', () => {
  it('assigns the natural equipment class to each node role', () => {
    const rows = assignRoles(arsenal);
    expect(rows.map((r) => r.key)).toEqual(NODE_ROLES.map((r) => r.key));
    expect(byKey(rows, 'operator').radio.role).toBe('handheld');
    expect(byKey(rows, 'mobile-cp').radio.role).toBe('mobile');
    expect(byKey(rows, 'hq').radio.role).toBe('repeater'); // no 'base' present → repeater wins
    expect(byKey(rows, 'rebro-static').radio.role).toBe('repeater');
  });

  it('never picks HF or satcom as a node bearer when LOS gear exists', () => {
    const rows = assignRoles(arsenal);
    for (const row of rows) {
      expect(row.radio.role === 'hf' || row.radio.role === 'satcom').toBe(false);
    }
  });

  it('returns blank rows with guidance for an empty arsenal', () => {
    const rows = assignRoles([]);
    expect(rows).toHaveLength(NODE_ROLES.length);
    expect(rows.every((r) => r.radio === null)).toBe(true);
    expect(byKey(rows, 'operator').why).toMatch(/add the radios/i);
  });

  it('scores a handheld above a satcom for the operator role', () => {
    const op = NODE_ROLES[0];
    const hh = scoreForRole({ role: 'handheld', defaultFreqMHz: 150, powerW: 5 }, op);
    const sat = scoreForRole({ role: 'satcom', defaultFreqMHz: 1620, powerW: 7 }, op);
    expect(hh).toBeGreaterThan(sat);
  });

  it('rewards higher power for fixed/vehicle nodes and low draw for the manpack', () => {
    const hq = NODE_ROLES.find((r) => r.key === 'hq');
    const op = NODE_ROLES.find((r) => r.key === 'operator');
    const hi = scoreForRole({ role: 'base', defaultFreqMHz: 150, powerW: 50 }, hq);
    const lo = scoreForRole({ role: 'base', defaultFreqMHz: 150, powerW: 5 }, hq);
    expect(hi).toBeGreaterThan(lo); // mains rewards reach
    const light = scoreForRole({ role: 'handheld', defaultFreqMHz: 150, powerW: 5 }, op);
    const heavy = scoreForRole({ role: 'handheld', defaultFreqMHz: 150, powerW: 25 }, op);
    expect(light).toBeGreaterThan(heavy); // battery penalises heavy draw
  });

  it('explains each pick with band + role + power', () => {
    const rows = assignRoles(arsenal, { urbanFrac: 0.4 });
    expect(byKey(rows, 'operator').why).toContain('VHF');
    expect(byKey(rows, 'mobile-cp').why).toContain('UHF');
    expect(byKey(rows, 'operator').alternatives.length).toBeGreaterThan(0);
  });
});
