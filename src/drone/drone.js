import maplibregl from 'maplibre-gl';

/**
 * M2.1 — Drone module (Part A: airborne relay).
 *
 * A drone is just a comms node whose antenna height is its altitude AGL, so the
 * relay coverage reuses the M2 coverage worker with txHeightM = altitude. We
 * also compute a ground baseline (txHeightM ≈ 2 m) to report the gain a drone
 * buys over a mast at the same spot, and surface PACE + payload/endurance
 * caveats so the plan stays realistic.
 *
 * Part B (flight/link envelope) is added separately.
 */

const DRONE_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="5" r="2.4"/><circle cx="19" cy="5" r="2.4"/><circle cx="5" cy="19" r="2.4"/><circle cx="19" cy="19" r="2.4"/><path d="M6.7 6.7l3 3M17.3 6.7l-3 3M6.7 17.3l3-3M17.3 17.3l-3-3"/><rect x="9.5" y="9.5" width="5" height="5" rx="1.2" fill="currentColor" stroke="none"/></svg>';

const GCS_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 20V9"/><path d="M7 20h10"/><path d="M12 9l-3.5-4h7L12 9z" fill="currentColor" stroke="none"/><path d="M5 6a10 10 0 0 1 14 0"/></svg>';

// Approximate a bbox of `radiusKm` around a point.
function bboxAround(lng, lat, radiusKm) {
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  return { west: lng - dLng, south: lat - dLat, east: lng + dLng, north: lat + dLat };
}

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
function hexToRgb(hex, fb = [70, 166, 255]) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return fb;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const ENVELOPE_BANDS = [50, 100, 120]; // m AGL (ascending → nested zones)

