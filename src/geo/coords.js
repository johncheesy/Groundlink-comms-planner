/**
 * Coordinate parsing + formatting — decimal lat/long, DMS, MGRS and UTM.
 *
 * Pure, dependency-light, DOM-free (so it is unit-testable and worker-safe).
 * MGRS uses the `mgrs` npm package (the proj4js extract, ~5 kB) — the one
 * justified new dependency. UTM is a self-contained transverse-Mercator
 * conversion (Snyder / USGS Professional Paper 1395 series, WGS-84), good to a
 * few millimetres across a zone — far beyond planning-grade need.
 *
 *   parseCoordinate(text) -> { lat, lng, fmt } | null
 *   formatCoordinate({lat,lng}, fmt) -> string
 *
 * `fmt` is one of 'latlng' | 'dms' | 'mgrs' | 'utm' and records which form the
 * text was recognised as, so the UI can echo a readout back in the same family.
 */

import { forward as mgrsForward, toPoint as mgrsToPoint } from 'mgrs';

// ── WGS-84 ellipsoid constants ───────────────────────────────────────────────
const A = 6378137.0; // semi-major axis (m)
const F = 1 / 298.257223563; // flattening
const E2 = F * (2 - F); // first eccentricity squared
const EP2 = E2 / (1 - E2); // second eccentricity squared
const K0 = 0.9996; // UTM scale factor on the central meridian

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// MGRS / UTM latitude bands, south (C) → north (X); I and O are skipped.
const LAT_BANDS = 'CDEFGHJKLMNPQRSTUVWXX';

/** UTM/MGRS latitude band letter for a latitude in [-80, 84). */
export function utmBand(lat) {
  if (lat < -80 || lat >= 84) return 'Z'; // outside UTM — polar (UPS), unused here
  return LAT_BANDS.charAt(Math.floor((lat + 80) / 8));
}

// ─────────────────────────────────────────────────────────────────────────────
// UTM ⇄ geographic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Geographic → UTM. Returns { zone, band, hemisphere, easting, northing }.
 * Hemisphere is derived from latitude; band from the standard 8° bands.
 */
export function latLngToUtm(lat, lng, forceZone) {
  const zone = forceZone || Math.floor((lng + 180) / 6) + 1;
  const lon0 = rad(zone * 6 - 183); // central meridian of the zone
  const phi = rad(lat);
  const lam = rad(lng);

  const N = A / Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = EP2 * Math.cos(phi) ** 2;
  const Aa = Math.cos(phi) * (lam - lon0);

  const M =
    A *
    ((1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256) * phi -
      ((3 * E2) / 8 + (3 * E2 ** 2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * phi) +
      ((15 * E2 ** 2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * E2 ** 3) / 3072) * Math.sin(6 * phi));

  const easting =
    K0 *
      N *
      (Aa +
        ((1 - T + C) * Aa ** 3) / 6 +
        ((5 - 18 * T + T ** 2 + 72 * C - 58 * EP2) * Aa ** 5) / 120) +
    500000;

  let northing =
    K0 *
    (M +
      N *
        Math.tan(phi) *
        (Aa ** 2 / 2 +
          ((5 - T + 9 * C + 4 * C ** 2) * Aa ** 4) / 24 +
          ((61 - 58 * T + T ** 2 + 600 * C - 330 * EP2) * Aa ** 6) / 720));

  if (lat < 0) northing += 10000000; // false northing in the southern hemisphere

  return {
    zone,
    band: utmBand(lat),
    hemisphere: lat < 0 ? 'S' : 'N',
    easting,
    northing,
  };
}

/**
 * UTM → geographic. `north` is a boolean (true = northern hemisphere).
 * Returns { lat, lng }.
 */
export function utmToLatLng(zone, easting, northing, north) {
  const x = easting - 500000;
  const y = north ? northing : northing - 10000000;

  const M = y / K0;
  const mu = M / (A * (1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256));

  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

  const C1 = EP2 * Math.cos(phi1) ** 2;
  const T1 = Math.tan(phi1) ** 2;
  const N1 = A / Math.sqrt(1 - E2 * Math.sin(phi1) ** 2);
  const R1 = (A * (1 - E2)) / (1 - E2 * Math.sin(phi1) ** 2) ** 1.5;
  const D = x / (N1 * K0);

  const lat =
    phi1 -
    ((N1 * Math.tan(phi1)) / R1) *
      (D ** 2 / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * EP2) * D ** 4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * EP2 - 3 * C1 ** 2) * D ** 6) / 720);

  const lon0 = rad(zone * 6 - 183);
  const lng =
    lon0 +
    (D -
      ((1 + 2 * T1 + C1) * D ** 3) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * EP2 + 24 * T1 ** 2) * D ** 5) / 120) /
      Math.cos(phi1);

  return { lat: deg(lat), lng: deg(lng) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsing
// ─────────────────────────────────────────────────────────────────────────────

// Decimal "52.3676, 4.9041" | "52.3676 4.9041" | "-1.95 30.06" | "52.36N 4.90E".
const DEC_RE =
  /^\s*(-?\d{1,2}(?:\.\d+)?)\s*°?\s*([NSns])?\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EWew])?\s*$/;

// One DMS component, hemisphere-terminated: 52°22'03"N · 52 22 03 N · 52:22:3.5N
const DMS_PART = String.raw`(\d{1,3})\s*[°:\s]\s*(\d{1,2})\s*(?:['′:\s]\s*(\d{1,2}(?:\.\d+)?)\s*["″]?)?\s*([NSEWnsew])`;
const DMS_RE = new RegExp(`^\\s*${DMS_PART}[,\\s]+${DMS_PART}\\s*$`);

