import { describe, it, expect } from 'vitest';
import { atakConsumedMah, powerbankRecommendation } from './atak.js';

describe('atakConsumedMah', () => {
  it('600 mA over 8 h → 4800 mAh', () => {
    expect(atakConsumedMah(600, 8)).toBe(4800);
  });

  it('defaults to ~600 mA when no draw is given', () => {
    expect(atakConsumedMah(undefined, 10)).toBe(6000);
  });
});

describe('powerbankRecommendation — 0.65 deration', () => {
  it('4800 consumed, 5000 device, 0.65 → device covers the mission (0 packs required)', () => {
    const r = powerbankRecommendation(4800, 5000, 0.65);
    expect(r.deficitMah).toBe(0);
    expect(r.recommendedRatedMah).toBe(0);
    expect(r.count).toBe(0);
    // practical "carry this to stay topped" suggestion is still surfaced
    expect(r.fullOffBankRatedMah).toBe(Math.ceil(4800 / 0.65)); // 7385
    expect(r.fullOffBankSizeMah).toBe(10000);
    expect(r.fullOffBankCount).toBe(1);
  });

  it('applies the deration when consumption exceeds the device battery', () => {
    const r = powerbankRecommendation(8000, 5000, 0.65);
    // deficit 3000 mAh / 0.65 = 4615.4 → 4616 rated → one 5000 mAh pack
    expect(r.deficitMah).toBe(3000);
    expect(r.recommendedRatedMah).toBe(Math.ceil(3000 / 0.65));
    expect(r.standardSizeMah).toBe(5000);
    expect(r.count).toBe(1);
  });

  it('multiplies packs when a single standard size is not enough', () => {
    // 72 h mission: 600 mA × 72 = 43200 mAh consumed
    const consumed = atakConsumedMah(600, 72);
    const r = powerbankRecommendation(consumed, 5000, 0.65);
    expect(r.deficitMah).toBe(38200);
    expect(r.standardSizeMah).toBe(26800); // largest standard size
    expect(r.count).toBeGreaterThanOrEqual(3); // ceil(58769 / 26800)
  });
});
