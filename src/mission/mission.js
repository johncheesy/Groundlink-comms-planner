/**
 * Mission model (M4) — one source of truth for what the user is planning for.
 *
 *   aoi:    null | { type, center, bounds, radiusM, ring }   // mirrors aoi.js
 *   sites:  [{ id, lat, lng, name, azimuthDeg?, txHeightM?, powerW? }] // fixed masts
 *   route:  [{ lat, lng }]             // ordered vertices, one route to start
 *   points: [{ id, lat, lng, name }]   // positions that need comms (demand)
 *   links:  [{ id, a, b, label, freqMHz? }] // radio links between two sites (M50)
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
import { LIMITS, isLatLng, clipName, decimate } from '../geo/validate.js';

const ROUTE_STEP_M = 250; // route resample spacing for demand points

export function createMission({ onChange } = {}) {
  const state = {
    aoi: null,
    sites: [],
    route: [],
    points: [],
    links: [],
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
      links: state.links.length,
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
  /**
   * Add a fixed site. Returns the site, or null when the position is not a
   * valid lat/lng or the site limit (LIMITS.sites) is reached. Callers report
   * the skip; `capacity()` says how many more fit.
   */
  function addSite(lat, lng, name = '') {
    if (!isLatLng(lat, lng) || state.sites.length >= LIMITS.sites) return null;
    const site = { id: nextId(), lat, lng, name: clipName(name) };
    state.sites.push(site);
    emit();
    return site;
  }
  function moveSite(id, lat, lng) {
    if (!isLatLng(lat, lng)) return;
    const s = state.sites.find((x) => x.id === id);
    if (s) { s.lat = lat; s.lng = lng; emit(); }
  }
  function renameSite(id, name) {
    const s = state.sites.find((x) => x.id === id);
    if (s) { s.name = clipName(name); emit(); }
  }
  /**
   * Point this site's antenna (compass degrees), or null to follow the
   * Coverage panel's pointing. The antenna type stays one setting for all.
   */
  function setSiteAzimuth(id, deg) {
    const s = state.sites.find((x) => x.id === id);
    if (!s) return;
    if (deg == null || !Number.isFinite(Number(deg))) delete s.azimuthDeg;
    else s.azimuthDeg = ((Number(deg) % 360) + 360) % 360;
    emit();
  }
  /**
   * Per-site transmitter overrides: antenna height (m above ground) and
   * conducted power (W). null clears one, so the site follows the Coverage
   * panel again.
   */
  function setSiteRf(id, { txHeightM, powerW } = {}) {
    const s = state.sites.find((x) => x.id === id);
    if (!s) return;
    setOverride(s, 'txHeightM', txHeightM, SITE_RF_LIMITS.txHeightM);
    setOverride(s, 'powerW', powerW, SITE_RF_LIMITS.powerW);
    emit();
  }
  function removeSite(id) {
    state.sites = state.sites.filter((x) => x.id !== id);
    state.links = state.links.filter((l) => l.a !== id && l.b !== id); // a link needs both ends
    emit();
  }
  function clearSites() { state.sites = []; state.links = []; emit(); }

  // ── Radio links (M50) ──────────────────────────────────────────────────
  /**
   * Link two sites (a point-to-point radio link / backhaul). Null when either
   * site is missing, both are the same, the pair is already linked (either
   * direction), or LIMITS.links is reached.
   */
  function addLink(a, b, { label = '', freqMHz = null } = {}) {
    if (a === b || state.links.length >= LIMITS.links) return null;
    if (!state.sites.some((s) => s.id === a) || !state.sites.some((s) => s.id === b)) return null;
    if (state.links.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))) return null;
    const link = { id: nextId(), a, b, label: clipName(label) };
    const f = Number(freqMHz);
    if (freqMHz != null && freqMHz !== '' && Number.isFinite(f) && f >= 1 && f <= 100000) link.freqMHz = f;
    state.links.push(link);
    emit();
    return link;
  }
  function renameLink(id, label) {
    const l = state.links.find((x) => x.id === id);
    if (!l) return;
    l.label = clipName(label);
    emit();
  }
  function removeLink(id) {
    state.links = state.links.filter((x) => x.id !== id);
    emit();
  }
  function clearLinks() { state.links = []; emit(); }

  // ── Points ─────────────────────────────────────────────────────────────
  /** Add a demand point. Null for an invalid position or at LIMITS.points. */
  function addPoint(lat, lng, name = '') {
    if (!isLatLng(lat, lng) || state.points.length >= LIMITS.points) return null;
    const pt = { id: nextId(), lat, lng, name: clipName(name) };
    state.points.push(pt);
    emit();
    return pt;
  }
  function movePoint(id, lat, lng) {
    if (!isLatLng(lat, lng)) return;
    const p = state.points.find((x) => x.id === id);
    if (p) { p.lat = lat; p.lng = lng; emit(); }
  }
  function renamePoint(id, name) {
    const p = state.points.find((x) => x.id === id);
    if (p) { p.name = clipName(name); emit(); }
  }
  function removePoint(id) {
    state.points = state.points.filter((x) => x.id !== id);
    emit();
  }
  function clearPoints() { state.points = []; emit(); }

  // ── Route (one ordered polyline) ───────────────────────────────────────
  /**
   * Set the route. Invalid vertices are dropped and a very long track (a GPS
   * log has tens of thousands of points) is thinned to LIMITS.routeVertices,
   * keeping its shape and both ends. Returns { kept, dropped, thinned }.
   */
  function setRoute(vertices) {
    const input = Array.isArray(vertices) ? vertices : [];
    const valid = input.filter((v) => isLatLng(v?.lat, v?.lng));
    const kept = decimate(valid, LIMITS.routeVertices);
    state.route = kept.map((v) => ({ lat: v.lat, lng: v.lng }));
    emit();
    return { kept: kept.length, dropped: input.length - valid.length, thinned: valid.length - kept.length };
  }
  function addRouteVertex(lat, lng) {
    if (!isLatLng(lat, lng) || state.route.length >= LIMITS.routeVertices) return;
    state.route.push({ lat, lng });
    emit();
  }
  function updateRouteVertex(i, lat, lng) {
    if (state.route[i] && isLatLng(lat, lng)) { state.route[i] = { lat, lng }; emit(); }
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
    state.links = [];
    emit();
  }

  /** How many more of each object fit before the limits in geo/validate.js. */
  function capacity() {
    return { sites: LIMITS.sites - state.sites.length, points: LIMITS.points - state.points.length };
  }

  return {
    state,
    summary,
    capacity,
    setAoi,
    addSite, moveSite, renameSite, setSiteAzimuth, setSiteRf, removeSite, clearSites,
    addLink, renameLink, removeLink, clearLinks,
    addPoint, movePoint, renamePoint, removePoint, clearPoints,
    setRoute, addRouteVertex, updateRouteVertex, removeRouteVertex, clearRoute,
    demandPoints,
    lockedSites,
    bbox,
    clearAll,
    getSites: () => state.sites.map((s) => ({ ...s })),
    getPoints: () => state.points.map((p) => ({ ...p })),
    getLinks: () => state.links.map((l) => ({ ...l })),
    getRoute: () => state.route.map((v) => ({ ...v })),
    getAoi: () => state.aoi,
  };
}

/** Valid ranges for per-site overrides (same as the Coverage panel inputs). */
export const SITE_RF_LIMITS = Object.freeze({ txHeightM: [1, 300], powerW: [0.01, 100] });

function setOverride(site, key, value, [lo, hi]) {
  if (value === undefined) return; // not part of this change
  const n = value === null || value === '' ? NaN : Number(value);
  if (!Number.isFinite(n)) delete site[key];
  else site[key] = Math.min(hi, Math.max(lo, n));
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
