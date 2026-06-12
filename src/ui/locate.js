/**
 * M23 §3 — "Show my location" control for the right map rail.
 *
 * Click: geolocate once, fly the map there, drop a pulsing accent dot, then
 * keep the dot tracking via watchPosition while permission stands. Click
 * again to stop the watch and remove the dot. Errors (denied, no fix,
 * insecure context) surface as a toast.
 *
 * Privacy: the fix drives the map fly-to and the marker only — it is never
 * stored, logged or sent anywhere (OPSEC constraint).
 */
import maplibregl from 'maplibre-gl';

export function createLocateControl(map, { button, onError, onStatus } = {}) {
  let marker = null;
  let watchId = null;
  let active = false;

  function reflect() {
    button?.classList.toggle('is-active', active);
    button?.setAttribute('aria-pressed', String(active));
  }

  function placeMarker(lng, lat) {
    if (marker) {
      marker.setLngLat([lng, lat]);
      return;
    }
    const el = document.createElement('div');
    el.className = 'locate-dot';
    el.setAttribute('aria-hidden', 'true');
    marker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
  }

  function stop() {
    if (watchId != null) {
      navigator.geolocation?.clearWatch?.(watchId);
      watchId = null;
    }
    marker?.remove();
    marker = null;
    active = false;
    reflect();
  }

  function fail() {
    stop();
    onError?.('Location not available');
  }

  function start() {
    if (!('geolocation' in navigator)) {
      fail();
      return;
    }
    active = true;
    reflect();
    onStatus?.('Locating…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!active) return; // toggled off while waiting for the fix
        const { longitude: lng, latitude: lat } = pos.coords;
        placeMarker(lng, lat);
        map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 14), duration: 800 });
        onStatus?.('Showing your location');
        // Follow subsequent fixes (no re-fly — the user may pan away).
        watchId = navigator.geolocation.watchPosition(
          (p) => placeMarker(p.coords.longitude, p.coords.latitude),
          () => {}, // a lost watch keeps the last-known dot; no toast spam
          { enableHighAccuracy: true, maximumAge: 10_000 },
        );
      },
      fail,
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    );
  }

  button?.addEventListener('click', () => (active ? stop() : start()));

  return { stop, isActive: () => active };
}
