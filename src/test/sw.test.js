import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SW = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../public/sw.js'), 'utf8');

/** Load the real sw.js in a sandbox with a fake Cache API and network. */
function loadSw({ cached = [] } = {}) {
  const handlers = {};
  const puts = [];
  const deleted = [];
  const fetched = [];
  const store = [...cached]; // urls already in the tile cache
  const cache = {
    match: async () => undefined,
    put: async (req) => { puts.push(typeof req === 'string' ? req : req.url); },
    keys: async () => store.map((url) => ({ url })),
    delete: async (req) => { deleted.push(req.url ?? req); return true; },
  };
  const sandbox = {
    self: {
      addEventListener: (type, fn) => { handlers[type] = fn; },
      registration: { scope: 'https://example.test/app/' },
      skipWaiting: async () => {},
      clients: { claim: async () => {}, matchAll: async () => [] },
    },
    caches: { open: async () => cache, keys: async () => ['groundlink-tiles-v1'], delete: async () => true },
    fetch: async (req) => { fetched.push(typeof req === 'string' ? req : req.url); return new Response('tile', { status: 200 }); },
    performance, Response, Headers, URL, Promise, Set, Math, Number, console,
  };
  vm.runInNewContext(SW, sandbox);
  return { handlers, puts, deleted, fetched };
}

const request = (url) => ({ method: 'GET', url, mode: 'cors' });
async function dispatchFetch(h, url) {
  let responded;
  h.handlers.fetch({ request: request(url), respondWith: (p) => { responded = p; } });
  if (responded) await responded;
  return Boolean(responded);
}

describe('service worker: Esri imagery is never stored', () => {
  it('sends Esri tile requests straight to the network and caches nothing', async () => {
    const h = loadSw();
    const handled = await dispatchFetch(h, 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/5/10/16');
    expect(handled).toBe(true);
    expect(h.fetched).toHaveLength(1);
    expect(h.puts).toEqual([]);
  });
  it('covers every Esri tile host, not only the one in use today', async () => {
    for (const host of ['server.arcgisonline.com', 'services.arcgisonline.com', 'clarity.maptiles.arcgisonline.com']) {
      const h = loadSw();
      await dispatchFetch(h, `https://${host}/x/1/2/3`);
      expect(h.puts).toEqual([]);
    }
  });
  it('still caches other tile providers (offline basemaps keep working)', async () => {
    const h = loadSw();
    await dispatchFetch(h, 'https://tiles.maps.eox.at/wms?bbox=1,2,3,4');
    expect(h.puts).toHaveLength(1);
  });
  it('activate deletes Esri tiles stored by older builds and keeps the rest', async () => {
    const h = loadSw({ cached: [
      'https://server.arcgisonline.com/a/1',
      'https://services.arcgisonline.com/a/2',
      'https://tiles.maps.eox.at/wms?x=1',
      'https://tile.openstreetmap.org/1/2/3.png',
    ] });
    let done;
    h.handlers.activate({ waitUntil: (p) => { done = p; } });
    await done;
    expect(h.deleted.sort()).toEqual(['https://server.arcgisonline.com/a/1', 'https://services.arcgisonline.com/a/2']);
  });
});