export function createDroneController(map, { coverage, getAoi, coverageParams, onState, registry } = {}) {
  const DRONE_REG_ID = 'drone-relay'; // singleton registry id (M19)
  let placing = null; // null | 'relay' | 'gcs'
  let drone = null; // { lng, lat, altM, marker }
  let busy = false;

  // Flight/link envelope state
  let gcs = null; // { lng, lat, marker }
  let envWorker = null;
  let envJobId = 0;
  let envLayerOn = false;
  let envBounds = null;

  // azure band palette (50→strongest, 120→lightest) + amber shadow
  const azure = hexToRgb(cssVar('--feat-track', '#46a6ff'));
  const amber = hexToRgb(cssVar('--feat-event', '#ffd479'));
  const ENV_RGBA = [
    [...azure, 150], // band 0 (50 m)
    [...azure, 105], // band 1 (100 m)
    [...azure, 70], // band 2 (120 m)
  ];
  const ENV_SHADOW_RGBA = [...amber, 90];

  function emit() {
    onState?.({
      hasDrone: !!drone,
      altM: drone?.altM ?? null,
      pace: drone ? 'Airborne = Alternate' : null,
    });
  }

  function arm(mode) {
    placing = mode; // 'relay' | 'gcs' | null
    map.getCanvas().style.cursor = mode ? 'crosshair' : '';
  }

  function onMapClick(e) {
    if (!placing) return;
    const ll = [e.lngLat.lng, e.lngLat.lat];
    if (placing === 'relay') placeDrone(ll);
    else if (placing === 'gcs') placeGcs(ll);
    arm(null);
  }
  map.on('click', onMapClick);

  function placeDrone(lngLat) {
    if (drone?.marker) drone.marker.remove();
    const el = document.createElement('div');
    el.className = 'drone-marker';
    el.innerHTML = DRONE_SVG;
    const marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(lngLat).addTo(map);
    drone = { lng: lngLat[0], lat: lngLat[1], altM: drone?.altM ?? 120, marker };
    // M19: drag is owned by the shared registry behaviour when present.
    if (!registry) {
      marker.on('dragend', () => {
        const p = marker.getLngLat();
        drone.lng = p.lng;
        drone.lat = p.lat;
      });
    }
    registry?.register({
      id: DRONE_REG_ID,
      kind: 'drone',
      owner: 'drone',
      lngLat,
      marker,
      settings: { altM: drone.altM },
      apply: {
        move: ([lng, lat]) => {
          drone.lng = lng;
          drone.lat = lat;
          marker.setLngLat([lng, lat]);
        },
        remove: () => removeDrone(),
      },
    });
    emit();
  }

  /** Remove just the relay drone (registry delete); envelope/GCS stay. */
  function removeDrone() {
    drone?.marker?.remove();
    drone = null;
    emit();
  }

  function setAltitude(m) {
    if (!drone) return;
    drone.altM = m;
    registry?.sync(DRONE_REG_ID, { settings: { altM: m } }); // RF-relevant → recompute
    emit();
  }

  function relayBounds() {
    const aoi = getAoi?.();
    if (aoi) return aoi.bounds;
    return bboxAround(drone.lng, drone.lat, 30); // default 30 km around the drone
  }

  /**
   * Compute relay coverage from the drone at altitude, plus a ground baseline,
   * and report the area gain. Returns { altFrac, groundFrac, gainPts }.
   */
  async function computeRelay() {
    if (!drone || busy) return null;
    busy = true;
    onState?.({ hasDrone: true, altM: drone.altM, pace: 'Airborne = Alternate', computing: true });
    const bounds = relayBounds();
    const base = coverageParams();
    const pos = { lng: drone.lng, lat: drone.lat };
    try {
      // ground mast baseline (no render), then the airborne relay (rendered)
      const ground = await coverage.computeAsync(bounds, pos, { ...base, txHeightM: 2 }, { render: false, marker: false });
      const alt = await coverage.computeAsync(bounds, pos, { ...base, txHeightM: drone.altM }, { render: true, marker: false });
      const result = {
        altFrac: alt.coveredFrac,
        groundFrac: ground.coveredFrac,
        gainPts: (alt.coveredFrac - ground.coveredFrac) * 100,
      };
      onState?.({ hasDrone: true, altM: drone.altM, pace: 'Airborne = Alternate', result });
      return result;
    } finally {
      busy = false;
    }
  }

  // ---- Flight / link envelope (Part B) ---------------------------------
  function placeGcs(lngLat) {
    if (gcs?.marker) gcs.marker.remove();
    const el = document.createElement('div');
    el.className = 'gcs-marker';
    el.innerHTML = GCS_SVG;
    const marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(lngLat).addTo(map);
    gcs = { lng: lngLat[0], lat: lngLat[1], marker };
    marker.on('dragend', () => {
      const p = marker.getLngLat();
      gcs.lng = p.lng;
      gcs.lat = p.lat;
    });
  }

  function ensureEnvWorker() {
    if (envWorker) return envWorker;
    envWorker = new Worker(new URL('../workers/envelope.worker.js', import.meta.url), { type: 'module' });
    envWorker.onmessage = (e) => {
      const msg = e.data;
      if (!msg || msg.id !== envJobId) return;
      if (msg.type === 'progress') onState?.({ envProgress: msg.done / msg.total });
      else if (msg.type === 'done') {
        paintEnvelope(msg);
        onState?.({ envDone: true });
      }
    };
    return envWorker;
  }

  function paintEnvelope({ classes, cols, rows }) {
    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(cols, rows);
    const data = img.data;
    for (let i = 0; i < classes.length; i++) {
      const cls = classes[i];
      const o = i * 4;
      const rgba = cls < ENV_RGBA.length ? ENV_RGBA[cls] : cls === 250 ? ENV_SHADOW_RGBA : null;
      if (!rgba) {
        data[o + 3] = 0;
        continue;
      }
      data[o] = rgba[0];
      data[o + 1] = rgba[1];
      data[o + 2] = rgba[2];
      data[o + 3] = rgba[3];
    }
    ctx.putImageData(img, 0, 0);
    const url = canvas.toDataURL('image/png');
    const b = envBounds;
    const coordinates = [
      [b.west, b.north],
      [b.east, b.north],
      [b.east, b.south],
      [b.west, b.south],
    ];
    if (envLayerOn && map.getSource('envelope')) {
      map.getSource('envelope').updateImage({ url, coordinates });
    } else {
      map.addSource('envelope', { type: 'image', url, coordinates });
      const beforeId = map.getLayer('aoi-fill') ? 'aoi-fill' : undefined;
      map.addLayer({ id: 'envelope-layer', type: 'raster', source: 'envelope', paint: { 'raster-opacity': 1, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 } }, beforeId);
      envLayerOn = true;
    }
  }

  /** Compute the fly/link envelope from the GCS. c2 = {freqMHz, eirpDbm, rxSensDbm, gcsHeightM, radiusKm}. */
  function computeEnvelope(c2) {
    if (!gcs) return;
    const w = ensureEnvWorker();
    envBounds = bboxAround(gcs.lng, gcs.lat, c2.radiusKm ?? 40);
    // grid ~200 on the long side
    const midLat = (envBounds.north + envBounds.south) / 2;
    const wdeg = (envBounds.east - envBounds.west) * Math.cos((midLat * Math.PI) / 180);
    const hdeg = envBounds.north - envBounds.south;
    const cols = wdeg >= hdeg ? 200 : Math.max(8, Math.round((200 * wdeg) / hdeg));
    const rows = wdeg >= hdeg ? Math.max(8, Math.round((200 * hdeg) / wdeg)) : 200;
    envJobId += 1;
    onState?.({ envProgress: 0 });
    w.postMessage({
      type: 'envelope',
      id: envJobId,
      bounds: envBounds,
      cols,
      rows,
      gcs: { lng: gcs.lng, lat: gcs.lat },
      gcsHeightM: c2.gcsHeightM ?? 3,
      bands: ENVELOPE_BANDS,
      freqMHz: c2.freqMHz,
      eirpDbm: c2.eirpDbm,
      rxSensDbm: c2.rxSensDbm,
    });
  }

  function clearEnvelope() {
    envJobId += 1;
    if (map.getLayer('envelope-layer')) map.removeLayer('envelope-layer');
    if (map.getSource('envelope')) map.removeSource('envelope');
    envLayerOn = false;
    gcs?.marker?.remove();
    gcs = null;
  }

  function clear() {
    clearEnvelope(); // also removes GCS marker + envelope layer
    drone?.marker?.remove();
    drone = null;
    registry?.unregister(DRONE_REG_ID);
    arm(null);
    emit();
  }

  return {
    arm,
    armPlacement: (on) => arm(on ? 'relay' : null), // back-compat
    isPlacing: () => placing,
    hasDrone: () => !!drone,
    hasGcs: () => !!gcs,
    getAltitude: () => drone?.altM ?? null,
    setAltitude,
    computeRelay,
    computeEnvelope,
    clearEnvelope,
    clear,
    destroy() {
      map.off('click', onMapClick);
      clearEnvelope();
      envWorker?.terminate();
      clear();
    },
  };
}
