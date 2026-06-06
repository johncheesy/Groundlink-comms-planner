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

// Approximate a bbox of `radiusKm` around a point (for relay coverage with no AOI).
function bboxAround(lng, lat, radiusKm) {
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  return { west: lng - dLng, south: lat - dLat, east: lng + dLng, north: lat + dLat };
}

export function createDroneController(map, { coverage, getAoi, coverageParams, onState } = {}) {
  let placing = false;
  let drone = null; // { lng, lat, altM, marker }
  let busy = false;

  function emit() {
    onState?.({
      hasDrone: !!drone,
      altM: drone?.altM ?? null,
      pace: drone ? 'Airborne = Alternate' : null,
    });
  }

  function armPlacement(on = true) {
    placing = on;
    map.getCanvas().style.cursor = on ? 'crosshair' : '';
  }

  function onMapClick(e) {
    if (!placing) return;
    placeDrone([e.lngLat.lng, e.lngLat.lat]);
    armPlacement(false);
  }
  map.on('click', onMapClick);

  function placeDrone(lngLat) {
    if (drone?.marker) drone.marker.remove();
    const el = document.createElement('div');
    el.className = 'drone-marker';
    el.innerHTML = DRONE_SVG;
    const marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(lngLat).addTo(map);
    drone = { lng: lngLat[0], lat: lngLat[1], altM: drone?.altM ?? 120, marker };
    marker.on('dragend', () => {
      const p = marker.getLngLat();
      drone.lng = p.lng;
      drone.lat = p.lat;
    });
    emit();
  }

  function setAltitude(m) {
    if (!drone) return;
    drone.altM = m;
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

  function clear() {
    drone?.marker?.remove();
    drone = null;
    armPlacement(false);
    emit();
  }

  return {
    armPlacement,
    isPlacing: () => placing,
    hasDrone: () => !!drone,
    getAltitude: () => drone?.altM ?? null,
    setAltitude,
    computeRelay,
    clear,
    destroy() {
      map.off('click', onMapClick);
      clear();
    },
  };
}
