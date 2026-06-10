/**
 * M19 §4 — one drag-to-move implementation for every registry marker.
 *
 * Modules register objects with a `marker` and an `apply.move` callback; this
 * module owns the drag UX: dashed leader line from the origin (existing
 * --feat-track colour), live coordinate readout, Esc-cancel (snap back), and
 * drop → registry.move → the §0 debounced recompute. Locked objects are not
 * draggable. "Move" from the context menu arms the same behaviour for the
 * next pointer-down on the marker (touch-friendly alternative).
 */

const SRC_LEADER = 'objdrag-leader';

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

const leaderFc = (coords) => ({
  type: 'FeatureCollection',
  features: coords
    ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }]
    : [],
});

export function initDragMove(map, registry, { onLiveCoord, onDrop, onStatus } = {}) {
  let active = null; // { id, origin: {lng,lat}, cancelled }

  function ensureLeaderLayer() {
    if (map.getSource(SRC_LEADER)) return;
    map.addSource(SRC_LEADER, { type: 'geojson', data: leaderFc(null) });
    map.addLayer({
      id: SRC_LEADER,
      type: 'line',
      source: SRC_LEADER,
      layout: { 'line-cap': 'round' },
      paint: {
        'line-color': cssVar('--feat-track', '#46a6ff'),
        'line-width': 1.5,
        'line-dasharray': [2, 2],
        'line-opacity': 0.9,
      },
    });
  }

  const setLeader = (coords) => map.getSource(SRC_LEADER)?.setData(leaderFc(coords));

  function onKey(e) {
    if (e.key === 'Escape' && active) {
      active.cancelled = true;
      const entry = registry.get(active.id);
      entry?.marker?.setLngLat([active.origin.lng, active.origin.lat]);
      setLeader(null);
      onStatus?.('Move cancelled');
    }
  }

  function attach(entry) {
    const m = entry.marker;
    if (!m || m.__glDragWired) return;
    m.__glDragWired = true;
    m.setDraggable?.(!entry.locked);

    m.on('dragstart', () => {
      const e = registry.get(entry.id);
      if (!e) return;
      active = { id: e.id, origin: m.getLngLat(), cancelled: false };
      ensureLeaderLayer();
      document.addEventListener('keydown', onKey, true);
      m.getElement()?.classList.add('is-dragging');
    });

    m.on('drag', () => {
      if (!active || active.cancelled) return;
      const p = m.getLngLat();
      setLeader([[active.origin.lng, active.origin.lat], [p.lng, p.lat]]);
      onLiveCoord?.({ lat: p.lat, lng: p.lng });
    });

    m.on('dragend', () => {
      document.removeEventListener('keydown', onKey, true);
      m.getElement()?.classList.remove('is-dragging');
      setLeader(null);
      if (!active) return;
      const { origin, cancelled, id } = active;
      active = null;
      if (cancelled) {
        m.setLngLat([origin.lng, origin.lat]);
        return;
      }
      const p = m.getLngLat();
      const moved = registry.move(id, [p.lng, p.lat]);
      if (!moved) m.setLngLat([origin.lng, origin.lat]); // locked → snap back
      else onDrop?.(registry.get(id));
    });
  }

  // Wire markers as objects register (covers refresh() re-registers too).
  document.addEventListener('objects:changed', (ev) => {
    const { type, id } = ev.detail || {};
    if (type !== 'add' && type !== 'update') return;
    const entry = registry.get(id);
    if (entry) attach(entry);
  });
  for (const entry of registry.all()) attach(entry);

  /**
   * Context-menu "Move" (touch alternative): the next pointer-down on the
   * marker starts a normal drag — we just make sure it is draggable and hint.
   */
  function armMove(id) {
    const entry = registry.get(id);
    if (!entry || entry.locked || !entry.marker) return;
    attach(entry);
    entry.marker.getElement()?.classList.add('is-move-armed');
    onStatus?.(`Drag ${entry.name} to its new position · Esc cancels`);
    const disarm = () => entry.marker.getElement()?.classList.remove('is-move-armed');
    entry.marker.once?.('dragend', disarm);
    setTimeout(disarm, 8000); // hint times out quietly
  }

  return { armMove };
}
