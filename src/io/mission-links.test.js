import { describe, it, expect } from 'vitest';
import { serializeMission, validateMission } from './mission.js';

// Synthetic positions only (OPSEC).
const sites = [
  { lat: 10, lng: 20, name: 'A', txHeightM: 25, powerW: 10 },
  { lat: 10.1, lng: 20.1, name: 'B' },
  { lat: 10.2, lng: 20.2, name: 'C', azimuthDeg: 90, powerW: 2 },
];
const roundTrip = (state) => validateMission(JSON.parse(JSON.stringify(serializeMission(state))));

describe('mission file: per-site RF and radio links (M50)', () => {
  it('round-trips site height/power and links', () => {
    const links = [{ a: 0, b: 1, label: 'Backhaul', freqMHz: 450 }, { a: 1, b: 2, label: '' }];
    const r = roundTrip({ sites, links });
    expect(r.ok).toBe(true);
    expect(r.mission.sites).toEqual(sites);
    expect(r.mission.links).toEqual(links);
  });

  it('clamps out-of-range site values', () => {
    const r = roundTrip({ sites: [{ lat: 10, lng: 20, name: 'A', txHeightM: 5000, powerW: -3 }] });
    expect(r.mission.sites[0]).toMatchObject({ txHeightM: 300, powerW: 0.01 });
  });

  it('keeps links on their sites when a bad site is dropped', () => {
    const file = serializeMission({ sites: [] });
    file.mission.sites = [sites[0], { lat: 999, lng: 0, name: 'bad' }, sites[1], sites[2]];
    file.mission.links = [{ a: 0, b: 2 }, { a: 1, b: 3 }, { a: 2, b: 3 }];
    const r = validateMission(file);
    expect(r.mission.sites.map((s) => s.name)).toEqual(['A', 'B', 'C']);
    // 0–2 → A–B, 1–3 pointed at the dropped site, 2–3 → B–C.
    expect(r.mission.links.map(({ a, b }) => [a, b])).toEqual([[0, 1], [1, 2]]);
  });

  it('drops self-links, duplicates and links to missing sites', () => {
    const file = serializeMission({ sites });
    file.mission.links = [{ a: 0, b: 0 }, { a: 0, b: 1 }, { a: 1, b: 0 }, { a: 0, b: 7 }, { a: 'x', b: 1 }, null];
    const r = validateMission(file);
    expect(r.mission.links).toEqual([{ a: 0, b: 1, label: '' }]);
  });

  it('older files without links load with none', () => {
    const r = roundTrip({ sites });
    expect(r.mission.links).toEqual([]);
  });

  it('round-trips the cable/duplexer loss', () => {
    const r = roundTrip({ coverage: { freqMHz: 450, powerW: 5, txLossDb: 3 } });
    expect(r.mission.coverage.txLossDb).toBe(3);
  });
});
