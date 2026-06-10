import { describe, it, expect } from 'vitest';
import { skyColoursFor } from './map.js';

const HEX = /^#[0-9a-f]{6}$/;

describe('day/night sky colour ramp (MapLibre v5 setSky)', () => {
  it('returns valid hex colours for sky, horizon and fog', () => {
    for (const alt of [-90, -12, -6, 0, 6, 20, 90]) {
      const c = skyColoursFor(alt);
      expect(c.sky).toMatch(HEX);
      expect(c.horizon).toMatch(HEX);
      expect(c.fog).toMatch(HEX);
    }
  });

  it('night matches the dark map canvas (--mapbg #0b1018)', () => {
    expect(skyColoursFor(-12).sky).toBe('#0b1018');
    expect(skyColoursFor(-40).sky).toBe('#0b1018'); // clamped below the ramp
  });

  it('full day is the bright sky stop (clamped above the ramp)', () => {
    expect(skyColoursFor(20).sky).toBe('#7fb8e6');
    expect(skyColoursFor(60).sky).toBe('#7fb8e6');
  });

  it('hits the exact stop values at stop altitudes', () => {
    expect(skyColoursFor(0)).toEqual({ sky: '#274b73', horizon: '#c97b4f', fog: '#3a4a5f' });
  });

  it('interpolates between stops (midway twilight is between its stops)', () => {
    const mid = skyColoursFor(-3); // midway between -6 and 0
    expect(mid.sky).not.toBe(skyColoursFor(-6).sky);
    expect(mid.sky).not.toBe(skyColoursFor(0).sky);
    // red channel grows monotonically from night to horizon
    const r = (hex) => parseInt(hex.slice(1, 3), 16);
    expect(r(skyColoursFor(-6).sky)).toBeLessThan(r(mid.sky));
    expect(r(mid.sky)).toBeLessThan(r(skyColoursFor(0).sky));
  });

  it('day is brighter than night on every channel', () => {
    const ch = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
    const night = skyColoursFor(-12);
    const day = skyColoursFor(20);
    for (const i of [0, 1, 2]) expect(ch(day.sky, i)).toBeGreaterThan(ch(night.sky, i));
  });
});
