import 'maplibre-gl/dist/maplibre-gl.css';
import '../styles/index.css';

import { initMap, keepMapSized } from './map/map.js';
import { createAoiController } from './map/aoi.js';
import { createCoverageController } from './coverage/coverage.js';
import { createDroneController } from './drone/drone.js';
import { initThemeToggle, applyInitialTheme } from './ui/theme.js';
import { wattsToDbm } from './coverage/model.js';

const $ = (sel) => document.querySelector(sel);

// First paint follows the OS colour scheme (light default otherwise).
applyInitialTheme();

// ---- Map ----------------------------------------------------------------

const mapApi = initMap($('#map'));
const { map } = mapApi;
const resize = keepMapSized(map);

// ---- Status bar ---------------------------------------------------------

const statusCoords = $('#statusCoords');
const statusZoom = $('#statusZoom');
const statusMode = $('#statusMode');
const statusAoi = $('#statusAoi');

const fmtLat = (lat) => `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}`;
const fmtLng = (lng) => `${Math.abs(lng).toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`;

map.on('mousemove', (e) => {
  statusCoords.textContent = `${fmtLat(e.lngLat.lat)} ${fmtLng(e.lngLat.lng)}`;
});
map.getCanvasContainer().addEventListener('mouseleave', () => {
  statusCoords.textContent = '—';
});

const updateZoom = () => {
  statusZoom.textContent = map.getZoom().toFixed(1);
};
map.on('zoom', updateZoom);

// ---- Theme toggle (map canvas stays dark regardless) --------------------

initThemeToggle($('#themeToggle'), () => resize());

// ---- Zoom + 3D toolbar --------------------------------------------------

$('#zoomIn').addEventListener('click', () => map.zoomIn());
$('#zoomOut').addEventListener('click', () => map.zoomOut());

const toggle3dBtn = $('#toggle3d');
const viewSliders = $('#viewSliders');
const tiltSlider = $('#tiltSlider');
const bearingSlider = $('#bearingSlider');
const tiltVal = $('#tiltVal');
const bearingVal = $('#bearingVal');

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
const norm360 = (deg) => Math.round(((deg % 360) + 360) % 360);

function reflectViewSliders() {
  const pitch = Math.round(map.getPitch());
  const bearing = norm360(map.getBearing());
  tiltSlider.value = String(pitch);
  bearingSlider.value = String(bearing);
  tiltVal.textContent = `${pitch}°`;
  bearingVal.textContent = `${bearing}° ${compass(bearing)}`;
}

toggle3dBtn?.addEventListener('click', () => {
  const on = mapApi.toggleTerrain({ exaggeration: 1.5, pitch: 45 });
  toggle3dBtn.classList.toggle('is-active', on);
  toggle3dBtn.setAttribute('aria-pressed', String(on));
  viewSliders.hidden = !on;
  statusMode.textContent = on ? '3D terrain on' : '3D terrain off';
});

// Live slider control (instant), and keep sliders synced with drag-rotate/pitch.
tiltSlider.addEventListener('input', () => map.setPitch(Number(tiltSlider.value)));
bearingSlider.addEventListener('input', () => map.setBearing(Number(bearingSlider.value)));
map.on('pitch', reflectViewSliders);
map.on('rotate', reflectViewSliders);

// ---- Basemap switcher ---------------------------------------------------

const basemapSwitch = $('#basemapSwitch');
basemapSwitch.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-basemap]');
  if (!btn) return;
  mapApi.setBasemap(btn.dataset.basemap);
  basemapSwitch.querySelectorAll('.basemap-switch__btn').forEach((b) => b.classList.toggle('is-active', b === btn));
});

// ---- AOI + coverage (need the style loaded) -----------------------------

const fmtArea = (m2) => {
  const km2 = m2 / 1e6;
  if (km2 >= 1) return `${km2.toFixed(km2 >= 100 ? 0 : 1)} km²`;
  return `${(m2 / 1e4).toFixed(1)} ha`;
};
const fmtKm = (m) => `${(m / 1000).toFixed(m >= 100000 ? 0 : 1)} km`;

