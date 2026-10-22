import { describe, it, expect } from 'vitest';
import { routeByName, routeJsonText, describeFeatureCounts, describeImports, IMPORT_ACCEPT } from './route.js';
import { MISSION_FORMAT } from './mission.js';

describe('routeByName', () => {
  it('sends mission files to the mission loader', () => {
    expect(routeByName('plan.groundlink.json')).toBe('mission');
    expect(routeByName('PLAN.GROUNDLINK.JSON')).toBe('mission');
  });
  it('defers plain .json to a content sniff', () => {
    expect(routeByName('export.json')).toBe('json');
  });
  it('sends KML / KMZ / GPX / GeoJSON to the overlay importer', () => {
    for (const n of ['a.kml', 'b.KMZ', 'c.gpx', 'd.geojson']) expect(routeByName(n)).toBe('overlay');
  });
  it('sends CSV to field calibration', () => {
    expect(routeByName('drive-test.csv')).toBe('calibration');
  });
  it('recognises GeoTIFFs and unknown files', () => {
    expect(routeByName('dem.tif')).toBe('geotiff');
    expect(routeByName('canopy.TIFF')).toBe('geotiff');
    expect(routeByName('notes.txt')).toBe('unknown');
    expect(routeByName('no-extension')).toBe('unknown');
    expect(routeByName(undefined)).toBe('unknown');
  });
});

describe('routeJsonText', () => {
  it('spots a renamed mission file', () => {
    expect(routeJsonText(JSON.stringify({ format: MISSION_FORMAT, version: 1 }))).toBe('mission');
  });
  it('treats other JSON and non-JSON as overlay data', () => {
    expect(routeJsonText(JSON.stringify({ type: 'FeatureCollection', features: [] }))).toBe('overlay');
    expect(routeJsonText('not json')).toBe('overlay');
    expect(routeJsonText('null')).toBe('overlay');
  });
});

describe('IMPORT_ACCEPT', () => {
  it('offers every routed type in the picker', () => {
    for (const e of ['.json', '.geojson', '.kml', '.kmz', '.gpx', '.csv']) expect(IMPORT_ACCEPT).toContain(e);
  });
});

describe('describeFeatureCounts', () => {
  it('pluralises and leaves zeros out', () => {
    expect(describeFeatureCounts({ points: 3, lines: 1 })).toBe('3 points, 1 line');
    expect(describeFeatureCounts({ polygons: 2 })).toBe('2 polygons');
    expect(describeFeatureCounts({})).toBe('');
  });
});

describe('describeImports', () => {
  it('says what loaded and where it went', () => {
    expect(describeImports([{ name: 'a.groundlink.json', kind: 'mission', ok: true }]))
      .toBe('Mission loaded from a.groundlink.json and placed on the map.');
    expect(describeImports([{ name: 'b.kml', kind: 'overlay', ok: true, count: 4, byType: { points: 3, lines: 1 } }]))
      .toMatch(/^3 points, 1 line from b\.kml shown on the map\..*Mission panel/);
    expect(describeImports([{ name: 'c.csv', kind: 'calibration', ok: true, count: 1 }]))
      .toMatch(/^1 field measurement from c\.csv .*Field calibration/);
  });
  it('passes on the first skipped-item warning of a mission file', () => {
    expect(describeImports([{ name: 'a.groundlink.json', kind: 'mission', ok: true, warnings: ['2 sites had invalid coordinates.'] }]))
      .toBe('Mission loaded from a.groundlink.json, but some items were skipped. 2 sites had invalid coordinates.');
  });
  it('says "it" for a single feature', () => {
    expect(describeImports([{ name: 'p.kml', kind: 'overlay', ok: true, count: 1, byType: { points: 1 } }]))
      .toBe('1 point from p.kml shown on the map. Use it as sites, route or area in the Mission panel.');
  });
  it('falls back to a feature count when byType is missing', () => {
    expect(describeImports([{ name: 'x.gpx', kind: 'overlay', ok: true, count: 2 }])).toMatch(/^2 features from x\.gpx/);
  });
  it('explains failures, GeoTIFFs and unknown files', () => {
    expect(describeImports([{ name: 'c.csv', kind: 'calibration', ok: false, error: 'Place a site first.' }]))
      .toBe('c.csv not imported: Place a site first.');
    expect(describeImports([{ name: 'd.kml', kind: 'overlay', ok: false }])).toBe('d.kml not imported.');
    expect(describeImports([{ name: 'e.kml', kind: 'overlay', ok: false, message: 'e.kml held no points, lines or polygons.' }]))
      .toBe('e.kml held no points, lines or polygons.');
    expect(describeImports([{ name: 'dem.tif', kind: 'geotiff', ok: false }])).toMatch(/Data panel/);
    expect(describeImports([{ name: 'n.txt', kind: 'unknown', ok: false }])).toMatch(/not a file GroundLink can open/);
  });
  it('joins a batch in file order and ignores empty input', () => {
    const s = describeImports([
      { name: 'a.groundlink.json', kind: 'mission', ok: true },
      { name: 'n.txt', kind: 'unknown', ok: false },
    ]);
    expect(s.indexOf('Mission loaded')).toBeLessThan(s.indexOf('n.txt'));
    expect(describeImports([])).toBe('');
    expect(describeImports(undefined)).toBe('');
  });
});
