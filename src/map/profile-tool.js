import maplibregl from 'maplibre-gl';

import { fetchDemProfile } from '../analysis/dem-fetch.js';
import {
  buildPathProfile,
  fresnelClearance,
  linkBudget,
} from '../analysis/path-profile.js';
import { deygoutLossDb } from '../coverage/model.js';

/**
 * Two-click terrain path-profile tool (M14).
 *
 * First click drops a start marker; the second drops an end marker, fetches a
 * DEM for the bbox on the main thread, computes the profile + Fresnel clearance
 * + link budget, and hands the result to `onProfile`. Markers persist until the
 * caller clears them (panel close / ESC).
 *
 * @param {maplibregl.Map} map
 * @param {Object} opts
 * @param {() => number} opts.getFreqMHz
 * @param {() => number} opts.getTxHeight   TX antenna height AGL (m)
 * @param {() => number} opts.getRxHeight   RX antenna height AGL (m)
 * @param {() => number} opts.getThreshold  RX sensitivity / threshold (dBm)
 * @param {() => number} opts.getEirp       TX EIRP (dBm)
 * @param {(data) => void} opts.onProfile
 * @param {(msg: string) => void} [opts.onStatus]
 * @param {() => void} [opts.onDone]  fired when the tool disarms (after a run)
 */
export function createProfileTool(map, opts = {}) {
  const STEPS = 100;
  let active = false;
  let busy = false;
  const pts = [];
  const markers = [];

  function makeMarker(lngLat) {
    const el = document.createElement('div');
    el.className = 'profile-marker';
    markers.push(new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map));
  }

  function removeMarkers() {
    markers.forEach((m) => m.remove());
    markers.length = 0;
    pts.length = 0;
  }

  async function onClick(e) {
    if (busy) return;
    const ll = { lat: e.lngLat.lat, lng: e.lngLat.lng };
    pts.push(ll);
    makeMarker([ll.lng, ll.lat]);

    if (pts.length === 1) {
      opts.onStatus?.('Click the second point…');
      return;
    }

    // Second point — disarm clicks and compute (markers stay).
    map.off('click', onClick);
    active = false;
    map.getCanvas().style.cursor = '';
    busy = true;
    opts.onStatus?.('Building path profile…');
    try {
      const data = await computeProfile(pts[0], pts[1], opts, STEPS);
      opts.onProfile?.(data);
      opts.onStatus?.(data.obstructed ? 'Path obstructed — see profile' : 'Path profile ready');
    } catch (err) {
      opts.onStatus?.(`Profile failed: ${err.message}`);
      removeMarkers();
    } finally {
      busy = false;
      opts.onDone?.();
    }
  }

  function activate() {
    if (active) return;
    active = true;
    map.getCanvas().style.cursor = 'crosshair';
    opts.onStatus?.('Click the first point…');
    map.on('click', onClick);
  }

  function deactivate() {
    if (!active) return;
    active = false;
    map.off('click', onClick);
    map.getCanvas().style.cursor = '';
  }

  return {
    activate,
    deactivate,
    removeMarkers,
    isActive: () => active,
    hasMarkers: () => markers.length > 0,
  };
}

/** Fetch terrain + assemble the profile / clearance / budget data object. */
async function computeProfile(a, b, opts, steps) {
  const freqMHz = opts.getFreqMHz?.() || 155;
  const txHeight = opts.getTxHeight?.() ?? 10;
  const rxHeight = opts.getRxHeight?.() ?? 1.5;
  const rxThreshDbm = opts.getThreshold?.() ?? -110;
  const txEirpDbm = opts.getEirp?.() ?? 33;

  const dem = await fetchDemProfile(a, b, steps);
  if (!dem) throw new Error('no terrain tiles for this area');

  const { distances, elevations, distanceKm, distanceM } = buildPathProfile(a, b, steps, dem);
  const txElev = elevations[0] + txHeight;
  const rxElev = elevations[elevations.length - 1] + rxHeight;

  const { clearances, minClearance, minClearanceIdx, obstructed } = fresnelClearance(
    elevations, distances, distanceM, txElev, rxElev, freqMHz,
  );

  // Diffraction from the same Deygout knife-edge the coverage engine uses.
  const profile = distances.map((d, i) => ({ d, h: elevations[i] }));
  const diffractionDb = deygoutLossDb(profile, txElev, rxElev, freqMHz, distanceM);

  const budget = linkBudget({ distanceM, freqMHz, txEirpDbm, rxThreshDbm, diffractionDb });

  return {
    distances, elevations, clearances,
    txElev, rxElev, distanceKm, distanceM,
    minClearance, minClearanceIdx, obstructed,
    budget, freqMHz,
  };
}
