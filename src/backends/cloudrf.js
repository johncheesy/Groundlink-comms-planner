/**
 * Optional CloudRF API backend (M18).
 *
 * CloudRF (https://cloudrf.com) runs a hosted ITM / ITWOM propagation engine
 * with SRTM terrain + landcover clutter — a higher-fidelity alternative to the
 * built-in FSPL+Deygout model. It is OFF by default; the user supplies their own
 * API key at runtime (sessionStorage only, never committed — see CLAUDE.md OPSEC).
 *
 * We POST to the Area API v2 (https://api.cloudrf.com/area), which renders a
 * coverage PNG in WGS84 (plate-carrée) that drops straight into a MapLibre image
 * source aligned to the AOI bbox. On any auth/transport failure we return null so
 * the caller transparently falls back to the built-in engine.
 *
 * Docs: https://cloudrf.com/documentation/developer/  (Area API v2)
 */

const AREA_URL = 'https://api.cloudrf.com/area';
const PING_URL = 'https://api.cloudrf.com/area'; // GET probe for key validation

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/**
 * Validate an API key against CloudRF without running a full coverage job.
 * A bare GET to /area with the key returns 200/405 for a good key and 401/403
 * for a bad one — we only care about the auth class, not the body.
 *
 * @param {string} apiKey
 * @returns {Promise<boolean>} true when the key authenticates
 */
export async function testCloudRFKey(apiKey) {
  const key = (apiKey || '').trim();
  if (!key) return false;
  try {
    const res = await fetch(PING_URL, {
      method: 'GET',
      headers: { Authorization: key },
    });
    // 401/403 → bad key. Anything else (200, 405 Method Not Allowed, 400 Bad
    // Request) means the key was accepted and the request reached the engine.
    return res.status !== 401 && res.status !== 403;
  } catch {
    return false;
  }
}

/**
 * Build the CloudRF Area API v2 request body from our tx + radio + bounds.
 * Geometry: tx at the centre, radius sized to reach the far corner of `bounds`.
 */
function buildBody(bounds, tx, radio) {
  const midLat = (bounds.north + bounds.south) / 2;
  // Far-corner distance from the tx, in km, so the rendered disc covers the AOI.
  const dLatKm = Math.max(
    Math.abs(bounds.north - tx.lat),
    Math.abs(tx.lat - bounds.south),
  ) * 111.32;
  const dLngKm = Math.max(
    Math.abs(bounds.east - tx.lng),
    Math.abs(tx.lng - bounds.west),
  ) * 111.32 * Math.cos((midLat * Math.PI) / 180);
  const radiusKm = Math.max(1, Math.hypot(dLatKm, dLngKm));

  const freqMHz = num(radio?.freqMHz ?? radio?.defaultFreqMHz, 150);
  const powerW = num(radio?.powerW, 5);
  const txHeightM = num(tx.txHeightM ?? radio?.txHeightM, 10);
  const rxHeightM = num(radio?.rxHeightM, 2);
  const rxSensDbm = num(radio?.rxSensDbm, -110);
  const txGainDbi = num(radio?.txGainDbi, 2.15);

  return {
    site: 'GroundLink',
    network: 'GroundLink',
    transmitter: {
      lat: tx.lat,
      lon: tx.lng,
      alt: txHeightM,
      frq: freqMHz,
      txw: powerW,
      bwi: num(radio?.bandwidthMHz, 0.025), // channel bandwidth, MHz
    },
    receiver: {
      lat: 0,
      lon: 0,
      alt: rxHeightM,
      rxg: 0, // rx antenna gain, dBi
      rxs: rxSensDbm, // sensitivity / required signal, dBm
    },
    antenna: {
      txg: txGainDbi,
      txl: 0, // feeder loss, dB
      ant: 1, // 1 = omni-directional template
      azi: 0,
      tlt: 0,
      hbw: 0,
      vbw: 0,
      fbr: 0,
      pol: 'v',
    },
    model: {
      pm: 1, // 1 = ITM / Longley-Rice
      pe: 2, // propagation environment: average terrain
      ked: 1, // knife-edge diffraction on
      rel: 90, // reliability, %
      rcs: 0,
    },
    environment: {
      elevation: 1, // use terrain DEM
      landcover: 1, // use landcover clutter
      buildings: 0,
      obstacles: 0,
      clt: 'Minimal.clt',
    },
    output: {
      units: 'metric',
      col: 'RAINBOW.dBm',
      out: 2, // 2 = received power (dBm)
      ber: 0,
      mod: 0,
      nf: -120,
      res: 30, // metres per pixel
      rad: radiusKm,
    },
  };
}

/**
 * Run a coverage area job through CloudRF.
 *
 * @param {object}   opts
 * @param {string}   opts.apiKey      user-entered CloudRF key
 * @param {{north,south,east,west}} opts.bounds  AOI bbox to cover
 * @param {{lat,lng,txHeightM?}}    opts.tx      transmitter position
 * @param {object}   opts.radio      link params (freqMHz, powerW, rxSensDbm, …)
 * @param {(frac:number, phase:string)=>void} [opts.onProgress]
 * @returns {Promise<{imageUrl:string, bounds:{north,south,east,west}, stats:object}|null>}
 *          null on any auth (401/403) or transport failure — caller falls back.
 */
export async function runCloudRFCoverage({ apiKey, bounds, tx, radio, onProgress }) {
  const key = (apiKey || '').trim();
  if (!key || !bounds || !tx) return null;
  onProgress?.(0, 'cloudrf');
  let res;
  try {
    res = await fetch(AREA_URL, {
      method: 'POST',
      headers: {
        Authorization: key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildBody(bounds, tx, radio)),
    });
  } catch {
    return null; // network / CORS error
  }
  // Auth failure → fall back to the built-in engine silently.
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) return null;
  onProgress?.(0.7, 'cloudrf');

  let data;
  try {
    data = await res.json();
  } catch {
    return null;
  }

  // The Area API returns a WGS84 (plate-carrée) PNG that aligns to a lat/lon
  // bbox, plus that bbox as [north, east, south, west]. Field names have varied
  // across API revisions, so accept the common spellings.
  const imageUrl =
    data.PNG_WGS84 || data.png_wgs84 || data.PNG_Mercator || data.png_mercator || data.image || null;
  if (!imageUrl) return null;

  const b = data.bounds || data.Bounds;
  const outBounds = Array.isArray(b) && b.length >= 4
    ? { north: num(b[0]), east: num(b[1]), south: num(b[2]), west: num(b[3]) }
    : bounds;

  onProgress?.(1, 'cloudrf');
  return {
    imageUrl,
    bounds: outBounds,
    stats: {
      engine: 'CloudRF ITM',
      area: num(data.area ?? data.kmz_area, null),
      raw: data,
    },
  };
}