const drawHint = $('#drawHint');
const aoiStatus = $('#aoiStatus');
const aoiReadout = $('#aoiReadout');
const drawRadiusBtn = $('#drawRadius');
const drawPolygonBtn = $('#drawPolygon');
const fitAoiBtn = $('#fitAoi');
const clearAoiBtn = $('#clearAoi');
const computeBtn = $('#computeCoverage');

const TX_GAIN_DBI = 2.15;
let aoi = null;
let coverage = null;
let drone = null;

function whenStyleReady(fn) {
  if (map.isStyleLoaded()) fn();
  else map.once('load', fn);
}

whenStyleReady(() => {
  updateZoom();

  aoi = createAoiController(map, {
    onChange(s) {
      const has = s && s.type !== null;
      fitAoiBtn.disabled = !has;
      clearAoiBtn.disabled = !has;
      computeBtn.disabled = !has;
      if (!has) {
        aoiStatus.textContent = 'none drawn';
        aoiReadout.textContent = 'No area defined yet. Pick a tool, then draw on the map.';
        statusAoi.textContent = '—';
        statusMode.textContent = 'Ready';
        return;
      }
      if (s.type === 'radius') {
        aoiStatus.textContent = 'radius';
        aoiReadout.textContent = `Radius ${fmtKm(s.radiusM)} · covering ${fmtArea(s.areaM2)}.`;
        statusAoi.textContent = `${fmtKm(s.radiusM)} r · ${fmtArea(s.areaM2)}`;
      } else {
        aoiStatus.textContent = 'polygon';
        aoiReadout.textContent = `Polygon · ${s.vertices} vertices · ${fmtArea(s.areaM2)} · ${fmtKm(s.perimeterM)} perimeter.`;
        statusAoi.textContent = `${s.vertices} pts · ${fmtArea(s.areaM2)}`;
      }
      statusMode.textContent = 'AOI set';
      syncToolButtons();
    },
    onHint(text) {
      drawHint.classList.toggle('is-visible', Boolean(text));
      if (text) drawHint.innerHTML = text.replace('Enter', '<kbd>Enter</kbd>').replace('Esc', '<kbd>Esc</kbd>');
      if (aoi?.getMode?.()) statusMode.textContent = `Drawing ${aoi.getMode()}`;
    },
  });

  coverage = createCoverageController(map, {
    onProgress(frac, phase) {
      progress.hidden = false;
      progressBar.style.width = `${Math.round(frac * 100)}%`;
      if (phase === 'terrain' && frac === 0) statusMode.textContent = 'Loading terrain…';
      else statusMode.textContent = frac >= 1 ? 'Coverage ready' : `Computing… ${Math.round(frac * 100)}%`;
      if (frac >= 1) {
        opacityRow.hidden = false;
        setTimeout(() => {
          progress.hidden = true;
          progressBar.style.width = '0%';
        }, 350);
      }
    },
    onStatus(state, info) {
      if (state === 'error') {
        coverageHelp.textContent = 'Coverage worker failed — see console.';
      } else if (state === 'done') {
        const terrain = info?.terrain;
        const clutter = info?.clutter;
        coverageEngine.textContent =
          (terrain ? 'FSPL+Deygout' : 'FSPL · flat') + (clutter ? ' · clutter' : '');
        const bits = [];
        bits.push(terrain
          ? 'Terrain-aware (FSPL + Deygout knife-edge over DEM, k=4/3).'
          : (useTerrainInput.checked ? 'Terrain unavailable — flat FSPL fallback.' : 'Flat free-space (FSPL).'));
        if (useClutterInput.checked) {
          bits.push(clutter
            ? 'ESA WorldCover clutter applied.'
            : 'Clutter unavailable here (Africa-only source).');
        }
        bits.push('Planning-grade, not survey-grade.');
        coverageHelp.textContent = bits.join(' ');
      }
    },
  });

  // AOI tools
  drawRadiusBtn.addEventListener('click', () => {
    aoi.setMode('radius');
    syncToolButtons();
    if (mq.matches) closePanel();
  });
  drawPolygonBtn.addEventListener('click', () => {
    aoi.setMode('polygon');
    syncToolButtons();
    if (mq.matches) closePanel();
  });
  clearAoiBtn.addEventListener('click', () => {
    aoi.clear();
    aoi.setMode(null);
    syncToolButtons();
    clearCoverageBtn.click();
  });
  fitAoiBtn.addEventListener('click', () => aoi.fitBounds());

  // Coverage compute
  computeBtn.addEventListener('click', runCoverage);
  opacityInput.addEventListener('input', () => coverage.setOpacity(opacityInput.value / 100));
  clearCoverageBtn.addEventListener('click', () => {
    coverage.clear();
    opacityRow.hidden = true;
    progress.hidden = true;
    progressBar.style.width = '0%';
    coverageHelp.textContent = 'Draw an AOI, then compute. The transmitter defaults to the AOI centre. Flat free-space estimate for now.';
  });

  // ---- Drone relay (M2.1) ----------------------------------------------
  drone = createDroneController(map, {
    coverage,
    getAoi: () => aoi?.getAoi?.() || null,
    coverageParams,
    onState(st) {
      if ('hasDrone' in st) {
        dronePanel.hidden = !st.hasDrone;
        const pace = st.pace;
        statusPaceWrap.hidden = !pace;
        statusPaceSep.hidden = !pace;
        if (pace) statusPace.textContent = `PACE: ${pace}`;
      }
      if (st.computing) droneGain.textContent = 'Computing airborne relay vs a ground mast…';
      else if (st.result) {
        const { altFrac, groundFrac, gainPts } = st.result;
        droneGain.textContent =
          `Airborne relay @ ${st.altM} m AGL covers ${Math.round(altFrac * 100)}% of the area, ` +
          `vs ${Math.round(groundFrac * 100)}% for a ground mast here — ` +
          `${gainPts >= 0 ? '+' : ''}${gainPts.toFixed(0)} pts. Height is the lever in VHF/UHF.`;
      }
      if (st.envProgress !== undefined) {
        statusMode.textContent = st.envProgress >= 1 ? 'Envelope ready' : `Envelope… ${Math.round(st.envProgress * 100)}%`;
        if (st.envProgress === 0) envHelp.textContent = 'Computing fly / link zone by altitude band…';
      }
      if (st.envDone) {
        const fMHz = clampNum(c2Freq.value, 30, 6000, 2400);
        const pW = clampNum(c2Power.value, 0.01, 50, 1);
        envHelp.textContent = `Fly / link zone for C2 ${fMHz} MHz @ ${pW} W from the GCS. Nested zones = reach at 50/100/120 m AGL; amber = terrain shadow (climb to clear). Planning-grade.`;
        statusMode.textContent = 'Envelope ready';
      }
    },
  });

  addDroneBtn.addEventListener('click', () => {
    drone.armPlacement(true);
    statusMode.textContent = 'Click the map to place the drone relay';
    if (mq.matches) closePanel();
  });
  droneAlt.addEventListener('input', () => {
    drone.setAltitude(Number(droneAlt.value));
    droneAltVal.textContent = `${droneAlt.value} m`;
  });
  computeRelayBtn.addEventListener('click', () => drone.computeRelay());
  clearDroneBtn.addEventListener('click', () => {
    drone.clear();
    coverage.clear();
    opacityRow.hidden = true;
  });

  // Flight / link envelope (M2.1 B)
  addGcsBtn.addEventListener('click', () => {
    gcsPanel.hidden = false;
    drone.arm('gcs');
    statusMode.textContent = 'Click the map to place the ground station (GCS)';
    if (mq.matches) closePanel();
  });
  computeEnvelopeBtn.addEventListener('click', () => {
    if (!drone.hasGcs()) {
      envHelp.textContent = 'Place the GCS first — click "Flight envelope", then click the map.';
      return;
    }
    const fMHz = clampNum(c2Freq.value, 30, 6000, 2400);
    const pW = clampNum(c2Power.value, 0.01, 50, 1);
    drone.computeEnvelope({
      freqMHz: fMHz,
      eirpDbm: wattsToDbm(pW) + TX_GAIN_DBI,
      rxSensDbm: -97, // typical C2 receiver sensitivity
      gcsHeightM: 3,
      radiusKm: 40,
    });
  });
});

