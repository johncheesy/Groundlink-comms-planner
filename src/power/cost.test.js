import { describe, it, expect } from 'vitest';
import { costedBom, bomToCsv, parsePrice } from './cost.js';

const radio = (over = {}) => ({ id: 'r1', label: 'Test handheld', price: 250, ...over });
const node = (role, r) => ({ key: role.toLowerCase(), label: role, radio: r });

describe('parsePrice', () => {
  it('accepts non-negative numbers, rejects everything else as unpriced', () => {
    expect(parsePrice(0)).toBe(0);
    expect(parsePrice('120.50')).toBe(120.5);
    expect(parsePrice('')).toBeNull();
    expect(parsePrice(null)).toBeNull();
    expect(parsePrice(undefined)).toBeNull();
    expect(parsePrice(-5)).toBeNull();
    expect(parsePrice('abc')).toBeNull();
  });
});

describe('costedBom', () => {
  it('aggregates role-nodes per radio and multiplies qty × unit price', () => {
    const r = radio();
    const { rows, totalKnown, unpricedCount } = costedBom({
      nodes: [node('Operator', r), node('Rebro', r), node('HQ', radio({ id: 'r2', label: 'Base set', price: 1200 }))],
    });
    expect(rows).toHaveLength(2);
    const hh = rows.find((x) => x.item === 'Test handheld');
    expect(hh.qty).toBe(2);
    expect(hh.unitSpec).toBe('Operator · Rebro');
    expect(hh.total).toBe(500);
    expect(totalKnown).toBe(1700);
    expect(unpricedCount).toBe(0);
  });

  it('unpriced radios stay visible with null totals and count as unpriced', () => {
    const { rows, totalKnown, unpricedCount } = costedBom({
      nodes: [node('Operator', radio({ price: null }))],
    });
    expect(rows[0].unitPrice).toBeNull();
    expect(rows[0].total).toBeNull();
    expect(totalKnown).toBe(0);
    expect(unpricedCount).toBe(1);
  });

  it('prices power lines from the user map, leaves unmapped lines unpriced', () => {
    const powerLines = [
      { item: 'Handheld/manpack batteries', qty: 6, unitSpec: '2.5 Ah', rationale: 'r' },
      { item: 'Solar panel (static site)', qty: 1, unitSpec: '80 W', rationale: 'r' },
    ];
    const { rows, totalKnown, unpricedCount } = costedBom({
      powerLines,
      priceMap: { 'Handheld/manpack batteries': '45' },
    });
    expect(rows[0].total).toBe(270);
    expect(rows[1].unitPrice).toBeNull();
    expect(totalKnown).toBe(270);
    expect(unpricedCount).toBe(1);
  });

  it('skips role-nodes without a radio; rounds to cents', () => {
    const { rows, totalKnown } = costedBom({
      nodes: [node('Operator', null), node('HQ', radio({ price: 0.105 }))],
    });
    expect(rows).toHaveLength(1);
    expect(totalKnown).toBeCloseTo(0.11, 10);
  });
});

describe('bomToCsv', () => {
  it('escapes commas/quotes, keeps unpriced cells empty, appends the total', () => {
    const costed = costedBom({
      nodes: [node('Operator', radio({ label: 'Radio "X", VHF', price: 100 }))],
      powerLines: [{ item: 'Batteries', qty: 2, unitSpec: '2 Ah', rationale: 'r' }],
    });
    const csv = bomToCsv(costed);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('item,qty,unit_spec,unit_price_eur,total_eur');
    expect(lines[1]).toBe('"Radio ""X"", VHF",1,Operator,100,100');
    expect(lines[2]).toBe('Batteries,2,2 Ah,,');
    expect(lines[3]).toBe('TOTAL (priced items),,,,100');
    expect(lines[4]).toContain('1 item(s) unpriced');
  });
});
