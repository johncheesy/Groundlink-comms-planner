import { describe, it, expect, vi } from 'vitest';
import {
  HIRES_SOURCES, hiresSource, tileBbox3857, tileUrl, parseHiresUrl, isBlankPixels,
  sourcesAt, drawOrder, hiresStyleParts, registerHiresProtocol, transparentPng, BLANK_CHECK_MAX_BYTES,
  tileCenterLngLat, createCoverageMemory,
} from './hires-imagery.js';

describe('source registry', () => {
  it('every source is well-formed and keyless', () => {
    const ids = new Set();
    for (const s of HIRES_SOURCES) {
      expect(ids.has(s.id)).toBe(false); ids.add(s.id);
      expect(s.template).toMatch(/^https:\/\//);
      expect(s.template).not.toMatch(/key=|token=|apikey/i);
      expect(/\{z\}|\{bbox\}/.test(s.template)).toBe(true);
      const [w, so, e, n] = s.bounds;
      expect(w).toBeLessThan(e); expect(so).toBeLessThan(n);
      expect(Math.abs(so)).toBeLessThanOrEqual(90); expect(Math.abs(w)).toBeLessThanOrEqual(180);
      expect(s.maxzoom).toBeGreaterThanOrEqual(s.minzoom);
      expect(s.attribution.length).toBeGreaterThan(5);
      expect(s.resolution).toBeTruthy();
    }
  });
  it('hiresSource looks up by id', () => {
    expect(hiresSource('nl-pdok').label).toMatch(/Netherlands/);
    expect(hiresSource('nope')).toBeNull();
  });
});

describe('tile maths', () => {
  it('the zoom-0 tile is the whole Web Mercator square', () => {
    const [w, s, e, n] = tileBbox3857(0, 0, 0).split(',').map(Number);
    expect(w).toBeCloseTo(-20037508.34, 1); expect(e).toBeCloseTo(20037508.34, 1);
    expect(s).toBeCloseTo(-20037508.34, 1); expect(n).toBeCloseTo(20037508.34, 1);
  });
  it('children split the parent exactly', () => {
    const [w0, , e0] = tileBbox3857(1, 0, 0).split(',').map(Number);
    const [w1, , e1] = tileBbox3857(1, 1, 0).split(',').map(Number);
    expect(e0).toBeCloseTo(w1, 3);
    expect(w0).toBeCloseTo(-20037508.34, 1); expect(e1).toBeCloseTo(20037508.34, 1);
  });
  it('fills XYZ and WMS templates', () => {
    expect(tileUrl(hiresSource('nl-pdok'), 18, 134000, 85000)).toBe('https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/18/134000/85000.jpeg');
    const wms = tileUrl(hiresSource('de-nrw'), 15, 17000, 10900);
    expect(wms).toMatch(/bbox=-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+$/);
    expect(wms).not.toMatch(/\{/);
    const at = tileUrl(hiresSource('at-basemap'), 16, 1, 2);
    expect(at).toMatch(/\/16\/2\/1\.jpeg$/); // this service wants {z}/{y}/{x}
  });
  it('parses the internal URL', () => {
    expect(parseHiresUrl('hires://nl-pdok/18/134000/85000')).toEqual({ id: 'nl-pdok', z: 18, x: 134000, y: 85000 });
    expect(parseHiresUrl('https://x/1/2/3')).toBeNull();
    expect(parseHiresUrl('hires://nl-pdok/a/b/c')).toBeNull();
  });
});

describe('isBlankPixels', () => {
  const fill = (n, rgba) => Uint8ClampedArray.from(Array.from({ length: n }, () => rgba).flat());
  it('white and transparent tiles are blank', () => {
    expect(isBlankPixels(fill(256, [255, 255, 255, 255]))).toBe(true);
    expect(isBlankPixels(fill(256, [0, 0, 0, 0]))).toBe(true);
    expect(isBlankPixels(new Uint8ClampedArray(0))).toBe(true);
  });
  it('real imagery is not, including dark water and light roofs', () => {
    expect(isBlankPixels(fill(256, [20, 40, 70, 255]))).toBe(false);
    expect(isBlankPixels(fill(256, [235, 235, 232, 255]))).toBe(false);
  });
  it('a few real pixels on a white tile still count as content once past the tolerance', () => {
    const a = Array.from({ length: 256 }, (_, i) => (i < 10 ? [30, 60, 20, 255] : [255, 255, 255, 255])).flat();
    expect(isBlankPixels(Uint8ClampedArray.from(a))).toBe(false); // 10/256 ≈ 4% content
  });
});

describe('sourcesAt', () => {
  it('Amsterdam at street zoom gets PDOK first', () => {
    const r = sourcesAt(4.9, 52.37, 16);
    expect(r[0].id).toBe('nl-pdok');
  });
  it('nothing at a coarse zoom or over the ocean', () => {
    expect(sourcesAt(4.9, 52.37, 8)).toEqual([]);
    expect(sourcesAt(-30, 40, 16)).toEqual([]);
  });
  it('US only at the zoom where NAIP-level detail exists', () => {
    expect(sourcesAt(-98, 39, 12).some((s) => s.id === 'us-usgs')).toBe(false);
    expect(sourcesAt(-98, 39, 14).some((s) => s.id === 'us-usgs')).toBe(true);
  });
  it('overlapping rectangles return every candidate, sharpest first', () => {
    // Cologne lies inside the NRW area and also inside the NL rectangle; only the
    // handler's blank-tile check knows which one really has imagery there.
    const ids = sourcesAt(6.9, 50.9, 16).map((s) => s.id);
    expect(ids).toContain('de-nrw');
    expect(ids).toContain('nl-pdok');
    expect(ids[0]).toBe('nl-pdok'); // 8 cm ranks ahead of 10–20 cm
  });
});

describe('style parts', () => {
  it('declares a source and a layer per region, drawn large to small', () => {
    const { sources, layers } = hiresStyleParts();
    expect(Object.keys(sources)).toHaveLength(HIRES_SOURCES.length);
    expect(layers).toHaveLength(HIRES_SOURCES.length);
    for (const s of Object.values(sources)) { expect(s.tiles[0]).toMatch(/^hires:\/\//); expect(s.bounds).toHaveLength(4); }
    const order = drawOrder();
    const area = (s) => (s.bounds[2] - s.bounds[0]) * (s.bounds[3] - s.bounds[1]);
    for (let i = 1; i < order.length; i++) expect(area(order[i - 1])).toBeGreaterThanOrEqual(area(order[i]));
  });
  it('can start hidden', () => {
    expect(hiresStyleParts({ visible: false }).layers.every((l) => l.layout.visibility === 'none')).toBe(true);
  });
});

describe('hires:// protocol handler', () => {
  const setup = (fetchImpl) => {
    let handler;
    registerHiresProtocol({ addProtocol: (name, fn) => { expect(name).toBe('hires'); handler = fn; } }, { fetchImpl });
    return handler;
  };
  const photo = new Uint8Array(BLANK_CHECK_MAX_BYTES + 100).buffer;
  const isTransparent = (r) => new Uint8Array(r.data).length === new Uint8Array(transparentPng()).length;

  it('returns real tile bytes untouched', async () => {
    const h = setup(vi.fn(async () => ({ ok: true, arrayBuffer: async () => photo })));
    const r = await h({ url: 'hires://nl-pdok/16/33000/21000' }, new AbortController());
    expect(r.data).toBe(photo);
  });
  it('requests the real provider URL', async () => {
    const f = vi.fn(async () => ({ ok: true, arrayBuffer: async () => photo }));
    await setup(f)({ url: 'hires://fr-ign/16/33000/22000' }, new AbortController());
    expect(f.mock.calls[0][0]).toMatch(/^https:\/\/data\.geopf\.fr\/wmts\?.*TILEMATRIX=16.*TILEROW=22000.*TILECOL=33000/);
  });
  it('404, server error and network failure all become a transparent tile (base map shows through)', async () => {
    expect(isTransparent(await setup(async () => ({ ok: false, status: 404 }))({ url: 'hires://fr-ign/1/1/1' }, new AbortController()))).toBe(true);
    expect(isTransparent(await setup(async () => ({ ok: false, status: 503 }))({ url: 'hires://fr-ign/1/1/1' }, new AbortController()))).toBe(true);
    expect(isTransparent(await setup(async () => { throw new TypeError('Failed to fetch'); })({ url: 'hires://fr-ign/1/1/1' }, new AbortController()))).toBe(true);
  });
  it('an unknown source or malformed URL is transparent, not an error', async () => {
    const h = setup(vi.fn());
    expect(isTransparent(await h({ url: 'hires://nope/1/1/1' }, new AbortController()))).toBe(true);
    expect(isTransparent(await h({ url: 'garbage' }, new AbortController()))).toBe(true);
  });
  it('reports which source really delivered imagery', async () => {
    const seen = [];
    let h;
    registerHiresProtocol({ addProtocol: (_n, fn) => { h = fn; } }, { fetchImpl: vi.fn(async () => ({ ok: true, arrayBuffer: async () => photo })), onResult: (r) => seen.push(r) });
    await h({ url: 'hires://nl-pdok/16/1/1' }, new AbortController());
    let h2;
    registerHiresProtocol({ addProtocol: (_n, fn) => { h2 = fn; } }, { fetchImpl: async () => ({ ok: false, status: 404 }), onResult: (r) => seen.push(r) });
    await h2({ url: 'hires://fr-ign/16/1/1' }, new AbortController());
    expect(seen).toEqual([
      { id: 'nl-pdok', real: true, z: 16, x: 1, y: 1 },
      { id: 'fr-ign', real: false, z: 16, x: 1, y: 1 },
    ]);
  });
  it('a throwing UI hook cannot break tile loading', async () => {
    let h;
    registerHiresProtocol({ addProtocol: (_n, fn) => { h = fn; } }, { fetchImpl: vi.fn(async () => ({ ok: true, arrayBuffer: async () => photo })), onResult: () => { throw new Error('ui'); } });
    const r = await h({ url: 'hires://nl-pdok/16/1/1' }, new AbortController());
    expect(r.data).toBe(photo);
  });
  it('a cancelled request is rethrown, not painted', async () => {
    const ac = new AbortController();
    const h = setup(async () => { ac.abort(); throw new DOMException('aborted', 'AbortError'); });
    await expect(h({ url: 'hires://nl-pdok/1/1/1' }, ac)).rejects.toThrow();
  });
  it('a small tile that cannot be decoded here is shown rather than guessed blank', async () => {
    const small = new Uint8Array(500).buffer;
    const r = await setup(async () => ({ ok: true, arrayBuffer: async () => small }))({ url: 'hires://nl-pdok/1/1/1' }, new AbortController());
    expect(r.data).toBe(small);
  });
});

describe('tileCenterLngLat / coverage memory', () => {
  it('zoom 0 centre is 0,0 and Amsterdam tiles land near Amsterdam', () => {
    const [lng0, lat0] = tileCenterLngLat(0, 0, 0);
    expect(lng0).toBeCloseTo(0, 6); expect(lat0).toBeCloseTo(0, 6);
    // the z16 tile containing 4.9E 52.37N is x=33660, y=21537; its centre is within half a tile of that point
    const [lng, lat] = tileCenterLngLat(16, 33660, 21537);
    expect(Math.abs(lng - 4.9)).toBeLessThan(0.003); expect(Math.abs(lat - 52.37)).toBeLessThan(0.003);
  });
  it('reports a source only while its imagery is inside the view', () => {
    const m = createCoverageMemory();
    m.record('nl-pdok', 16, 33660, 21537);
    expect(m.inView({ west: 4.8, east: 5.0, south: 52.3, north: 52.4 })).toEqual(['nl-pdok']);
    expect(m.inView({ west: 12, east: 13, south: 48, north: 49 })).toEqual([]);
  });
  it('caps memory per source and ignores junk', () => {
    const m = createCoverageMemory({ perSource: 3 });
    for (let i = 0; i < 10; i++) m.record('a', 16, 30000 + i, 20000);
    m.record('a', NaN, 1, 1);
    expect(m.inView({ west: -180, east: 180, south: -85, north: 85 })).toEqual(['a']);
  });
});