function syncToolButtons() {
  const m = aoi?.getMode?.();
  drawRadiusBtn.setAttribute('aria-pressed', String(m === 'radius'));
  drawRadiusBtn.classList.toggle('is-active', m === 'radius');
  drawPolygonBtn.setAttribute('aria-pressed', String(m === 'polygon'));
  drawPolygonBtn.classList.toggle('is-active', m === 'polygon');
  if (m) statusMode.textContent = `Drawing ${m}`;
}

// ---- Coverage controls (DOM refs used by load handler) ------------------

const freqInput = $('#freqInput');
const powerInput = $('#powerInput');
const txHeightInput = $('#txHeight');
const rxHeightInput = $('#rxHeight');
const useTerrainInput = $('#useTerrain');
const useClutterInput = $('#useClutter');
const thExcellent = $('#thExcellent');
const thGood = $('#thGood');
const thMarginal = $('#thMarginal');
const thNone = $('#thNone');
const opacityInput = $('#opacityInput');
const opacityRow = $('#opacityRow');
const clearCoverageBtn = $('#clearCoverage');
const progress = $('#coverageProgress');
const progressBar = $('#coverageProgressBar');
const coverageHelp = $('#coverageHelp');
const coverageEngine = $('#coverageEngine');

// Drone (M2.1)
const addDroneBtn = $('#addDrone');
const dronePanel = $('#dronePanel');
const droneAlt = $('#droneAlt');
const droneAltVal = $('#droneAltVal');
const computeRelayBtn = $('#computeRelay');
const droneGain = $('#droneGain');
const clearDroneBtn = $('#clearDrone');
const statusPaceWrap = $('#statusPaceWrap');
const statusPaceSep = $('#statusPaceSep');
const statusPace = $('#statusPace');
// Flight envelope (M2.1 B)
const addGcsBtn = $('#addGcs');
const gcsPanel = $('#gcsPanel');
const c2Freq = $('#c2Freq');
const c2Power = $('#c2Power');
const computeEnvelopeBtn = $('#computeEnvelope');
const envHelp = $('#envHelp');

