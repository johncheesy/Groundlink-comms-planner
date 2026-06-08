/**
 * Mission model (M4) — one source of truth for what the user is planning for.
 *
 *   aoi:    null | { type, center, bounds, radiusM, ring }   // mirrors aoi.js
 *   sites:  [{ id, lat, lng, name }]   // fixed masts / repeaters (infrastructure)
 *   route:  [{ lat, lng }]             // ordered vertices, one route to start
 *   points: [{ id, lat, lng, name }]   // positions that need comms (demand)
 *
 * Pure + DOM-free so it is unit-testable and importable from a worker. The map
 * markers and interactions live in the mission-tools controller, which drives
 * this model through its setters. Emits onChange(summary) for the panel + bar.
 *
 * demandPoints() is the single demand input for coverage/recommendation: the
 * AOI grid (M3 logic) + the route resampled every ~250 m + the explicit points.
 */
import { haversineM } from '../coverage/model.js';
import { demandGrid, bboxOfPoints } from '../geo/aoi-mask.js';

const ROUTE_STEP_M = 250; // route resample spacing for demand points

export function createMission({ onChange } = {}) {
  const state = {
    aoi: null,
    sites: [],
    route: [],
    points: [],
  };
  let seq = 0;
  const nextId = () => `m${++seq}`;

  function summary() {
    return {
      hasAoi: !!state.aoi,
      aoiType: state.aoi?.type ?? null,
      sites: state.sites.length,
      route: state.route.length,
      points: state.points.length,
      // A mission is "active" once any element exists.
      isEmpty: !state.aoi && !state.sites.length && state.route.length < 2 && !state.points.length,
    };
  }
  const emit = () => onChange?.(summary());

  // ── AOI (mirrored from aoi.js) ─────────────────────────────────────────
  function setAoi(aoi) {
    state.aoi = aoi || null;
    emit();
  }

  // ── Sites ──────────────────────────────────────────────────────────────
  function addSite(lat, lng, name = '') {
    const site = { id: nextId(), lat, lng, name };
    state.sites.push(site);
    emit();
    return site;
  }
  function moveSite(id, lat, lng) {
    const s = state.sites.find((x) => x.id === id);
    if (s) { s.lat = lat; s.lng = lng; emit(); }
  }
  function renameSite(id, name) {
    const s = state.sites.find((x) => x.id === id);
    if (s) { s.name = name; emit(); }
  }
  function removeSite(id) {
    state.sites = state.sites.filter((x) => x.id !== id);
    emit();
  }
  function clearSites() { state.sites = []; emit(); }

  // ── Points ─────────────────────────────────────────────────────────────
  function addPoint(lat, lng, name = '') {
    const pt = { id: nextId(), lat, lng, name };
    state.points.push(pt);
    emit();
    return pt;
  }
  function movePoint(id, lat, lng) {
    const p = state.points.find((x) => x.id === id);
    if (p) { p.lat = lat; p.lng = lng; emit(); }
  }
  function renamePoint(id, name) {
    const p = state.points.find((x) => x.id === id);
    if (p) { p.name = name; emit(); }
  }
  function removePoint(id) {
    state.points = state.points.filter((x) => x.id !== id);
    emit();
  }
  function clearPoints() { state.points = []; emit(); }

  // ── Route (one ordered polyline) ───────────────────────────────────────
  function setRoute(vertices) {
    state.route = (vertices || []).map((v) => ({ lat: v.lat, lng: v.lng }));
    emit();
  }
  function addRouteVertex(lat, lng) {
    state.route.push({ lat, lng });
    emit();
  }
  function updateRouteVertex(i, lat, lng) {
    if (state.route[i]) { state.route[i] = { lat, lng }; emit(); }
  }
  function removeRouteVertex(i) {
    if (i >= 0 && i < state.route.length) { state.route.splice(i, 1); emit(); }
  }
  function clearRoute() { state.route = []; emit(); }

  // ── Demand ─────────────────────────────────────────────────────────────
  /**
   * Merge every demand source into one [{ lat, lng }] list:
   *   • AOI  → masked grid (M3 sizing, default 28-dim cap)
   *   • route → resampled every ~250 m (vertices + interpolated)
   *   • points → as-is
   * `maxDim` caps the AOI grid resolution (used to keep huge AOIs responsive).
   */
  function demandPoints({ maxDim = 28 } = {}) {
    const out = [];
    if (state.aoi?.bounds) {
      for (const g of demandGrid(state.aoi.bounds, aoiMask(state.aoi), maxDim)) {
        out.push({ lat: g.lat, lng: g.lng });
      }
    }
    out.push(...resampleRoute(state.route, ROUTE_STEP_M));
    for (const p of state.points) out.push({ lat: p.lat, lng: p.lng });
    return out;
  }

  /** Fixed sites act as pre-placed transmitters (locked picks for M3 greedy). */
  function lockedSites() {
    return state.sites.map((s) => ({ lat: s.lat, lng: s.lng, name: s.name || '' }));
  }

  /** Bounding box over every mission element, or null when nothing is set. */
  function bbox() {
    const pts = [];
    if (state.aoi?.ring) for (const [lng, lat] of state.aoi.ring) pts.push({ lat, lng });
    for (const s of state.sites) pts.push({ lat: s.lat, lng: s.lng });
    for (const v of state.route) pts.push({ lat: v.lat, lng: v.lng });
    for (const p of state.points) pts.push({ lat: p.lat, lng: p.lng });
    return bboxOfPoints(pts);
  }

  function clearAll() {
    state.aoi = null;
    state.sites = [];
    state.route = [];
    state.points = [];
    emit();
  }

  return {
    state,
    summary,
    setAoi,
    addSite, moveSite, renameSite, removeSite, clearSites,
    addPoint, movePoint, renamePoint, removePoint, clearPoints,
    setRoute, addRouteVertex, updateRouteVertex, removeRouteVertex, clearRoute,
    demandPoints,
    lockedSites,
    bbox,
    clearAll,
    getSites: () => state.sites.map((s) => ({ ...s })),
    getPoints: () => state.points.map((p) => ({ ...p })),
    getRoute: () => state.route.map((v) => ({ ...v })),
    getAoi: () => state.aoi,
  };
}

/** Reduce the stored AOI to the mask shape demandGrid/inAoi expect. */
function aoiMask(aoi) {
  return { type: aoi.type, center: aoi.center, radiusM: aoi.radiusM, ring: aoi.ring };
}

/**
 * Resample a polyline to ~stepM spacing. Keeps the first vertex, walks each
 * segment dropping a sample every stepM, and always keeps the final vertex.
 * Returns [] for a route of fewer than two vertices.
 */
export function resampleRoute(route, stepM = ROUTE_STEP_M) {
  if (!route || route.length < 2) {
    return route && route.length === 1 ? [{ lat: route[0].lat, lng: route[0].lng }] : [];
  }
  const out = [{ lat: route[0].lat, lng: route[0].lng }];
  let carry = 0; // distance already covered since the last emitted sample
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const segLen = haversineM(a.lat, a.lng, b.lat, b.lng);
    if (segLen === 0) continue;
    let d = stepM - carry;
    while (d < segLen) {
      const f = d / segLen;
      out.push({ lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f });
      d += stepM;
    }
    carry = (carry + segLen) % stepM;
  }
  const last = route[route.length - 1];
  const tail = out[out.length - 1];
  if (haversineM(tail.lat, tail.lng, last.lat, last.lng) > stepM * 0.25) {
    out.push({ lat: last.lat, lng: last.lng });
  }
  return out;
}