// MGRS: zone(1-60) + band + 2-letter 100 km square + even run of digits.
const MGRS_RE = /^\s*(\d{1,2})\s*([C-HJ-NP-X])\s*([A-HJ-NP-Z])\s*([A-HJ-NP-V])\s*([\d\s]+)\s*$/i;

// UTM: zone + band + easting + northing (numeric pair). The band letter encodes
// the hemisphere (C–M south, N–X north); a bare N/S hemisphere flag is accepted.
const UTM_RE = /^\s*(\d{1,2})\s*([A-Za-z])\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*$/;

function dmsToDecimal(d, m, s, hemi) {
  let v = Number(d) + Number(m) / 60 + (s ? Number(s) : 0) / 3600;
  if (/[SWsw]/.test(hemi)) v = -v;
  return v;
}

function tryDecimal(text) {
  const m = DEC_RE.exec(text);
  if (!m) return null;
  let lat = Number(m[1]);
  let lng = Number(m[3]);
  if (/[Ss]/.test(m[2] || '')) lat = -Math.abs(lat);
  if (/[Ww]/.test(m[4] || '')) lng = -Math.abs(lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, fmt: 'latlng' };
}

function tryDms(text) {
  const m = DMS_RE.exec(text);
  if (!m) return null;
  // Group order: [d,m,s,hemi] for the first part, then the second.
  const first = { d: m[1], m: m[2], s: m[3], h: m[4] };
  const second = { d: m[5], m: m[6], s: m[7], h: m[8] };
  // Latitude is whichever part carries N/S; longitude carries E/W.
  const latPart = /[NSns]/.test(first.h) ? first : /[NSns]/.test(second.h) ? second : null;
  const lngPart = /[EWew]/.test(first.h) ? first : /[EWew]/.test(second.h) ? second : null;
  if (!latPart || !lngPart || latPart === lngPart) return null;
  const lat = dmsToDecimal(latPart.d, latPart.m, latPart.s, latPart.h);
  const lng = dmsToDecimal(lngPart.d, lngPart.m, lngPart.s, lngPart.h);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, fmt: 'dms' };
}

function tryMgrs(text) {
  const m = MGRS_RE.exec(text);
  if (!m) return null;
  const digits = m[5].replace(/\s+/g, '');
  if (digits.length === 0 || digits.length % 2 !== 0 || digits.length > 10) return null;
  const norm = `${m[1]}${m[2]}${m[3]}${m[4]}${digits}`.toUpperCase();
  try {
    const [lng, lat] = mgrsToPoint(norm); // [lng, lat], centre of the cell
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng, fmt: 'mgrs' };
  } catch {
    return null;
  }
}

function tryUtm(text) {
  const m = UTM_RE.exec(text);
  if (!m) return null;
  const zone = Number(m[1]);
  if (zone < 1 || zone > 60) return null;
  const letter = m[2].toUpperCase();
  const easting = Number(m[3]);
  const northing = Number(m[4]);
  // Plausible UTM ranges — reject what is really a decimal pair that slipped in.
  if (easting < 100000 || easting > 900000 || northing < 0 || northing > 10000000) return null;

  let north;
  if (letter === 'N') north = true;
  else if (letter === 'S') north = false;
  else if (LAT_BANDS.includes(letter)) north = letter >= 'N';
  else return null;

  const { lat, lng } = utmToLatLng(zone, easting, northing, north);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, fmt: 'utm' };
}

/**
 * Parse a single coordinate string in any supported format.
 * Detection order is most-specific first (MGRS, UTM, DMS) then decimal, so the
 * looser decimal/DMS matchers never swallow a structured grid reference.
 */
export function parseCoordinate(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  return tryMgrs(text) || tryUtm(text) || tryDms(text) || tryDecimal(text) || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatting
// ─────────────────────────────────────────────────────────────────────────────

const pad = (n, w = 2) => String(Math.trunc(n)).padStart(w, '0');

function formatLatLng({ lat, lng }) {
  return `${Math.abs(lat).toFixed(5)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lng).toFixed(5)}°${lng >= 0 ? 'E' : 'W'}`;
}

function dmsComponent(value, posHemi, negHemi) {
  const hemi = value >= 0 ? posHemi : negHemi;
  const abs = Math.abs(value);
  let d = Math.floor(abs);
  let m = Math.floor((abs - d) * 60);
  let s = Math.round((abs - d - m / 60) * 3600);
  if (s === 60) { s = 0; m += 1; }
  if (m === 60) { m = 0; d += 1; }
  return `${d}°${pad(m)}'${pad(s)}"${hemi}`;
}

function formatDms({ lat, lng }) {
  return `${dmsComponent(lat, 'N', 'S')} ${dmsComponent(lng, 'E', 'W')}`;
}

function formatUtm({ lat, lng }) {
  const u = latLngToUtm(lat, lng);
  return `${u.zone}${u.band} ${Math.round(u.easting)} ${Math.round(u.northing)}`;
}

function formatMgrs({ lat, lng }) {
  try {
    return mgrsForward([lng, lat], 5).replace(
      /^(\d{1,2}[C-X])([A-Z]{2})(\d{5})(\d{5})$/i,
      '$1 $2 $3 $4',
    );
  } catch {
    return formatLatLng({ lat, lng });
  }
}

/** Format a point in the requested family. Defaults to decimal lat/long. */
export function formatCoordinate(point, fmt = 'latlng') {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return '—';
  switch (fmt) {
    case 'dms':
      return formatDms(point);
    case 'mgrs':
      return formatMgrs(point);
    case 'utm':
      return formatUtm(point);
    case 'latlng':
    default:
      return formatLatLng(point);
  }
}

/** The status-bar readout cycle: lat/long → MGRS → UTM → (back to lat/long). */
export const COORD_CYCLE = ['latlng', 'mgrs', 'utm'];
