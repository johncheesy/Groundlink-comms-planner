/**
 * M38 — Satellite communications (SATCOM) horizon calculator.
 *
 * Pure-JS, no external API. Computes GEO satellite look angles (elevation +
 * azimuth) from an observer position. Uses the standard spherical-Earth
 * formula (adequate for planning; does not account for atmospheric refraction
 * or oblateness — error <0.5° at elevations > 5°).
 *
 * Nomenclature
 *   γ    = geocentric angle between sub-satellite point and observer
 *   E    = elevation angle (degrees above horizon; negative = below horizon)
 *   Az   = azimuth from North (degrees, 0–360)
 *   R_e  = Earth mean radius (6371 km)
 *   h    = GEO orbital altitude (35786 km)
 */

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const Re = 6371;           // km
const GEO_ALT = 35786;     // km
const R_RATIO = Re / (Re + GEO_ALT); // ≈ 0.15127 — used in elevation formula

// ── GEO satellite catalogue (field-relevant only) ──────────────────────────
// lon: sub-satellite longitude (E positive, W negative)
export const GEO_SATS = [
  // Iridium Certus / Iridium NEXT (GEO gateway feeder — not the actual handheld L-band; listed for awareness)
  // True Iridium handhelds use the LEO constellation — see LEO_SYSTEMS below.

  // Inmarsat (L-band / Ka-band)
  { id: 'i4f1',  label: 'Inmarsat 4-F1',      lon:  143.5, network: 'Inmarsat',  band: 'L' },
  { id: 'i4f2',  label: 'Inmarsat 4-F2',      lon:   25.0, network: 'Inmarsat',  band: 'L' },
  { id: 'i4f3',  label: 'Inmarsat 4-F3',      lon:  -97.6, network: 'Inmarsat',  band: 'L' },
  { id: 'igx5',  label: 'Inmarsat GX5 (I-6F2)', lon:  11.0, network: 'Inmarsat GX', band: 'Ka' },
  { id: 'i6f1',  label: 'Inmarsat I-6 F1',    lon:   63.0, network: 'Inmarsat GX', band: 'Ka' },

  // Thuraya (L-band, Middle East / Africa / Europe / Asia)
  { id: 'th2',   label: 'Thuraya 2',           lon:   44.0, network: 'Thuraya',   band: 'L' },
  { id: 'th3',   label: 'Thuraya 3',           lon:   98.5, network: 'Thuraya',   band: 'L' },

  // VSAT Ka-band (general)
  { id: 'ses4',  label: 'SES-4 (VSAT)',        lon:   22.0, network: 'SES',       band: 'Ka/C' },
  { id: 'ses6',  label: 'SES-6 (VSAT)',        lon:  -40.5, network: 'SES',       band: 'Ka/C' },
  { id: 'astra2g', label: 'Astra 2G (VSAT)',   lon:   28.2, network: 'SES Astra', band: 'Ka' },

  // Eutelsat / KONNECT
  { id: 'eu36b', label: 'Eutelsat 36B',        lon:   36.0, network: 'Eutelsat',  band: 'Ku' },
  { id: 'konnect', label: 'Konnect (VHTS)',    lon:   7.0,  network: 'Eutelsat',  band: 'Ka' },
];

// ── LEO / MEO systems ──────────────────────────────────────────────────────
// Look angles are not fixed — pass prediction requires TLE data.
// For planning purposes we note coverage characteristics.
export const LEO_SYSTEMS = [
  {
    id: 'iridium',
    tle: { group: 'iridium-NEXT' },   // M48: CelesTrak group for live pass window
    label: 'Iridium',
    constellation: 'LEO',
    altKm: 780,
    coverage: 'Global (incl. poles)',
    bands: 'L',
    note: '66 active satellites — minimum 1 always visible anywhere',
    planningStatus: 'available', // always green
  },
  {
    id: 'starlink',
    tle: null, // M48: ~7,000 element sets and always many in view — a count is not a planning signal
    label: 'Starlink',
    constellation: 'LEO',
    altKm: 550,
    coverage: 'Global (check local licensing)',
    bands: 'Ku/Ka',
    note: 'Business/Portable and Maritime tiers; check licensing for your region',
    planningStatus: 'check',    // amber — licensing varies
  },
  {
    id: 'globalstar',
    tle: { group: 'globalstar' },
    label: 'Globalstar',
    constellation: 'LEO',
    altKm: 1414,
    coverage: 'Partial — mid-latitudes (±70°)',
    bands: 'L',
    note: '24 satellites; polar gaps; voice/data/SPOT messenger',
    planningStatus: 'check',
  },
  {
    id: 'o3b',
    tle: { group: 'ses', match: '^O3B' },   // O3b sets live inside CelesTrak's SES group
    label: 'O3b / SES mPOWER',
    constellation: 'MEO',
    altKm: 8062,
    coverage: 'Equatorial (±45° lat)',
    bands: 'Ka',
    note: 'High throughput, low latency; limited to lower latitudes',
    planningStatus: 'check',
  },
];

