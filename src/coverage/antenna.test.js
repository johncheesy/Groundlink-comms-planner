import { describe, it, expect } from 'vitest';
import {
  ANTENNA_PRESETS, normalizeAntenna, isOmni, bearingDeg, angleOff, patternLossDb, antennaText,
} from './antenna.js';

describe('bearingDeg', () => {
  it('gives compass bearings', () => {
    expect(bearingDeg(0, 0, 1, 0)).toBeCloseTo(0, 6); // north
    expect(bearingDeg(0, 0, 0, 1)).toBeCloseTo(90, 6); // east
    expect(bearingDeg(0, 0, -1, 0)).toBeCloseTo(180, 6); // south
    expect(bearingDeg(0, 0, 0, -1)).toBeCloseTo(270, 6); // west
  });
});

describe('angleOff', () => {
  it('is the smallest angle across north', () => {
    expect(angleOff(350, 10)).toBe(20);
    expect(angleOff(10, 350)).toBe(20);
    expect(angleOff(90, 270)).toBe(180);
    expect(angleOff(-30, 30)).toBe(60);
  });
});

describe('patternLossDb', () => {
  const yagi = normalizeAntenna({ preset: 'yagi5', ...ANTENNA_PRESETS.yagi5, azimuthDeg: 90 });

  it('is 0 for omni antennas in every direction', () => {
    const omni = normalizeAntenna({ preset: 'dipole' });
    for (const b of [0, 45, 180, 300]) expect(patternLossDb(omni, b)).toBe(0);
  });

  it('is 0 on boresight and 3 dB at the beam edge', () => {
    expect(patternLossDb(yagi, 90)).toBe(0);
    expect(patternLossDb(yagi, 90 + yagi.beamwidthDeg / 2)).toBeCloseTo(3, 9);
    expect(patternLossDb(yagi, 90 - yagi.beamwidthDeg / 2)).toBeCloseTo(3, 9);
  });

  it('is capped at the front-to-back ratio behind the antenna', () => {
    expect(patternLossDb(yagi, 270)).toBe(yagi.fbDb);
    expect(patternLossDb(yagi, 200)).toBe(yagi.fbDb);
  });
});

describe('normalizeAntenna', () => {
  it('defaults to the old fixed 2.15 dBi dipole', () => {
    const a = normalizeAntenna();
    expect(a).toMatchObject({ preset: 'dipole', gainDbi: 2.15, beamwidthDeg: 360 });
    expect(isOmni(a)).toBe(true);
  });

  it('clamps nonsense and wraps the pointing', () => {
    const a = normalizeAntenna({ preset: 'custom', gainDbi: 99, beamwidthDeg: 1, fbDb: -5, azimuthDeg: -90 });
    expect(a).toMatchObject({ preset: 'custom', gainDbi: 30, beamwidthDeg: 5, fbDb: 0, azimuthDeg: 270 });
  });

  it('fills missing values from the preset', () => {
    expect(normalizeAntenna({ preset: 'sector90' })).toMatchObject({ gainDbi: 12, beamwidthDeg: 90, fbDb: 25 });
  });
});

describe('antennaText', () => {
  it('names omni and directional antennas', () => {
    expect(antennaText({ preset: 'dipole' })).toBe('Dipole / whip 2.15 dBi');
    expect(antennaText({ preset: 'yagi5', azimuthDeg: 45 })).toBe('Yagi 5-element 10 dBi → 45°');
  });
});