function clampNum(v, min, max, fallback) {
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Shared link/engine params (everything except bounds/tx/txHeightM). */
function coverageParams() {
  const freqMHz = clampNum(freqInput.value, 30, 6000, 150);
  const powerW = clampNum(powerInput.value, 0.01, 100, 5);
  return {
    eirpDbm: wattsToDbm(powerW) + TX_GAIN_DBI,
    freqMHz,
    rxGainDbi: 0,
    clutterDb: 0,
    useTerrain: useTerrainInput.checked,
    useClutter: useClutterInput.checked,
    rxHeightM: clampNum(rxHeightInput.value, 0.5, 50, 1.5),
    thresholds: {
      excellent: clampNum(thExcellent.value, -200, 0, -85),
      good: clampNum(thGood.value, -200, 0, -95),
      marginal: clampNum(thMarginal.value, -200, 0, -103),
      none: clampNum(thNone.value, -200, 0, -110),
    },
    floorDbm: -120,
  };
}

function runCoverage() {
  const area = aoi?.getAoi?.();
  if (!area) return;
  coverage.compute(area.bounds, area.center, {
    ...coverageParams(),
    txHeightM: clampNum(txHeightInput.value, 1, 300, 10),
  });
  coverageEngine.textContent = useTerrainInput.checked ? 'FSPL+Deygout' : 'FSPL · flat';
}

// ---- Mobile slide-over panel -------------------------------------------

const app = $('#app');
const panelToggle = $('#panelToggle');
const panel = $('#panel');
const mq = window.matchMedia('(max-width: 760px)');

const openPanel = () => {
  app.dataset.panel = 'open';
  panelToggle.setAttribute('aria-expanded', 'true');
  if (mq.matches) panel.querySelector('button, [tabindex]')?.focus();
};
const closePanel = () => {
  app.dataset.panel = 'closed';
  panelToggle.setAttribute('aria-expanded', 'false');
  if (mq.matches) panelToggle.focus();
};

panelToggle.addEventListener('click', openPanel);
$('#scrim').addEventListener('click', closePanel);
$('#panelClose').addEventListener('click', closePanel);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && mq.matches && app.dataset.panel === 'open') closePanel();
});

// Dev-only handle for testing/automation (stripped from production builds).
if (import.meta.env.DEV) {
  window.__gl = { map, mapApi, get aoi() { return aoi; }, get coverage() { return coverage; } };
}