/**
 * Compute GEO elevation and azimuth from an observer location.
 *
 * @param {number} obsLat  Observer latitude  (degrees, N positive)
 * @param {number} obsLng  Observer longitude (degrees, E positive)
 * @param {number} satLon  Sub-satellite longitude (degrees, E positive)
 * @returns {{ elevation: number, azimuth: number }}
 */
export function geoLookAngle(obsLat, obsLng, satLon) {
  const φ  = obsLat  * DEG;                // observer lat (rad)
  const Δλ = (satLon - obsLng) * DEG;     // lon difference (rad)

  // Geocentric angle γ: cos(γ) = cos(φ)·cos(Δλ)   (GEO is equatorial, lat=0)
  const cosGamma = Math.cos(φ) * Math.cos(Δλ);
  const sinGamma = Math.sqrt(1 - cosGamma * cosGamma);

  // Elevation (Soop 1983 / ITU-R BO.1408 simplified spherical)
  // E = atan( (cos(γ) − R_e/(R_e+h)) / sin(γ) )
  const elevation = sinGamma < 1e-9
    ? 90                                   // observer is directly under satellite
    : Math.atan2(cosGamma - R_RATIO, sinGamma) * RAD;

  // Azimuth from North (0–360°)
  // Az = atan2( tan(Δλ), sin(φ) ) + 180°  (for observer in Northern Hemisphere)
  // In Southern Hemisphere drop the +180°.
  let az = Math.atan2(Math.tan(Δλ), Math.sin(φ)) * RAD;
  if (obsLat >= 0) az += 180;
  const azimuth = ((az % 360) + 360) % 360;

  return { elevation, azimuth };
}

/**
 * Planning quality thresholds for GEO elevation:
 *   > 20°  — good (low rain-fade risk, minimal multipath)
 *   5–20°  — marginal (increased fade, terrain/vegetation masking likely)
 *   0–5°   — poor (horizon effects, rain fade severe)
 *   < 0°   — below horizon (satellite not visible)
 */
export function elevationStatus(elev) {
  if (elev >= 20) return 'ok';
  if (elev >=  5) return 'warn';
  if (elev >=  0) return 'marginal';
  return 'below';
}

/**
 * Return the best GEO satellite for a given observer position.
 * "Best" = highest elevation among visible sats.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {object|null}
 */
export function bestGeoSat(lat, lng) {
  let best = null;
  for (const sat of GEO_SATS) {
    const { elevation, azimuth } = geoLookAngle(lat, lng, sat.lon);
    if (elevation > (best?.elevation ?? -Infinity)) {
      best = { ...sat, elevation, azimuth };
    }
  }
  return best;
}

/**
 * Full satcom assessment for a mission centroid.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {{
 *   geo: Array<{id,label,lon,network,band,elevation,azimuth,status}>,
 *   leo: Array,
 *   bestGeo: object|null,
 * }}
 */
export function satcomAssessment(lat, lng) {
  const geo = GEO_SATS
    .map((sat) => {
      const { elevation, azimuth } = geoLookAngle(lat, lng, sat.lon);
      return { ...sat, elevation, azimuth, status: elevationStatus(elevation) };
    })
    .filter((s) => s.elevation > -10)      // drop satellites well below horizon
    .sort((a, b) => b.elevation - a.elevation);

  return {
    geo,
    leo: LEO_SYSTEMS,
    bestGeo: geo.find((s) => s.elevation >= 0) ?? null,
  };
}
