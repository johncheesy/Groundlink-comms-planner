import { describe, it, expect } from 'vitest';
import { mastFeatures, discRing, panelRing } from './masts-3d.js';

const parts = (fc, id) => fc.features.filter((f) => f.properties.id === id).map((f) => f.properties.part);
const byPart = (fc, id, part) => fc.features.find((f) => f.properties.id === id && f.properties.part === part);

describe('mastFeatures', () => {
  const sites = [{ id: 'a', lat: 52, lng: 5, name: 'Ridge', txHeightM: 25 }, { id: 'b', lat: 52, lng: 5.1, name: 'Barn' }];
  it('builds plinth, mast and head per site; own height or the panel height', () => {
    const fc = mastFeatures(sites, { panelHeightM: 10 });
    expect(parts(fc, 'a')).toEqual(['plinth', 'mast', 'head']);
    expect(byPart(fc, 'a', 'mast').properties).toMatchObject({ base: 0, top: 25 });
    expect(byPart(fc, 'a', 'head').properties).toMatchObject({ base: 23.5, top: 25 });
    expect(byPart(fc, 'b', 'mast').properties.top).toBe(10);
    expect(fc.features).toHaveLength(6);
  });
  it('adds a rotated panel for a directional antenna, none for omni', () => {
    const dir = { beamwidthDeg: 65, azimuthDeg: 90 };
    const fc = mastFeatures([{ ...sites[0], azimuthDeg: 180 }, sites[1]], { panelHeightM: 10, antenna: dir });
    expect(parts(fc, 'a')).toContain('panel');
    expect(parts(fc, 'b')).toContain('panel');
    expect(byPart(fc, 'a', 'panel').properties).toMatchObject({ base: 23, top: 24.5 });
    expect(parts(mastFeatures(sites, { antenna: { beamwidthDeg: 360 } }), 'a')).not.toContain('panel');
  });
  it('adds a hovering drone with a tether when a drone is placed', () => {
    const fc = mastFeatures([], { drone: { lat: 52, lng: 5, altM: 100 } });
    expect(parts(fc, 'drone')).toEqual(['tether', 'drone']);
    expect(byPart(fc, 'drone', 'drone').properties).toMatchObject({ base: 99, top: 100 });
    expect(byPart(fc, 'drone', 'tether').properties).toMatchObject({ base: 0, top: 99 });
    expect(mastFeatures([], {}).features).toEqual([]);
  });
});

describe('rings', () => {
  it('discRing is closed, has the requested sides and is round in metres at any latitude', () => {
    const r = discRing(5, 60, 10, 12);
    expect(r).toHaveLength(13);
    expect(r[0]).toEqual(r[12]);
    const dLng = Math.abs(r[0][0] - 5); // east point
    const dLat = Math.abs(r[3][1] - 60); // north point
    expect(dLng / dLat).toBeCloseTo(1 / Math.cos((60 * Math.PI) / 180), 1);
  });
  it('panelRing is 1.6 m across the azimuth: east-west for a north-pointing antenna', () => {
    const r = panelRing(5, 52, 0, 1.6, 0.3);
    const lngs = r.map((p) => p[0]);
    const lats = r.map((p) => p[1]);
    const spanE = (Math.max(...lngs) - Math.min(...lngs)) * 111320 * Math.cos((52 * Math.PI) / 180);
    const spanN = (Math.max(...lats) - Math.min(...lats)) * 111320;
    expect(spanE).toBeCloseTo(1.6, 1);
    expect(spanN).toBeCloseTo(0.3, 1);
    const r2 = panelRing(5, 52, 90, 1.6, 0.3);
    const spanN2 = (Math.max(...r2.map((p) => p[1])) - Math.min(...r2.map((p) => p[1]))) * 111320;
    expect(spanN2).toBeCloseTo(1.6, 1);
  });
});
