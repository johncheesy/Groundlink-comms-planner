import { describe, it, expect } from 'vitest';
import { photonToPlaces } from './search.js';

describe('photonToPlaces (M23 §1)', () => {
  it('maps a Photon feature to the Nominatim-style place shape', () => {
    const geojson = {
      features: [
        {
          geometry: { type: 'Point', coordinates: [18.54, 69.05] },
          properties: {
            name: 'Bardufoss lufthavn',
            city: 'Bardufoss',
            county: 'Troms',
            country: 'Norge',
            extent: [18.49, 69.06, 18.57, 69.04], // [w, n, e, s]
          },
        },
      ],
    };
    expect(photonToPlaces(geojson)).toEqual([
      {
        display_name: 'Bardufoss lufthavn, Bardufoss, Troms, Norge',
        lat: 69.05,
        lon: 18.54,
        boundingbox: [69.04, 69.06, 18.49, 18.57], // [s, n, w, e]
      },
    ]);
  });

  it('deduplicates repeated name parts and tolerates missing fields', () => {
    const geojson = {
      features: [
        {
          geometry: { type: 'Point', coordinates: [5.0, 52.0] },
          properties: { name: 'Utrecht', city: 'Utrecht', country: 'Nederland' },
        },
      ],
    };
    const [p] = photonToPlaces(geojson);
    expect(p.display_name).toBe('Utrecht, Nederland');
    expect(p.boundingbox).toBeUndefined();
  });

  it('skips features without coordinates or any name', () => {
    const geojson = {
      features: [
        { geometry: { type: 'Point', coordinates: [] }, properties: { name: 'nowhere' } },
        { geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} },
      ],
    };
    expect(photonToPlaces(geojson)).toEqual([]);
  });

  it('returns [] for empty / malformed responses', () => {
    expect(photonToPlaces(null)).toEqual([]);
    expect(photonToPlaces({})).toEqual([]);
  });
});
