import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl from 'maplibre-gl';
import '../styles/index.css';

import { initMap, keepMapSized } from './map/map.js';
import { createAoiController } from './map/aoi.js';
import { createProfileTool } from './map/profile-tool.js';
import { createProfilePanel } from './ui/profile-panel.js';
import { createCoverageController } from './coverage/coverage.js';
import { updateCliffLayer, clearCliffLayer } from './coverage/dual-contour.js';
import { createBackendSettings } from './ui/backend-settings.js';
import { runCloudRFCoverage } from './backends/cloudrf.js';
import { createDroneController } from './drone/drone.js';
import { createRecommendController } from './recommend/recommend.js';
import { createMission } from './mission/mission.js';
import { createMissionTools } from './mission/mission-tools.js';
import { createWaypointController } from './mission/waypoints.js';
import { createTeamsManager } from './mission/teams.js';
import { createTeamsPanel } from './ui/teams-panel.js';
import { parseCoordinate, formatCoordinate, COORD_CYCLE } from './geo/coords.js';
import { createRadios } from './radios/radios.js';
import { recommendMix } from './radios/mix.js';
import { createCellularController, CELL_TYPE_DEFAULTS } from './connectivity/cellular.js';
import { assignRoles, NODE_ROLES } from './radios/roles.js';
import {
  operatorEndurance, timingsToDuty, siteEnergyWh, solarPanelW,
  networkBom, profileForRadioRole,
} from './power/power.js';
import { atakConsumedMah, powerbankRecommendation } from './power/atak.js';
import { buildPace } from './pace/pace.js';
import { exportReport } from './pace/report.js';
import { createHfPanel } from './hf/hf-panel.js';
import { createPalette } from './ui/search.js';
import { createImportController } from './io/import.js';
import { createExportPanel } from './export/export-panel.js';
import { initThemeToggle, applyInitialTheme } from './ui/theme.js';
import { initPwa } from './ui/pwa.js';
import { createLocateControl } from './ui/locate.js';
import { showToast } from './ui/toast.js';
import { createObjectRegistry, RF_KINDS } from './ui/objects.js';
import { createObjectList } from './ui/objlist.js';
import { createSectionTabs } from './ui/tabs.js';
import { createContextMenu } from './ui/ctxmenu.js';
import { createToolbar, TOOLBAR_MODULES, MODULE_BY_KEY } from './ui/toolbar.js';
import { planState } from './ui/planstate.js';
import { createPanelGroups } from './ui/groups.js';
import { computeBadges, renderBadge } from './ui/badges.js';
import { summarizeCoverage } from './analysis/summary.js';
import { createResultCard, createStalePill } from './ui/resultcard.js';
import { createRailState } from './ui/rail.js';
import { createLeftPanel } from './ui/lpanel.js';
import { initDragMove } from './ui/dragmove.js';
import { serializeMission, parseMission, missionFilename, looksLikeMissionFile, isMissionData } from './io/mission.js';
import { createFocusMode } from './ui/focus.js';
import { createObjectsDash } from './ui/dash-objects.js';
import { createPowerDash } from './ui/dash-power.js';
import { createEmptyState } from './ui/emptystate.js';
import { createUndoStack } from './ui/undo.js';
import { wattsToDbm, maxRangeM, haversineM, MODE_THRESHOLDS } from './coverage/model.js';
import { BASEMAP_VARIANTS } from './map/basemaps.js';
import { setOvertureBuildings } from './map/pmtiles.js';
import { packageAoi, readManifest, clearOfflinePack } from './data/offline.js';
import { buildElevationSampler, buildClutterSampler } from './data/sources.js';
import { createMastWizard } from './ui/mast-wizard.js';

const $ = (sel) => document.querySelector(sel);

// First paint follows the OS colour scheme (light default otherwise).
applyInitialTheme();

// ---- Build stamp + ALPHA notice -----------------------------------------
// __GL_BUILD__ is injected by vite (see vite.config.js).
const BUILD = __GL_BUILD__;
const buildLabel = `build ${BUILD.version}+${BUILD.sha} · ${BUILD.date}`;
$('#statusBuild').textContent = buildLabel;
$('#statusBuildItem').title = `${BUILD.channel.toUpperCase()} · ${buildLabel}`;

(() => {
  const notice = $('#alphaNotice');
  if (!notice) return;
  notice.hidden = false; // show on every page load; dismiss is session-only (in-memory)
  $('#alphaNoticeClose').addEventListener('click', () => { notice.hidden = true; });
})();

// ---- Map ----------------------------------------------------------------

const mapApi = initMap($('#map'));
const { map } = mapApi;
const resize = keepMapSized(map);

// ---- Status bar ---------------------------------------------------------

const statusCoords = $('#statusCoords');
const statusZoom = $('#statusZoom');
const statusMode = $('#statusMode');
const statusAoi = $('#statusAoi');
const statusTerrain = $('#statusTerrain');

// Status-bar coordinate readout — click to cycle lat/long → MGRS → UTM.
let coordFmtIndex = 0;
let lastCursor = null;
function renderCursor() {
  statusCoords.textContent = lastCursor ? formatCoordinate(lastCursor, COORD_CYCLE[coordFmtIndex]) : '—';
}
map.on('mousemove', (e) => {
  lastCursor = { lat: e.lngLat.lat, lng: e.lngLat.lng };
  renderCursor();
});
map.getCanvasContainer().addEventListener('mouseleave', () => {
  lastCursor = null;
  renderCursor();
});
statusCoords.addEventListener('click', () => {
  coordFmtIndex = (coordFmtIndex + 1) % COORD_CYCLE.length;
  renderCursor();
});
statusCoords.style.cursor = 'pointer';
statusCoords.title = 'Click to cycle lat/long · MGRS · UTM';

// Right-click anywhere on the map → coordinate readout + copy, in the active
// format (same lat/long · MGRS · UTM cycle as the status bar).
let coordPopup = null;
map.on('contextmenu', (e) => {
  e.preventDefault?.();
  const text = formatCoordinate({ lat: e.lngLat.lat, lng: e.lngLat.lng }, COORD_CYCLE[coordFmtIndex]);
  coordPopup?.remove();
  const wrap = document.createElement('div');
  wrap.className = 'coord-popup';
  wrap.innerHTML =
    `<span class="coord-popup__text" data-numeric></span>` +
    `<button type="button" class="coord-popup__copy" title="Copy coordinate">Copy</button>`;
  wrap.querySelector('.coord-popup__text').textContent = text;
  wrap.querySelector('.coord-popup__copy').addEventListener('click', () => {
    try { navigator.clipboard?.writeText(text); statusMode.textContent = 'Coordinate copied'; } catch { /* clipboard unavailable */ }
  });
  coordPopup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, offset: 12 })
    .setLngLat(e.lngLat)
    .setDOMContent(wrap)
    .addTo(map);
});

const updateZoom = () => {
  statusZoom.textContent = map.getZoom().toFixed(1);
};
map.on('zoom', updateZoom);

// ---- Theme toggle (map canvas stays dark regardless) --------------------

initThemeToggle($('#themeToggle'), () => resize());

// ---- User / Advanced mode (M10) -----------------------------------------
// User mode (default) shows only the core 5-click workflow; advanced mode
// reveals fine-tuning controls in place. Choice is tab-local (sessionStorage),
// never localStorage — per CLAUDE.md OPSEC / persistence rules.

const modeToggleBtn = $('#modeToggle');
let advancedMode = false;
try { advancedMode = sessionStorage.getItem('glMode') === 'advanced'; } catch { /* sandboxed preview: no storage */ }

function applyMode(adv) {
  advancedMode = adv;
  document.body.dataset.mode = adv ? 'advanced' : 'user';
  modeToggleBtn?.classList.toggle('is-active', adv);
  modeToggleBtn?.setAttribute('aria-pressed', String(adv));
  const label = modeToggleBtn?.querySelector('.mode-toggle__label');
  if (label) label.textContent = adv ? 'ADV' : 'USR';
  try { sessionStorage.setItem('glMode', adv ? 'advanced' : 'user'); } catch { /* sandboxed preview: no storage */ }
}

modeToggleBtn?.addEventListener('click', () => applyMode(!advancedMode));
applyMode(advancedMode); // reflect persisted choice on load

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

// ---- Buildings toggle (independent of terrain 3D) -----------------------
// E1: two sources behind one toggle — OpenFreeMap live vector tiles (M10
// default) or the static Overture PMTiles archive; the Data flyout picks.
const buildingsBtn = $('#toggleBuildings');
let buildingsOn = false;
let buildingsSource = 'openfreemap';

async function applyBuildings() {
  if (buildingsSource === 'overture') {
    mapApi.setBuildings(false);
    const ok = await setOvertureBuildings(map, buildingsOn);
    if (buildingsOn && !ok) {
      mapApi.setBuildings(true); // degrade to the live source, say so
      statusMode.textContent = 'Overture PMTiles unavailable — using OpenFreeMap buildings';
    }
  } else {
    await setOvertureBuildings(map, false);
    mapApi.setBuildings(buildingsOn);
  }
}

buildingsBtn?.addEventListener('click', () => {
  buildingsOn = !buildingsOn;
  applyBuildings();
  buildingsBtn.classList.toggle('is-active', buildingsOn);
  buildingsBtn.setAttribute('aria-pressed', String(buildingsOn));
  statusMode.textContent = buildingsOn ? 'Buildings on' : 'Buildings off';
});

const bldSrcBtns = { openfreemap: $('#bldSrcOfm'), overture: $('#bldSrcOverture') };
for (const [src, btn] of Object.entries(bldSrcBtns)) {
  btn?.addEventListener('click', () => {
    buildingsSource = src;
    for (const [s, b] of Object.entries(bldSrcBtns)) {
      b?.classList.toggle('is-active', s === src);
      b?.setAttribute('aria-pressed', String(s === src));
    }
    applyBuildings();
  });
}

// ---- Path profile tool (M14) --------------------------------------------
// Click two points → terrain cross-section, Fresnel zone + link budget in a
// slide-up drawer over the map. Markers persist until the panel is closed.
// "Show my location" rail button (M23 §3) — geolocate, fly, pulsing dot.
createLocateControl(map, {
  button: $('#locateBtn'),
  onError: (msg) => showToast(msg),
  onStatus: (msg) => { statusMode.textContent = msg; },
});

const profileToolBtn = $('#profileToolBtn');

function reflectProfileBtn() {
  profileToolBtn?.classList.toggle('is-active', profileTool.isActive());
  profileToolBtn?.setAttribute('aria-pressed', String(profileTool.isActive()));
}

function closeProfile() {
  profileTool.removeMarkers();
  profileTool.deactivate();
  reflectProfileBtn();
}

const profilePanel = createProfilePanel($('#map'), { onClose: closeProfile });
const profileTool = createProfileTool(map, {
  getFreqMHz: () => parseFloat($('#freqInput')?.value) || 155,
  getTxHeight: () => parseFloat($('#txHeight')?.value) || 10,
  getRxHeight: () => 1.5,
  getThreshold: () => clampNum($('#thNone')?.value, -200, 0, -110),
  getEirp: () => wattsToDbm(clampNum($('#powerInput')?.value, 0.01, 100, 5)) + TX_GAIN_DBI,
  onProfile(data) { profilePanel.show(data); },
  onStatus(msg) { statusMode.textContent = msg; },
  onDone: reflectProfileBtn,
});

profileToolBtn?.addEventListener('click', () => {
  if (profileTool.isActive()) {
    profileTool.deactivate();
  } else {
    profileTool.removeMarkers();
    profilePanel.hide();
    profileTool.activate();
    if (mq.matches) closePanel();
  }
  reflectProfileBtn();
});

// ESC closes the profile (hide → onClose removes markers) or cancels placement.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (profilePanel.isVisible) profilePanel.hide();
  else if (profileTool.isActive() || profileTool.hasMarkers()) closeProfile();
});

// ---- Operation date/time → day/night sky --------------------------------
/**
 * Compute solar azimuth + altitude for a UTC Date at a lat/lng location.
 * Low-precision (~0.1°) Spencer/simplified VSOP87 — sufficient for planning.
 * Returns { azimuth (0=N, CW, degrees), altitude (degrees above/below horizon) }.
 */
function sunPosition(date, latDeg, lngDeg) {
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;
  const JD = date.getTime() / 86400000 + 2440587.5;
  const n = JD - 2451545.0;
  // Mean longitude + anomaly (degrees)
  let L = ((280.46 + 0.9856474 * n) % 360 + 360) % 360;
  let g = ((357.528 + 0.9856003 * n) % 360 + 360) % 360;
  // Ecliptic longitude
  const lambda = L + 1.915 * Math.sin(g * rad) + 0.02 * Math.sin(2 * g * rad);
  const eps = 23.439 - 4e-7 * n; // obliquity
  const sinLambda = Math.sin(lambda * rad);
  // Declination
  const decl = Math.asin(Math.max(-1, Math.min(1, Math.sin(eps * rad) * sinLambda))) * deg;
  // Right ascension (degrees → hours)
  let RA = Math.atan2(Math.cos(eps * rad) * sinLambda, Math.cos(lambda * rad)) * deg;
  if (RA < 0) RA += 360;
  // Greenwich mean sidereal time (hours)
  const GMST = ((6.697375 + 0.0657098242 * n +
    (date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600)) % 24 + 24) % 24;
  // Local hour angle (degrees)
  const HA = (((GMST + lngDeg / 15) - RA / 15 + 24) % 24) * 15;
  // Altitude
  const lat = latDeg * rad;
  const dec = decl * rad;
  const ha = HA * rad;
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * deg;
  // Azimuth (from N, clockwise)
  const cosAlt = Math.cos(alt * rad);
  let az = 0;
  if (cosAlt > 1e-10) {
    const cosAz = (Math.sin(dec) - Math.sin(lat) * sinAlt) / (Math.cos(lat) * cosAlt);
    az = Math.acos(Math.max(-1, Math.min(1, cosAz))) * deg;
    if (Math.sin(ha) > 0) az = 360 - az;
  }
  return { azimuth: az, altitude: alt };
}

const opDatetime = $('#opDatetime');

// Default to current local time
(function setDatetimeNow() {
  if (!opDatetime) return;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  opDatetime.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}`;
})();

function applyDayNight() {
  if (!opDatetime?.value) return;
  const dt = new Date(opDatetime.value); // datetime-local → local time
  const ctr = map.getCenter();
  const { azimuth, altitude } = sunPosition(dt, ctr.lat, ctr.lng);
  mapApi.setSkyForSun(azimuth, altitude);
  mapApi.setHillshadeDirection(azimuth);
  if (altitude < -6) {
    statusMode.textContent = `Night (sun ${altitude.toFixed(0)}° below horizon)`;
  } else if (altitude < 6) {
    statusMode.textContent = `Twilight (sun ${altitude.toFixed(0)}°)`;
  }
}

map.once('load', applyDayNight);
opDatetime?.addEventListener('change', applyDayNight);

// Live slider control (instant), and keep sliders synced with drag-rotate/pitch.
tiltSlider.addEventListener('input', () => map.setPitch(Number(tiltSlider.value)));
bearingSlider.addEventListener('input', () => map.setBearing(Number(bearingSlider.value)));
map.on('pitch', reflectViewSliders);
map.on('rotate', reflectViewSliders);

// ---- Basemap switcher + variant picker ----------------------------------

const basemapSwitch = $('#basemapSwitch');
const variantMenu = $('#basemapVariantMenu');

/** Reflect the active basemap category in the chip buttons. */
function reflectBasemap(category) {
  basemapSwitch.querySelectorAll('.basemap-switch__btn').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.basemap === category);
  });
}

/** Switch category (and optionally variant). */
function switchBasemap(category, variantId) {
  const result = mapApi.setBasemap(category, variantId);
  reflectBasemap(result.category);
}

// ---- Variant list (M20 §5: inline in the basemap flyout) ------------------
// Replaces the M10 long-press / right-click dropdown — the variants are now
// always visible (and left-clickable) inside the flyout.

function activeBasemapCategory() {
  return basemapSwitch.querySelector('.basemap-switch__btn.is-active')?.dataset.basemap ?? 'imagery';
}

function renderVariantMenu() {
  const category = activeBasemapCategory();
  variantMenu.innerHTML = '';
  const label = document.createElement('div');
  label.className = 'basemap-variant-menu__label';
  label.textContent = category === 'topo' ? 'Topo variants' : 'Imagery variants';
  variantMenu.appendChild(label);

  const currentVariant = mapApi.getVariant(category);
  for (const v of BASEMAP_VARIANTS[category]) {
    const btn = document.createElement('button');
    btn.className = 'basemap-variant-menu__item';
    btn.textContent = v.label;
    btn.type = 'button';
    if (v.id === currentVariant) btn.classList.add('is-active');
    btn.addEventListener('click', () => {
      switchBasemap(category, v.id);
      renderVariantMenu();
    });
    variantMenu.appendChild(btn);
  }
}

// Chip click switches category; the variant list follows the active chip.
basemapSwitch.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-basemap]');
  if (!btn) return;
  if (!btn.classList.contains('is-active')) switchBasemap(btn.dataset.basemap);
  renderVariantMenu();
});

// ---- Right map rail flyouts (M20 §5) ---------------------------------------
// One flyout open at a time; Esc and outside clicks close (rail.js machine).

const railFlyouts = {
  basemap: { btn: $('#railBasemapBtn'), panel: $('#railFlyoutBasemap') },
  view: { btn: $('#railViewBtn'), panel: $('#railFlyoutView') },
  data: { btn: $('#railDataBtn'), panel: $('#railFlyoutData') }, // E1
};

const railState = createRailState({
  onChange(current) {
    for (const [key, f] of Object.entries(railFlyouts)) {
      const open = current === key;
      f.panel.hidden = !open;
      f.btn.setAttribute('aria-expanded', String(open));
      f.btn.classList.toggle('is-active', open);
    }
    if (current === 'basemap') renderVariantMenu();
  },
});

railFlyouts.basemap.btn.addEventListener('click', () => railState.toggle('basemap'));
railFlyouts.view.btn.addEventListener('click', () => railState.toggle('view'));
railFlyouts.data.btn.addEventListener('click', () => railState.toggle('data'));

// ---- E1: local COG samplers + offline AOI package -------------------------
// File objects stay in memory only (never persisted, never uploaded); they are
// structured-cloned into the coverage worker per run.
const dataFiles = { clutterCog: null, elevationCog: null };

function wireCogInput(inputId, statusId, key, idleText) {
  const input = $(inputId);
  const status = $(statusId);
  input?.addEventListener('change', () => {
    dataFiles[key] = input.files?.[0] ?? null;
    if (status) {
      status.textContent = dataFiles[key]
        ? `Loaded: ${dataFiles[key].name} (${(dataFiles[key].size / 1e6).toFixed(1)} MB) — applies on the next compute.`
        : idleText;
    }
  });
}
wireCogInput('#clutterCogInput', '#clutterCogStatus', 'clutterCog',
  'Canopy or building-height GeoTIFF — sampled in-browser, never uploaded.');
wireCogInput('#elevationCogInput', '#elevationCogStatus', 'elevationCog',
  'Overrides AWS terrain where the file has data.');

const offlinePackBtn = $('#offlinePackBtn');
const offlineClearBtn = $('#offlineClearBtn');
const offlineStatus = $('#offlineStatus');

function reflectOfflineManifest(m) {
  if (!offlineStatus) return;
  if (m) {
    offlineStatus.textContent =
      `Packaged: ${m.tiles} DEM tiles, z${m.zooms[0]}–${m.zooms[m.zooms.length - 1]}, ` +
      `${(m.bytes / 1e6).toFixed(1)} MB (OPFS). Coverage for this area works offline.`;
    if (offlineClearBtn) offlineClearBtn.hidden = false;
  } else {
    offlineStatus.textContent = 'Nothing packaged. Stored privately in this browser (OPFS), never uploaded.';
    if (offlineClearBtn) offlineClearBtn.hidden = true;
  }
}
readManifest().then(reflectOfflineManifest).catch(() => {});

offlinePackBtn?.addEventListener('click', async () => {
  const bbox = mission?.bbox?.();
  if (!bbox) {
    offlineStatus.textContent = 'Draw an AOI or place a site first — the package covers your mission area.';
    return;
  }
  // Package the same window coverage computes over (the WINDOW_CAP_MULT cap
  // around the mission), so offline runs find every tile they'd fetch online.
  const halfLat = Math.max((bbox.north - bbox.south) / 2, MIN_HALF_DEG);
  const halfLng = Math.max((bbox.east - bbox.west) / 2, MIN_HALF_DEG);
  const c = { lat: (bbox.north + bbox.south) / 2, lng: (bbox.east + bbox.west) / 2 };
  const pack = {
    west: c.lng - WINDOW_CAP_MULT * halfLng,
    east: c.lng + WINDOW_CAP_MULT * halfLng,
    south: c.lat - WINDOW_CAP_MULT * halfLat,
    north: c.lat + WINDOW_CAP_MULT * halfLat,
  };
  offlinePackBtn.disabled = true;
  try {
    const manifest = await packageAoi(pack, {
      zooms: [8, 9, 10, 11, 12],
      onProgress: (f) => { offlineStatus.textContent = `Packaging… ${Math.round(f * 100)}%`; },
    });
    reflectOfflineManifest(manifest);
    statusMode.textContent = manifest ? 'Offline package ready' : 'Offline storage unavailable in this browser';
    if (!manifest) offlineStatus.textContent = 'This browser does not expose private storage (OPFS) — offline packaging unavailable.';
  } catch (err) {
    offlineStatus.textContent = `Packaging failed: ${err?.message ?? err}`;
  } finally {
    offlinePackBtn.disabled = false;
  }
});

offlineClearBtn?.addEventListener('click', async () => {
  await clearOfflinePack();
  reflectOfflineManifest(null);
  statusMode.textContent = 'Offline package cleared';
});

// Outside click (incl. the map canvas) closes the open flyout.
document.addEventListener('pointerdown', (e) => {
  if (railState.current() && !e.target.closest('.map-rail, .map-flyout')) railState.close();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && railState.current()) railState.close();
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

// M19: shared object registry — one inventory of user-placed map objects,
// driving the right panel, the context menu and drag-to-move.
const registry = createObjectRegistry();

// ---- Undo (M21 §D) -------------------------------------------------------
// Wrap the UI-driven registry mutators so every move / rename / delete pushes
// an inverse-op pair. Replays drive the raw mutators; the stack's re-entrancy
// guard keeps a replay from recording itself as a fresh action, and mission
// load suppresses capture entirely (applyingMission).

const undoStack = createUndoStack();

{
  const raw = { move: registry.move, rename: registry.rename, remove: registry.remove };

  registry.move = (id, lngLat) => {
    const e = registry.get(id);
    const from = e ? [...e.lngLat] : null;
    const to = [...lngLat];
    const ok = raw.move(id, lngLat);
    if (ok && from && !applyingMission) {
      undoStack.push({
        label: `${e.name} moved`,
        undo: () => raw.move(id, from),
        redo: () => raw.move(id, to),
      });
    }
    return ok;
  };

  registry.rename = (id, name) => {
    const e = registry.get(id);
    const from = e?.name;
    const to = String(name ?? '').trim();
    const ok = raw.rename(id, name);
    if (ok && from && !applyingMission) {
      undoStack.push({
        label: `${from} renamed to ${to}`,
        undo: () => raw.rename(id, from),
        redo: () => raw.rename(id, to),
      });
    }
    return ok;
  };

  registry.remove = (id) => {
    const e = registry.get(id);
    const snap = e
      ? { kind: e.kind, owner: e.owner, name: e.name, lngLat: [...e.lngLat], settings: { ...e.settings } }
      : null;
    const ok = raw.remove(id);
    // Recommend-owned masts are computed results — restoring one is a
    // recompute, not an undo; skip recording those deletes.
    if (ok && snap && snap.owner !== 'recommend' && !applyingMission) {
      let liveId = null; // the id after a restore — redo removes the new entry
      undoStack.push({
        label: `${snap.name} deleted`,
        undo: () => { liveId = restoreObject(snap); },
        redo: () => { if (liveId != null) raw.remove(liveId); },
      });
    }
    return ok;
  };
}

/** Recreate a deleted object in its owning module (undo of delete, M21 §D). */
function restoreObject(snap) {
  const [lng, lat] = snap.lngLat;
  if (snap.owner === 'waypoints') {
    const wp = waypoints?.add?.(lat, lng, snap.name);
    return wp ? `wp${wp.id}` : null;
  }
  if (snap.kind === 'drone') {
    drone?.place?.(snap.lngLat, snap.settings?.altM);
    return registry.byKind('drone')[0]?.id ?? null;
  }
  if (snap.owner === 'mission') {
    const item = snap.kind === 'mast' ? mission?.addSite(lat, lng, snap.name) : mission?.addPoint(lat, lng, snap.name);
    missionTools?.refresh?.();
    return item?.id ?? null;
  }
  return null;
}

let aoi = null;
let coverage = null;
let exportPanel = null; // M16 coverage/interop export panel
let importer = null; // KML/KMZ/GPX/GeoJSON overlay importer (M21: feeds the empty state too)
let drone = null;
let recommender = null;
let mission = null;
let missionTools = null;
let waypoints = null;
let radios = null;
let cellular = null; // M9 cellular controller (own coverage layer)
let hfPanel = null; // M12 HF ionosphere panel
let backendSettings = null; // M18 coverage backend (built-in / CloudRF)
let palette = null; // M20 ⌘K command palette (created once the style is ready)
let teams = null; // M13 per-team/operator model
let teamsPanel = null; // M13 teams panel UI
let currentAoiAreaM2 = 0;
let lastPlan = null; // last PACE plan built (M6) — fed to the report export
let planStale = false; // M20 §3: an RF move/settings change armed a recompute
let lastPaint = null; // M20 §3: last painted class grid {classes, cols, rows, bounds}
let focusCtl = null; // M21 §B: fullscreen section focus (created with the workspace UI)
let emptyState = null; // M21 §C: starter card over the map

// M21 §A: unsaved-work marker — title-bar dot + confirm before a load replaces
// state. applyingMission suppresses dirty-marking (and undo capture) while a
// mission file is being restored.
let missionDirty = false;
let applyingMission = false;
const BASE_TITLE = document.title;
function setDirty(d) {
  missionDirty = Boolean(d);
  document.title = missionDirty ? `• ${BASE_TITLE}` : BASE_TITLE;
}
const markDirty = () => {
  if (!applyingMission) setDirty(true);
};

function whenStyleReady(fn) {
  if (map.isStyleLoaded()) fn();
  else map.once('load', fn);
}

whenStyleReady(() => {
  updateZoom();

  // Mission model — single source of truth for area / sites / route / points.
  mission = createMission({ onChange: onMissionChange });

  aoi = createAoiController(map, {
    onChange(s) {
      const has = s && s.type !== null;
      fitAoiBtn.disabled = !has;
      clearAoiBtn.disabled = !has;
      currentAoiAreaM2 = has ? s.areaM2 : 0;
      // Feed the AOI into the mission (drives compute/recommend enablement).
      mission.setAoi(has ? aoi.getAoi() : null);
      refreshExportPanel();
      hfPanel?.refresh(); // HF planning follows the AOI centre
      if (!has) {
        // AOI removed → any recommended sites are stale.
        recommender?.clear();
        aoiStatus.textContent = 'none drawn';
        aoiReadout.textContent = 'No area defined yet. Pick a tool, then draw on the map.';
        statusAoi.textContent = '—';
        statusMode.textContent = 'Ready';
        refreshWorkflowUi(); // stepper/badges lose the mission tick
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
      refreshWorkflowUi();
    },
    onHint(text) {
      drawHint.classList.toggle('is-visible', Boolean(text));
      if (text) drawHint.innerHTML = text.replace('Enter', '<kbd>Enter</kbd>').replace('Esc', '<kbd>Esc</kbd>');
      if (aoi?.getMode?.()) statusMode.textContent = `Drawing ${aoi.getMode()}`;
    },
  });

  // HF ionosphere planner (M12) — date/time + solar cycle + path → MUF/LUF/
  // NVIS over the AOI centre, falling back to London (51.5, 0) before any AOI.
  (() => {
    const host = $('#hfPanelInner');
    if (!host) return;
    let hf;
    const refresh = () => {
      const p = hf.getParams();
      const c = aoi?.getAoi?.()?.center;
      hf.update(c?.lat ?? 51.5, c?.lng ?? 0, p.dt, p.pathKm, p.solarCycle);
    };
    hf = createHfPanel(host, { onParamsChange: refresh });
    hfPanel = { refresh };
    refresh();
  })();

  // Coverage backend selector (M18) — built-in engine or hosted CloudRF ITM.
  (() => {
    const host = $('#backendSettingsInner');
    if (!host) return;
    backendSettings = createBackendSettings(host, {
      onBackendChange() {
        coverageEngine.textContent = engineLabel();
      },
    });
  })();

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
      if (state === 'cleared') refreshExportPanel();
      if (state === 'cleared') {
        lastPaint = null;
        planStale = false; // nothing painted → nothing to be stale
        stalePill.disarm();
        resultCard.hide();
      }
      if (state === 'done') {
        planStale = false; // a fresh run supersedes any pending stale state
        stalePill.disarm();
        showResultCard();
      }
      if (state === 'cleared' || state === 'done') refreshWorkflowUi();
      if (state === 'error') {
        coverageHelp.textContent = 'Coverage worker failed — see console.';
      } else if (state === 'done') {
        refreshExportPanel();
        const terrain = info?.terrain;
        const clutter = info?.clutter;
        const ranP1812 = info?.engine === 'p1812';
        coverageEngine.textContent =
          (ranP1812 ? engineLabel('p1812') : (terrain ? 'FSPL+Deygout' : 'FSPL · flat')) +
          (clutter ? ' · clutter' : '');
        // update status bar terrain indicator — names the E1 source actually
        // used (offline package / local COG / network tiles)
        if (statusTerrain) {
          const demTag =
            info?.elevSource === 'offline' ? 'DEM (offline)'
            : info?.elevSource?.startsWith('cog') ? 'DEM (COG)'
            : 'DEM';
          statusTerrain.textContent = terrain ? (clutter ? `${demTag} + clutter` : demTag) : 'flat';
        }
        const bits = [];
        const stats = coverage.getStats();
        if (stats && stats.coveredFracAoi != null) {
          bits.push(`${Math.round(stats.coveredFracAoi * 100)}% of the AOI is covered (marginal or better).`);
        }
        bits.push(ranP1812
          ? 'Terrain-aware (ITU-R P.1812 Delta-Bullington over DEM).'
          : terrain
            ? 'Terrain-aware (FSPL + Deygout knife-edge over DEM, k=4/3).'
            : (useTerrainInput.checked ? 'Terrain unavailable — flat FSPL fallback.' : 'Flat free-space (FSPL).'));
        if (resolveEngine() === 'p1812' && !ranP1812 && useTerrainInput.checked) {
          bits.push('P.1812 needs terrain — ran the FSPL fallback.');
        }
        if (info?.elevSource === 'offline') bits.push('Elevation from the offline package (OPFS).');
        else if (info?.elevSource?.startsWith('cog')) bits.push('Elevation from your local COG.');
        if (useClutterInput.checked) {
          bits.push(clutter
            ? (info?.clutterSource === 'cog' ? 'Clutter heights from your local COG.' : 'ESA WorldCover clutter applied.')
            : 'Clutter unavailable here (Africa-only source — or load a local COG in the Data flyout).');
        }
        bits.push('Planning-grade, not survey-grade.');
        coverageHelp.textContent = bits.join(' ');
      }
    },
    // M15: after each paint, mark the digital-cliff band (class 3) for digital
    // modes. Analogue degrades gracefully → no cliff overlay.
    onPaint(classes, cols, rows, bounds) {
      lastPaint = { classes, cols, rows, bounds }; // feeds the M20 result card
      const mode = digitalModeSelect?.value ?? 'Analogue';
      updateCliffLayer(map, classes, cols, rows, bounds, mode !== 'Analogue');
    },
  });

  // ---- Coverage / interop export (M16) ---------------------------------
  // Exposes the last-rendered coverage raster plus the mission's sites and
  // waypoints to the GeoTIFF / KMZ / CivTAK exporters. Shown only while a
  // coverage raster is on the map.
  exportPanel = createExportPanel({
    els: {
      wrap: $('#dataExport'),
      geotiffBtn: $('#exportGeotiffBtn'),
      kmzBtn: $('#exportKmzBtn'),
      geojsonBtn: $('#exportGeojsonBtn'),
      takBtn: $('#exportTakBtn'),
      help: $('#dataExportHelp'),
    },
    getExport: () => {
      const canvas = coverage?.getLastCanvas?.() ?? null;
      const bounds = coverage?.getLastBounds?.() ?? null;
      // Combine fixed mission sites, recommended masts and named waypoints,
      // plus demand points, the route and the real AOI ring (KML/GeoJSON).
      const sites = [...(mission?.getSites?.() ?? []), ...(recommender?.getSites?.() ?? [])];
      const wpts = waypoints?.getAll?.() ?? [];
      return {
        canvas,
        bounds,
        sites,
        waypoints: wpts,
        points: mission?.getPoints?.() ?? [],
        route: mission?.getRoute?.() ?? [],
        aoi: aoi?.getAoi?.() ?? null,
        missionName: 'GroundLink mission',
      };
    },
    onStatus: (msg) => { statusMode.textContent = msg; },
  });

  // ---- Cellular coverage (M9) ------------------------------------------
  // One coverage instance per network type, each on its own layer beneath
  // the RF coverage raster. Independent of mission radio coverage. No tint:
  // cells colour by signal class on the --s1…--s5 spectrum (the M23 §2
  // restoration of the e4d7d13 signal scale — a later commit had flattened
  // it to one colour per network type). Type colours stay on the tower
  // markers and the checkbox dots.
  const cellCoverages = {};
  for (const type of Object.keys(CELL_TYPE_DEFAULTS)) {
    cellCoverages[type] = createCoverageController(map, {
      src: `cellular-${type}`,
      layer: `cellular-${type}-layer`,
      before: 'coverage-layer',
      opacity: 0.55,
      onStatus(state) {
        if (state === 'error') cellHelp.textContent = 'Cellular worker failed — see console.';
      },
    });
  }
  cellular = createCellularController(map, cellCoverages, {
    onStatus(state, info) {
      if (state === 'loading') {
        if (cellReadout) cellReadout.textContent = 'Fetching towers from OpenStreetMap…';
      } else if (state === 'error') {
        if (cellReadout) cellReadout.textContent = `Error: ${info?.message || 'Overpass fetch failed.'}`;
      }
      // 'computing' and 'empty' states are handled in the showCellBtn click handler
    },
  });
  initCellularControls();

  // ---- Mission tools (M4): Sites / Route / Points ----------------------
  missionTools = createMissionTools(map, mission, {
    onHint(text) {
      drawHint.classList.toggle('is-visible', Boolean(text));
      if (text) {
        drawHint.innerHTML = text
          .replace('Enter', '<kbd>Enter</kbd>')
          .replace('Esc', '<kbd>Esc</kbd>')
          .replace('Backspace', '<kbd>Backspace</kbd>');
      }
    },
    onModeChange(m) {
      const key = m === 'site' ? 'sites' : m === 'point' ? 'points' : m === 'route' ? 'route' : 'area';
      reflectMissionMode(key);
      if (m) statusMode.textContent = `Placing ${m}`;
    },
    onStatus(msg) { statusMode.textContent = msg; },
    formatCoord: (ll) => formatCoordinate({ lat: ll[1], lng: ll[0] }, COORD_CYCLE[coordFmtIndex]),
    registry,
  });

  // Mission input-mode segmented buttons (Area / Sites / Route / Points).
  missionModes.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mode]');
    if (btn) armMissionMode(btn.dataset.mode);
  });

  // ---- Named waypoints (M11) -------------------------------------------
  waypoints = createWaypointController(map, {
    formatCoord: (pt, fmt) => formatCoordinate(pt, fmt),
    coordCycle: COORD_CYCLE,
    onUpdate(all) { renderWaypointList(all); refreshExportPanel(); },
    registry,
  });

  const placeWaypointBtn = $('#placeWaypointBtn');
  placeWaypointBtn?.addEventListener('click', () => {
    if (waypoints.isPlacing()) {
      waypoints.cancelPlacing();
    } else {
      waypoints.startPlacing();
      statusMode.textContent = 'Click map to place waypoint';
      // The placement click is one-shot — drop the armed state once it lands.
      map.once('click', () => placeWaypointBtn.classList.remove('is-active'));
      if (mq.matches) closePanel();
    }
    placeWaypointBtn.classList.toggle('is-active', waypoints.isPlacing());
  });

  // Per-type clear in the element list.
  missionElements.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-clear]');
    if (!btn) return;
    missionTools.clearType(btn.dataset.clear);
    if (recommender?.hasSites()) recommender.clear();
  });

  // Bulk add coordinates (any format, optional trailing name).
  bulkAddBtn.addEventListener('click', runBulkAdd);

  // AOI tools — drawing an AOI is the "Area" mission mode.
  drawRadiusBtn.addEventListener('click', () => {
    missionTools.setMode(null);
    aoi.setMode('radius');
    syncToolButtons();
    reflectMissionMode('area');
    if (mq.matches) closePanel();
  });
  drawPolygonBtn.addEventListener('click', () => {
    missionTools.setMode(null);
    aoi.setMode('polygon');
    syncToolButtons();
    reflectMissionMode('area');
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

  // M15: digital mode picks a threshold preset (sharp cliff for DMR/P25/dPMR).
  // Writing the preset into the threshold fields keeps coverageParams() as the
  // single source of truth; a live raster is recomputed so the cliff moves too.
  digitalModeSelect?.addEventListener('change', () => {
    applyModeThresholds(digitalModeSelect.value);
    if (coverage?.hasCoverage()) runCoverage();
  });
  opacityInput.addEventListener('input', () => {
    const v = opacityInput.value / 100;
    coverage.setOpacity(v);
    for (const c of Object.values(cellCoverages)) c.setOpacity(v);
    if (map.getLayer(CLOUDRF_LAYER)) map.setPaintProperty(CLOUDRF_LAYER, 'raster-opacity', v);
  });
  clearCoverageBtn.addEventListener('click', () => {
    // Recommended sites paint into this same raster — clear them too so the
    // numbered markers and the site list don't linger over a cleared map.
    if (recommender?.hasSites()) recommender.clear();
    coverage.clear();
    clearCloudRFResult();
    clearCliffLayer(map);
    opacityRow.hidden = true;
    progress.hidden = true;
    progressBar.style.width = '0%';
    coverageHelp.textContent = 'Draw an AOI, then compute. The transmitter defaults to the AOI centre. Terrain uses AWS elevation tiles — no token needed.';
  });

  // ---- Drone relay (M2.1) ----------------------------------------------
  drone = createDroneController(map, {
    coverage,
    getAoi: () => aoi?.getAoi?.() || null,
    coverageParams,
    registry,
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
  computeRelayBtn.addEventListener('click', () => {
    // Drone relay paints the same shared raster — supersede any recommendation.
    if (recommender?.hasSites()) recommender.clear();
    drone.computeRelay();
  });
  clearDroneBtn.addEventListener('click', () => {
    drone.clear();
    coverage.clear();
    clearCliffLayer(map);
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

  // ---- Site recommendation (M3) ----------------------------------------
  recommender = createRecommendController(map, coverage, {
    onProgress(frac, phase) {
      siteProgress.hidden = false;
      siteProgressBar.style.width = `${Math.round(frac * 100)}%`;
      statusMode.textContent =
        phase === 'data' ? 'Loading terrain…'
        : phase === 'score' ? 'Scoring candidate sites…'
        : phase === 'cover' ? 'Selecting sites…'
        : 'Working…';
    },
    onDone(sites, info) {
      siteProgress.hidden = true;
      siteProgressBar.style.width = '0%';
      if (info?.cleared) {
        siteResults.hidden = true;
        siteList.innerHTML = '';
        // The combined raster was removed with the sites — drop its opacity row.
        opacityRow.hidden = true;
        progress.hidden = true;
        progressBar.style.width = '0%';
        return;
      }
      if (info?.empty) {
        siteResults.hidden = false;
        siteList.innerHTML = '';
        siteHelp.textContent = 'Too little demand — fewer than two demand points. Draw an AOI, trace a route, or add points.';
        statusMode.textContent = 'No sites';
        return;
      }
      renderSiteList(sites);
      siteResults.hidden = false;
      const coveredFrac = sites.length ? sites[sites.length - 1].cumulativeFrac : info.baseFrac ?? 0;
      const bits = [];
      if (sites.length) {
        bits.push(`${sites.length} new mast${sites.length > 1 ? 's' : ''} · ${Math.round(coveredFrac * 100)}% of demand covered.`);
        if (info.lockedCount) bits.push(`${info.lockedCount} fixed site${info.lockedCount > 1 ? 's' : ''} held as locked.`);
      } else {
        bits.push(`Fixed site${info.lockedCount > 1 ? 's' : ''} already cover ${Math.round(coveredFrac * 100)}% of demand — no extra masts needed.`);
      }
      if (!info.terrain) bits.push('Terrain unavailable — flat estimate.');
      if (currentAoiAreaM2 > 1e10) bits.push('Large AOI (>10 000 km²) — demand grid capped, results coarse.');
      bits.push('Sites sit on local high ground; model is talk-in at 1.5 m. Planning-grade — not survey-grade.');
      siteHelp.textContent = bits.join(' ');
      statusMode.textContent = 'Sites ready';
    },
    onStatus(msg) { statusMode.textContent = msg; },
    registry,
  });

  recommendBtn.addEventListener('click', () => {
    const bbox = mission.bbox();
    if (!bbox) return;
    const params = { ...coverageParams(), txHeightM: clampNum(txHeightInput.value, 1, 300, 10) };
    // Cap the AOI grid resolution for very large areas (edge case in the spec).
    const demand = mission.demandPoints({ maxDim: currentAoiAreaM2 > 1e10 ? 20 : 28 });
    if (demand.length < 2) {
      siteResults.hidden = false;
      siteList.innerHTML = '';
      siteHelp.textContent = 'Too little demand — draw an AOI, trace a route, or add points first.';
      return;
    }
    const area = aoi?.getAoi?.();
    const aoiMask = area ? { type: area.type, center: area.center, radiusM: area.radiusM, ring: area.ring } : null;
    recommender.recommend(
      { bounds: bbox, aoi: aoiMask, demand, lockedSites: mission.lockedSites() },
      params,
      {
        maxSites: clampNum($('#maxSites').value, 1, 99, 3),
        targetFrac: clampNum($('#targetCoverage').value, 10, 100, 95) / 100,
      },
    );
    coverageEngine.textContent = engineLabel(params.engine);
    if (mq.matches) closePanel();
  });
  clearSitesBtn.addEventListener('click', () => recommender.clear());

  // ---- Radios (M5): active set, picker, FCC/manual, mix ----------------
  radios = createRadios(radioEls(), {
    onApply(vals) {
      freqInput.value = String(Math.round(vals.freqMHz));
      powerInput.value = String(vals.powerW);
      txHeightInput.value = String(vals.txHeightM);
      rxHeightInput.value = String(vals.rxHeightM);
      thExcellent.value = String(vals.thresholds.excellent);
      thGood.value = String(vals.thresholds.good);
      thMarginal.value = String(vals.thresholds.marginal);
      thNone.value = String(vals.thresholds.none);
      updateSignalLegend();
      coverageHelp.textContent = vals.rasterMeaningful
        ? `Coverage controls set from the active radio set — talk-in at ${vals.rxHeightM} m, ` +
          `thresholds from ${Math.round(vals.rxSensDbm)} dBm sensitivity. Compute to plot.`
        : `Active tx is ${vals.txRole.toUpperCase()} — a PACE asset, not a terrestrial line-of-sight band. ` +
          `The FSPL raster won't represent ${vals.txRole === 'hf' ? 'HF (NVIS/ALE — a separate module)' : 'satcom'}; ` +
          `use the radio mix for the PACE plan. Controls are set for VHF/UHF comparison only.`;
    },
    onStatus(msg) { statusMode.textContent = msg; },
    onArsenalChange() {
      markDirty(); // the arsenal is part of the mission file (M21 §A)
      if (rolesList && !rolesList.hidden) renderRoles();
      teamsPanel?.render(); // keep the per-team radio picker in sync with the arsenal
      refreshWorkflowUi();
    },
  });

  // ---- Teams & operators (M13) -----------------------------------------
  teams = createTeamsManager();
  const teamsHost = $('#teamsPanelInner');
  if (teamsHost) {
    teamsPanel = createTeamsPanel(teamsHost, {
      teamsManager: teams,
      getRadios: () => radios.getArsenal(),
      onRunCoverage: runTeamCoverage,
    });
  }

  recommendMixBtn.addEventListener('click', () => {
    renderMix(recommendMix(gatherMixInput()));
    statusMode.textContent = 'Radio mix ready';
  });

  // ---- Node roles (M7) -------------------------------------------------
  assignRolesBtn.addEventListener('click', () => {
    renderRoles();
    statusMode.textContent = 'Node roles assigned';
  });

  // ---- Comms plan + report (M6) ----------------------------------------
  buildPaceBtn.addEventListener('click', () => {
    lastPlan = buildPace(gatherPaceContext());
    renderPace(lastPlan);
    statusMode.textContent = 'Comms plan ready';
    refreshWorkflowUi();
  });

  exportReportBtn.addEventListener('click', () => {
    if (!lastPlan) return;
    const formats = { pdf: fmtPdf.checked, word: fmtWord.checked, excel: fmtExcel.checked };
    if (!formats.pdf && !formats.word && !formats.excel) {
      exportHelp.textContent = 'Tick at least one format (PDF, Word or Excel) to export.';
      return;
    }
    const { done, popupBlocked } = exportReport(lastPlan, formats);
    exportHelp.textContent = popupBlocked
      ? 'Pop-up blocked — the PDF was saved as a standalone HTML file instead. Allow pop-ups for a direct print view.'
      : `Exported: ${done.join(', ')}. Generated locally — nothing was uploaded.`;
    statusMode.textContent = 'Report exported';
  });

  // ---- Power & endurance (M8) ------------------------------------------
  buildPowerBtn.addEventListener('click', buildPowerPlan);

  // ---- Command palette (M20 §4) -----------------------------------------
  // ⌘K / Ctrl-K or the toolbar search button. Replaces the in-map search box;
  // place + coordinate entry live in its Go-to section.
  palette = createPalette(map, {
    onStatus: (msg) => { statusMode.textContent = msg; },
    providers: [
      {
        key: 'objects',
        title: 'Objects',
        getItems: () =>
          registry.all().map((e) => ({
            label: e.name,
            keywords: e.kind,
            hint: e.kind,
            run() {
              map.flyTo({ center: e.lngLat, zoom: Math.max(map.getZoom(), 13), duration: 800 });
              statusMode.textContent = `Centred on ${e.name}`;
            },
          })),
      },
      {
        key: 'actions',
        title: 'Actions',
        getItems: () => [
          { label: 'Recompute coverage', keywords: 'run analyse rf plot', run: () => runCoverage() },
          { label: 'Clear coverage', keywords: 'remove raster', run: () => clearCoverageBtn.click() },
          { label: 'Recommend sites', keywords: 'masts relay advice', run: () => { jumpToAnchor('siteTitle'); if (!recommendBtn.disabled) recommendBtn.click(); } },
          { label: 'Optimise mast height', keywords: 'antenna height wizard clearance fresnel mast drone', run: () => {
            const rf = ['mast', 'repeater', 'tx', 'drone'].flatMap((k) => registry.byKind(k));
            if (rf.length) mastWizard.openFor(rf[0].id);
            else statusMode.textContent = 'No mast to optimise — place a site or the drone first';
          } },
          { label: 'Build comms plan', keywords: 'pace report', run: () => { jumpToAnchor('paceTitle'); buildPaceBtn.click(); } },
          { label: 'Export report', keywords: 'pdf word excel download', run: () => { jumpToAnchor('paceTitle'); exportReportBtn.click(); } },
          { label: 'Toggle 3D terrain', keywords: 'view tilt relief', run: () => toggle3dBtn?.click() },
          { label: 'Toggle buildings', keywords: 'view extrusion', run: () => buildingsBtn?.click() },
          { label: 'Toggle light / dark theme', keywords: 'appearance mode', run: () => $('#themeToggle')?.click() },
          { label: 'Import data file', keywords: 'kml kmz gpx geojson', run: () => $('#importBtn')?.click() },
          { label: 'Save mission file', keywords: 'groundlink download save export mission', run: () => openSaveDialog() },
          { label: 'Open mission file', keywords: 'groundlink load open mission', run: () => $('#importBtn')?.click() },
          { label: 'Undo', keywords: 'undo revert back', run: () => { const op = undoStack.undo(); statusMode.textContent = op ? `Undone: ${op.label}` : 'Nothing to undo'; } },
        ],
      },
      {
        key: 'focus',
        title: 'Focus',
        getItems: () =>
          TOOLBAR_MODULES.map((m) => ({
            label: `Focus: ${m.label}`,
            keywords: 'fullscreen expand dashboard focus',
            hint: 'fullscreen',
            run: () => focusCtl?.enter(m.anchor),
          })),
      },
      {
        key: 'tabs',
        title: 'Tabs',
        getItems: () =>
          TOOLBAR_MODULES.map((m) => ({
            label: m.label,
            keywords: 'tab open section',
            hint: 'tab',
            run: () => jumpToAnchor(m.anchor),
          })),
      },
    ],
  });

  // ---- Import KML / KMZ / GPX (+ promote to mission input) -------------
  const importInput = $('#importInput');
  const clearImportBtn = $('#clearImportBtn');
  const importPromote = $('#importPromote');
  const importPromoteText = $('#importPromoteText');
  const importPromoteBtns = $('#importPromoteBtns');
  importer = createImportController(map, {
    onStatus(msg) { statusMode.textContent = msg; },
  });
  $('#importBtn').addEventListener('click', () => importInput.click());

  /**
   * One router for every incoming file (picker, drag-drop): mission files go
   * to the M21 loader — by extension, or by content sniff for a renamed plain
   * .json — everything else takes the M16 overlay import path.
   */
  async function handleIncomingFiles(files) {
    let byType = null;
    for (const file of files) {
      if (looksLikeMissionFile(file.name)) {
        loadMissionFromText(await file.text(), file.name);
        continue;
      }
      if (/\.json$/i.test(file.name)) {
        let text = null;
        try {
          text = await file.text();
          if (isMissionData(JSON.parse(text))) {
            loadMissionFromText(text, file.name);
            continue;
          }
        } catch {
          /* not JSON at all — let the importer report it */
        }
      }
      const r = await importer.importFile(file);
      if (r.ok) { clearImportBtn.hidden = false; byType = r.byType; }
    }
    if (byType) offerImportPromotion(byType);
    refreshWorkflowUi(); // imported data retires the empty state
  }

  importInput.addEventListener('change', async () => {
    const files = [...importInput.files];
    importInput.value = ''; // allow re-importing the same file
    await handleIncomingFiles(files);
  });

  // Drag-drop anywhere on the app (M21 §A): same router as the picker.
  const appDropEl = $('#app');
  appDropEl.addEventListener('dragover', (e) => {
    if ([...(e.dataTransfer?.types ?? [])].includes('Files')) {
      e.preventDefault();
      appDropEl.classList.add('is-dropping');
    }
  });
  appDropEl.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget || !appDropEl.contains(e.relatedTarget)) appDropEl.classList.remove('is-dropping');
  });
  appDropEl.addEventListener('drop', (e) => {
    e.preventDefault();
    appDropEl.classList.remove('is-dropping');
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) handleIncomingFiles(files);
  });
  clearImportBtn.addEventListener('click', () => {
    importer.clear();
    clearImportBtn.hidden = true;
    importPromote.hidden = true;
    statusMode.textContent = 'Imported data cleared';
  });

  /** Offer "Use as mission input" buttons appropriate to what was imported. */
  function offerImportPromotion(byType) {
    importPromoteBtns.innerHTML = '';
    const add = (label, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn--sm';
      b.textContent = label;
      b.addEventListener('click', () => { fn(); finishPromotion(); });
      importPromoteBtns.appendChild(b);
    };
    if (byType.lines) add('Lines → route', promoteLinesToRoute);
    if (byType.points) add('Points → sites', () => promotePoints(true));
    if (byType.points) add('Points → demand', () => promotePoints(false));
    if (byType.polygons) add('Polygon → AOI', promotePolygonToAoi);
    if (!importPromoteBtns.children.length) { importPromote.hidden = true; return; }

    const bits = [];
    if (byType.points) bits.push(`${byType.points} point${byType.points > 1 ? 's' : ''}`);
    if (byType.lines) bits.push(`${byType.lines} line${byType.lines > 1 ? 's' : ''}`);
    if (byType.polygons) bits.push(`${byType.polygons} polygon${byType.polygons > 1 ? 's' : ''}`);
    importPromoteText.textContent = `Imported ${bits.join(', ')}. Use as mission input (stays in the browser):`;
    importPromote.hidden = false;
  }

  function promoteLinesToRoute() {
    const line = importer.getFeatures().find((f) => f.geometry?.type === 'LineString');
    if (!line) return;
    mission.setRoute(line.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })));
  }
  function promotePoints(asSites) {
    for (const f of importer.getFeatures()) {
      if (f.geometry?.type !== 'Point') continue;
      const [lng, lat] = f.geometry.coordinates;
      const name = f.properties?.name || '';
      if (asSites) mission.addSite(lat, lng, name);
      else mission.addPoint(lat, lng, name);
    }
  }
  function promotePolygonToAoi() {
    const pg = importer.getFeatures().find((f) => f.geometry?.type === 'Polygon');
    if (pg) aoi.setPolygon(pg.geometry.coordinates[0]);
  }
  // ---- Empty state (M21 §C) — centred starter card on a fresh session ----
  emptyState = createEmptyState(document.querySelector('.map-wrap'), {
    onDrawAoi: () => drawRadiusBtn.click(),
    onPlaceMast: () => {
      jumpToAnchor('missionTitle');
      armMissionMode('sites');
    },
    onOpenMission: () => $('#importBtn')?.click(),
  });

  // Initial state once the modules above exist (covers a restored arsenal).
  refreshWorkflowUi();

  function finishPromotion() {
    // Promoted data now lives in the mission (with its own markers); drop the
    // passive overlay so nothing is shown twice.
    missionTools.refresh();
    if (recommender?.hasSites()) recommender.clear();
    importer.clear();
    clearImportBtn.hidden = true;
    importPromote.hidden = true;
    statusMode.textContent = 'Imported data added to the mission';
  }
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
const digitalModeSelect = $('#digitalModeSelect');
const opacityInput = $('#opacityInput');
const opacityRow = $('#opacityRow');
const clearCoverageBtn = $('#clearCoverage');
const progress = $('#coverageProgress');
const progressBar = $('#coverageProgressBar');
const coverageHelp = $('#coverageHelp');
const coverageEngine = $('#coverageEngine');

// Manual threshold edits should move the Signal legend too (B8).
for (const el of [thExcellent, thGood, thMarginal, thNone]) {
  el?.addEventListener('input', () => updateSignalLegend());
}

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

// Site recommendation (M3)
const recommendBtn = $('#recommendBtn');
const clearSitesBtn = $('#clearSitesBtn');
const siteProgress = $('#siteProgress');
const siteProgressBar = $('#siteProgressBar');
const siteResults = $('#siteResults');
const siteList = $('#siteList');
const siteHelp = $('#siteHelp');

// Mission (M4)
const missionModes = $('#missionModes');
const missionElements = $('#missionElements');
const missionSitesCount = $('#missionSitesCount');
const missionRouteCount = $('#missionRouteCount');
const missionPointsCount = $('#missionPointsCount');
const bulkInput = $('#bulkInput');
const bulkAsSites = $('#bulkAsSites');
const bulkAddBtn = $('#bulkAddBtn');
const bulkReport = $('#bulkReport');

/** Reflect the active mission input mode in the segmented buttons. */
function reflectMissionMode(key) {
  missionModes?.querySelectorAll('[data-mode]').forEach((b) => {
    const on = b.dataset.mode === key;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

/** Arm a mission input mode. Area defers to the AOI Radius/Polygon tools. */
function armMissionMode(key) {
  if (key === 'area') {
    missionTools.setMode(null); // onModeChange reflects 'area'
    statusMode.textContent = 'Area mode — pick Radius or Polygon';
    return;
  }
  aoi.setMode(null);
  syncToolButtons();
  missionTools.setMode(key === 'sites' ? 'site' : key === 'points' ? 'point' : 'route');
  if (mq.matches) closePanel();
}

/** Drive the panel element list + compute/recommend enablement from the model. */
/**
 * Show the Data export section once there is anything to export — a coverage
 * raster, mission data (sites/points/route), waypoints or an AOI (M16/B1).
 */
function refreshExportPanel() {
  const hasCoverage = Boolean(coverage?.hasCoverage?.());
  const hasMission = Boolean(
    (mission?.getSites?.().length ?? 0) ||
    (mission?.getPoints?.().length ?? 0) ||
    (mission?.getRoute?.().length ?? 0) ||
    (waypoints?.getAll?.().length ?? 0) ||
    (recommender?.getSites?.().length ?? 0) ||
    aoi?.getAoi?.(),
  );
  exportPanel?.refresh(hasCoverage || hasMission);
}

function onMissionChange(s) {
  markDirty(); // any mission edit is unsaved work (M21 §A)
  refreshExportPanel();
  if (!missionElements) return;
  const showRow = (type, n) => {
    const row = missionElements.querySelector(`[data-type="${type}"]`);
    if (row) row.hidden = n < 1;
  };
  showRow('sites', s.sites);
  showRow('route', s.route);
  showRow('points', s.points);
  missionElements.hidden = s.sites < 1 && s.route < 1 && s.points < 1;
  missionSitesCount.textContent = String(s.sites);
  missionRouteCount.textContent = String(s.route);
  missionPointsCount.textContent = String(s.points);

  const bbox = mission.bbox();
  // Coverage needs a transmitter source: a fixed site, or an AOI centre.
  computeBtn.disabled = !bbox || (s.sites < 1 && !s.hasAoi);
  // Recommend needs demand: an AOI, a route (≥2 vertices), or explicit points.
  recommendBtn.disabled = !bbox || (!s.hasAoi && s.route < 2 && s.points < 1);
}

/** Split a bulk line into a coordinate (longest parseable prefix) + name. */
function splitCoordName(line) {
  const tokens = line.split(/\s+/);
  for (let n = tokens.length; n >= 1; n--) {
    const coordStr = tokens.slice(0, n).join(' ');
    if (parseCoordinate(coordStr)) return { coord: coordStr, name: tokens.slice(n).join(' ') };
  }
  return { coord: line, name: '' }; // unparseable → reported by line number
}

/** Parse the bulk-add textarea; add points/sites; report bad lines by number. */
function runBulkAdd() {
  const asSites = bulkAsSites.checked;
  const lines = bulkInput.value.split('\n');
  let added = 0;
  const badNums = [];
  const badLines = [];
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const { coord, name } = splitCoordName(line);
    const parsed = parseCoordinate(coord);
    if (!parsed) {
      badNums.push(i + 1);
      badLines.push(raw);
      return;
    }
    if (asSites) mission.addSite(parsed.lat, parsed.lng, name);
    else mission.addPoint(parsed.lat, parsed.lng, name);
    added += 1;
  });
  missionTools.refresh();

  const parts = [];
  if (added) parts.push(`Added ${added} ${asSites ? 'site' : 'point'}${added > 1 ? 's' : ''}.`);
  if (badNums.length) parts.push(`Could not parse line${badNums.length > 1 ? 's' : ''} ${badNums.join(', ')}.`);
  bulkReport.hidden = parts.length === 0;
  bulkReport.textContent = parts.join(' ');
  // Keep only the failed lines so the user can fix them in place.
  bulkInput.value = badLines.join('\n');
  if (added && mq.matches) closePanel();
}

// ---- Radios (M5) --------------------------------------------------------

const recommendMixBtn = $('#recommendMixBtn');
const radioMix = $('#radioMix');

/** DOM handles the radios controller drives. */
function radioEls() {
  return {
    infraLabel: $('#radioInfraLabel'),
    fieldLabel: $('#radioFieldLabel'),
    clearInfraBtn: $('#clearInfraBtn'),
    clearFieldBtn: $('#clearFieldBtn'),
    applyBtn: $('#applyRadios'),
    saveStructureBtn: $('#saveStructureBtn'),
    structuresList: $('#structuresList'),
    searchInput: $('#radioSearchInput'),
    results: $('#radioResults'),
    editor: $('#radioEditor'),
    editorSave: $('#radioEditorSave'),
    editorCancel: $('#radioEditorCancel'),
    fccInput: $('#fccInput'),
    fccBtn: $('#fccLookupBtn'),
    fccFallback: $('#fccFallback'),
    fccOfficial: $('#fccOfficial'),
    fccIo: $('#fccIo'),
    addArsenalBtn: $('#addArsenalBtn'),
    arsenalList: $('#arsenalList'),
    selectAll: $('#radioSelectAll'),
    selCount: $('#radioSelCount'),
    detailPanel: $('#radioDetailPanel'),
    expandEquipment: $('#expandEquipment'),
    overlay: $('#equipmentOverlay'),
    overlayGrid: $('#equipmentGrid'),
    overlayClose: $('#equipmentOverlayClose'),
  };
}

/** Gather the mission + terrain stats the band-mix rules read. */
function gatherMixInput() {
  const aoiArea = aoi?.getAoi?.();
  const aoiAreaKm2 = aoiArea ? currentAoiAreaM2 / 1e6 : 0;
  const route = mission.getRoute();
  let routeLengthKm = 0;
  for (let i = 1; i < route.length; i++) {
    routeLengthKm += haversineM(route[i - 1].lat, route[i - 1].lng, route[i].lat, route[i].lng) / 1000;
  }
  const sites = mission.getSites();
  let maxSiteDistanceKm = 0;
  for (let i = 0; i < sites.length; i++) {
    for (let j = i + 1; j < sites.length; j++) {
      maxSiteDistanceKm = Math.max(
        maxSiteDistanceKm,
        haversineM(sites[i].lat, sites[i].lng, sites[j].lat, sites[j].lng) / 1000,
      );
    }
  }
  const stats = coverage?.getStats?.();
  const coverageFrac = stats?.coveredFracAoi ?? stats?.coveredFrac ?? 0;
  const pointCount = mission.getPoints().length + sites.length;
  return { aoiAreaKm2, routeLengthKm, maxSiteDistanceKm, coverageFrac, pointCount };
}

const PACE_BADGE = { Primary: 'badge--ok', Alternate: 'badge--ref', Contingency: 'badge--warn', Emergency: 'badge--bad' };

/** Render the ranked band list into the mix card. */
function renderMix(result) {
  radioMix.hidden = false;
  radioMix.innerHTML = result.bands
    .map(
      (b) =>
        `<div class="radio-mix__row">` +
        `<span class="radio-mix__band">${b.band}</span>` +
        `<span class="radio-mix__pace badge ${PACE_BADGE[b.pace] || 'badge--ref'}">${b.pace}</span>` +
        `<span class="radio-mix__why">${b.why}</span>` +
        `</div>`,
    )
    .join('');
}

// ---- Node roles (M7) ----------------------------------------------------

const assignRolesBtn = $('#assignRolesBtn');
const rolesList = $('#rolesList');
const rolesHelp = $('#rolesHelp');

const htmlEsc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Mission/terrain context for the role rules (reach drives band tie-breakers). */
function gatherRoleContext() {
  const m = gatherMixInput();
  const reachKm = Math.max(
    m.maxSiteDistanceKm || 0,
    m.routeLengthKm || 0,
    m.aoiAreaKm2 ? Math.sqrt(m.aoiAreaKm2) : 0,
  );
  return { reachKm, urbanFrac: 0, ruggednessM: 0 };
}

/** Assign each node role its best arsenal radio and render the list. */
function renderRoles() {
  const rows = assignRoles(radios.getArsenal(), gatherRoleContext());
  rolesList.hidden = false;
  rolesHelp.hidden = true;
  rolesList.innerHTML = rows
    .map((r) => {
      const has = !!r.radio;
      const bearer = has ? htmlEsc(r.radio.label) : '— none —';
      const alt = r.alternatives.length ? ` · alt: ${htmlEsc(r.alternatives.join(', '))}` : '';
      return (
        `<div class="role-row${has ? '' : ' role-row--gap'}">` +
        `<span class="role-row__name">${htmlEsc(r.label)}</span>` +
        `<span class="role-row__radio">${bearer}<span class="role-row__h"> · ${r.heightM} m AGL</span></span>` +
        `<span class="role-row__why">${htmlEsc(r.why)}${alt}</span>` +
        `</div>`
      );
    })
    .join('');
}

// ---- Comms plan + report (M6) -------------------------------------------

const buildPaceBtn = $('#buildPaceBtn');
const exportReportBtn = $('#exportReportBtn');
const paceResults = $('#paceResults');
const pacePlan = $('#pacePlan');
const paceStructure = $('#paceStructure');
const paceSummary = $('#paceSummary');
const paceHelp = $('#paceHelp');
const exportHelp = $('#exportHelp');
const fmtPdf = $('#fmtPdf');
const fmtWord = $('#fmtWord');
const fmtExcel = $('#fmtExcel');

const capWord = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Assemble the mix + sites + coverage + mission snapshot the PACE engine reads. */
function gatherPaceContext() {
  const mix = recommendMix(gatherMixInput());
  const stats = coverage?.getStats?.();
  const aoiArea = aoi?.getAoi?.();
  const route = mission.getRoute();
  let routeLengthKm = 0;
  for (let i = 1; i < route.length; i++) {
    routeLengthKm += haversineM(route[i - 1].lat, route[i - 1].lng, route[i].lat, route[i].lng) / 1000;
  }
  return {
    mix,
    structures: radios?.getStructures?.() ?? [],
    ewThreat: $('#ewThreat')?.value ?? 'medium',
    cellForPace: $('#cellForPace')?.value ?? 'none',
    sites: {
      fixed: mission.getSites(),
      recommended: recommender?.getSites?.() ?? [],
    },
    coverage: stats
      ? { coveredFrac: stats.coveredFracAoi ?? stats.coveredFrac ?? 0, terrain: !!stats.terrain, clutter: !!stats.clutter }
      : null,
    drone: { relay: !!drone?.hasDrone?.(), altitudeM: drone?.getAltitude?.() ?? null },
    params: {
      freqMHz: clampNum(freqInput.value, 30, 6000, 150),
      powerW: clampNum(powerInput.value, 0.01, 100, 5),
      txHeightM: clampNum(txHeightInput.value, 1, 300, 10),
      rxHeightM: clampNum(rxHeightInput.value, 0.5, 50, 1.5),
      useTerrain: useTerrainInput.checked,
      engine: engineLabel(),
      digitalMode: getDigitalMode(),
    },
    mission: {
      hasAoi: !!aoiArea,
      aoiType: aoiArea?.type ?? null,
      aoiAreaKm2: aoiArea ? currentAoiAreaM2 / 1e6 : 0,
      routeLengthKm,
      points: mission.getPoints().length,
    },
    bom: lastPowerBom,
    build: BUILD,
    generatedAt: new Date().toISOString(),
  };
}

/** Render the four PACE legs + structure + summary into the comms-plan card. */
function renderPace(plan) {
  paceResults.hidden = false;
  paceHelp.hidden = true;
  pacePlan.innerHTML = plan.legs
    .map((l) => {
      const bearer = l.status === 'gap' ? '— not filled —' : l.band || l.asset;
      const tag = l.status === 'separate' ? ' · separate module' : l.status === 'asset' ? ' · asset' : '';
      return (
        `<div class="pace-row${l.status === 'gap' ? ' pace-row--gap' : ''}">` +
        `<span class="pace-tier badge ${PACE_BADGE[l.tier] || 'badge--ref'}">${l.tier}</span>` +
        `<span class="pace-bearer">${bearer}<span class="pace-tag">${tag}</span></span>` +
        `<span class="pace-why">${l.role} — ${l.why}</span>` +
        `</div>`
      );
    })
    .join('');
  const overlay = plan.overlays.length ? ` Overlay: ${plan.overlays.map((o) => o.band).join(', ')}.` : '';
  paceStructure.textContent = `${capWord(plan.structure.topology)} — ${plan.structure.note}${overlay}`;
  paceSummary.textContent = plan.summary;
  exportHelp.textContent =
    'PDF opens a print view (Save as PDF). Word and Excel download to your computer. Generated locally — nothing is uploaded.';
}

// ---- Power & endurance (M8) ---------------------------------------------

const buildPowerBtn = $('#buildPowerBtn');
const powerResults = $('#powerResults');
const powerNodes = $('#powerNodes');
const powerAtak = $('#powerAtak');
const powerBom = $('#powerBom');
const powerHelp = $('#powerHelp');
const powerHours = $('#powerHours');
const powerEveryMin = $('#powerEveryMin');
const powerTxMin = $('#powerTxMin');
const powerContinuousH = $('#powerContinuousH');
const powerBankV = $('#powerBankV');
const powerDroneWh = $('#powerDroneWh');
const powerAtakMa = $('#powerAtakMa');
const powerAtakMah = $('#powerAtakMah');

let lastPowerBom = [];
let lastPowerModel = null; // M21: structured M8 outputs feeding the Power focus dashboard

const ROLE_SUPPLY = Object.fromEntries(NODE_ROLES.map((r) => [r.key, r.power]));
const ROLE_STATIC = Object.fromEntries(NODE_ROLES.map((r) => [r.key, r.mobility === 'static']));
const SUPPLY_BADGE = { battery: 'badge--ref', vehicle: 'badge--warn', mains: 'badge--ok' };
const fmtH = (h) => (Number.isFinite(h) ? (h >= 100 ? String(Math.round(h)) : h.toFixed(1)) : '∞');
const pct = (f) => Math.round((Number.isFinite(f) ? f : 0) * 100);

/**
 * Build the per-node power plan (reusing the M7 role assignment), the ATAK
 * powerbank line and the mission BOM; render them and stash the BOM so the M6
 * report (plan.bom) can pick it up.
 */
function buildPowerPlan() {
  const missionHours = clampNum(powerHours.value, 1, 720, 8);
  const everyMin = clampNum(powerEveryMin.value, 1, 240, 30);
  const txMin = clampNum(powerTxMin.value, 0, 60, 2);
  const continuousOnHours = clampNum(powerContinuousH.value, 0, 72, 0);
  const bankV = clampNum(powerBankV.value, 12, 24, 12);
  const droneWh = clampNum(powerDroneWh.value, 20, 2000, 370);
  const atakMa = clampNum(powerAtakMa.value, 50, 3000, 600);
  const atakMah = clampNum(powerAtakMah.value, 1000, 20000, 5000);
  const lat = map.getCenter().lat;

  const duty = timingsToDuty({ missionHours, windows: [{ everyMin, txMin }], continuousOnHours });
  const nodes = assignRoles(radios.getArsenal(), gatherRoleContext());

  const battNodes = []; // operator DC profiles → BOM operator batteries
  const siteRadios = []; // static mains radios → BOM solar
  const modelRows = []; // M21: structured mirror of the rendered rows

  const rows = nodes.map((n) => {
    const supply = ROLE_SUPPLY[n.key] || 'battery';
    if (!n.radio) {
      modelRows.push({ name: n.label, radio: '—', supply: 'none' });
      return powerRow(n.label, '— none —', supply, 'No radio assigned — add the radios you carry to the Arsenal.');
    }
    if (supply === 'battery') {
      const profile = profileForRadioRole(n.radio.role);
      const e = operatorEndurance(profile, missionHours, duty, 1, n.radio);
      // Fold the radio's native battery into the profile so the BOM roll-up
      // (networkBom → operatorEndurance) sizes against the same capacity.
      const nativeBattery = Number.isFinite(Number(n.radio.batteryMah))
        ? { capacityAh: Number(n.radio.batteryMah) / 1000, voltageV: Number(n.radio.batteryV) || profile.battery?.voltageV }
        : profile.battery;
      battNodes.push({ ...profile, battery: nativeBattery });
      const battNote = n.radio.batteryMah
        ? ` · <b>${n.radio.batteryMah} mAh</b>${n.radio.batteryV ? ` @ ${n.radio.batteryV} V` : ''}${n.radio.batteryModel ? ` (${htmlEsc(n.radio.batteryModel)})` : ''}`
        : '';
      const metrics =
        `<b>${fmtH(e.enduranceHours)} h</b> endurance · ` +
        `<b>${e.batteriesWithSpare}</b> batteries (${e.batteries} + ${e.spare} spare) · ` +
        `recharge ~<b>${fmtH(e.rechargeIntervalH)} h</b> · ` +
        `${profile.className}, ${pct(duty.tx)}/${pct(duty.rx)}/${pct(duty.standby)} duty${battNote}`;
      modelRows.push({
        name: n.label,
        radio: n.radio.label,
        supply,
        enduranceHours: e.enduranceHours,
        batteries: e.batteries,
        spare: e.spare,
        batteriesWithSpare: e.batteriesWithSpare,
        rechargeIntervalH: e.rechargeIntervalH,
      });
      return powerRow(n.label, n.radio.label, supply, metrics);
    }
    if (supply === 'vehicle') {
      modelRows.push({ name: n.label, radio: n.radio.label, supply });
      return powerRow(n.label, n.radio.label, supply,
        'Vehicle-powered (alternator) — no spare battery required; endurance follows the platform.');
    }
    // mains / static → solar/charge budget instead of batteries
    if (ROLE_STATIC[n.key]) siteRadios.push(n.radio);
    const daily = siteEnergyWh(n.radio, 24, 0.3);
    const solar = solarPanelW(daily.energyWh, lat);
    const missionE = siteEnergyWh(n.radio, missionHours, 0.3);
    const bankAh = bankV >= 24 ? missionE.batteryAh24V : missionE.batteryAh12V;
    const metrics =
      `<b>${solar.panelW_rounded} W</b> solar panel · ` +
      `<b>${Math.round(daily.energyWh)} Wh/day</b> (${solar.peakSunHours} h sun @ lat ${lat.toFixed(0)}°) · ` +
      `bank <b>${bankAh.toFixed(1)} Ah</b> @ ${bankV} V buffer for ${missionHours} h`;
    modelRows.push({
      name: n.label,
      radio: n.radio.label,
      supply,
      solarW: solar.panelW_rounded,
      energyWhDay: Math.round(daily.energyWh),
    });
    return powerRow(n.label, n.radio.label, supply, metrics);
  });

  powerNodes.innerHTML = rows.join('');

  // ATAK EUD + powerbank
  const consumed = atakConsumedMah(atakMa, missionHours);
  const rec = powerbankRecommendation(consumed, atakMah);
  powerAtak.innerHTML =
    `<b>ATAK EUD</b> — ${atakMa} mA over ${missionHours} h draws <b>${Math.round(consumed)} mAh</b> ` +
    `(device ${atakMah} mAh). Carry <b>${rec.fullOffBankSizeMah} mAh × ${rec.fullOffBankCount}</b> ` +
    `powerbank${rec.fullOffBankCount === 1 ? '' : 's'} (65% usable). ${htmlEsc(rec.note)}`;

  // Mission BOM roll-up (the M6 report contract → plan.bom)
  const hasDrone = !!drone?.hasDrone?.();
  lastPowerBom = networkBom({
    sites: siteRadios,
    operators: battNodes,
    drone: hasDrone ? { batteryWh: droneWh } : null,
    ataks: [{ drawMa: atakMa, deviceMah: atakMah }],
    missionHours,
    lat,
    duty,
  });
  powerBom.innerHTML = renderBomTable(lastPowerBom, hasDrone);

  // M21: structured mirror for the Power focus dashboard.
  lastPowerModel = {
    missionHours,
    duty,
    rows: modelRows,
    atak: { drawMa: atakMa, deviceMah: atakMah, consumedMah: consumed, bank: rec },
  };
  focusCtl?.refreshDash?.();

  powerResults.hidden = false;
  powerHelp.hidden = true;
  statusMode.textContent = 'Power plan ready';
  return lastPowerBom;
}

function powerRow(name, radioLabel, supply, metricsHtml) {
  const badge = SUPPLY_BADGE[supply] || 'badge--ref';
  const supplyLabel = supply === 'battery' ? 'Battery' : supply === 'vehicle' ? 'Vehicle' : 'Solar/mains';
  const ext = supply !== 'battery' ? ' power-row--ext' : '';
  return (
    `<div class="power-row${ext}">` +
    `<span class="power-row__name">${htmlEsc(name)}</span>` +
    `<span class="power-row__badge badge ${badge}">${supplyLabel}</span>` +
    `<span class="power-row__metrics"><b>${htmlEsc(radioLabel)}</b> — ${metricsHtml}</span>` +
    `</div>`
  );
}

function renderBomTable(bom, hasDrone) {
  if (!bom.length) return '<p class="help">No nodes to roll up yet — add radios to the Arsenal and build the plan.</p>';
  const note = hasDrone ? '' : '<p class="help">Place a drone relay to include airborne-relay batteries.</p>';
  const rows = bom
    .map(
      (l) =>
        `<tr><td>${htmlEsc(l.item)}</td>` +
        `<td class="power-bom__qty">${l.qty}</td>` +
        `<td>${htmlEsc(l.unitSpec)}</td>` +
        `<td class="power-bom__why">${htmlEsc(l.rationale)}</td></tr>`,
    )
    .join('');
  return (
    `<div class="power-bom__title">Mission bill of materials</div>` +
    `<table><thead><tr><th>Item</th><th>Qty</th><th>Spec</th><th>Rationale</th></tr></thead><tbody>${rows}</tbody></table>${note}`
  );
}

// ---- Cellular coverage (M9) ---------------------------------------------

const cellEnabled = $('#cellEnabled');
const cellPanel = $('#cellPanel');
const showCellBtn = $('#showCellBtn');
const clearCellBtn = $('#clearCellBtn');
const cellReadout = $('#cellReadout');
const cellAttribution = $('#cellAttribution');
const cellHelp = $('#cellHelp');
const cellBestNet = $('#cellBestNet');
const cellBestNetValue = $('#cellBestNetValue');
const cellBestNetPin = $('#cellBestNetPin');

/** Checked network types from the cellular type checkboxes. */
function checkedCellTypes() {
  return [...document.querySelectorAll('.cell-type')].filter((c) => c.checked).map((c) => c.value);
}

// ---- Best-network indicator (M22) -----------------------------------------
// Proximity heuristic over the fetched towers: closest tower per operator,
// distance discounted by technology weight (NR/LTE > GSM > UMTS). Probe point
// is the map centre, or the dropped pin while one is set.

let bestNetPin = null; // maplibregl.Marker probe pin (null = use map centre)

const fmtBestNetDist = (m) => (m < 1000 ? `${Math.round(m)} m` : fmtKm(m));

function probePoint() {
  if (bestNetPin) {
    const ll = bestNetPin.getLngLat();
    return { lat: ll.lat, lng: ll.lng };
  }
  const c = map.getCenter();
  return { lat: c.lat, lng: c.lng };
}

function updateBestNet() {
  if (!cellBestNet) return;
  if (!cellular?.hasData() || !cellEnabled.checked) {
    cellBestNet.hidden = true;
    return;
  }
  const best = cellular.bestNetworkAt(probePoint());
  cellBestNet.hidden = !best;
  if (!best) return;
  const gen = CELL_TYPE_DEFAULTS[best.radio]?.label.split(' · ')[1] ?? best.radio;
  // Map centre is the default probe — only flag the pinned case.
  const where = bestNetPin ? ' · at pin' : '';
  cellBestNetValue.textContent = `${best.operator} (${gen}, ${fmtBestNetDist(best.distanceM)})${where}`;
}

function clearBestNetPin() {
  bestNetPin?.remove();
  bestNetPin = null;
  cellBestNetPin?.setAttribute('aria-pressed', 'false');
}

function initBestNetIndicator() {
  map.on('moveend', () => { if (!bestNetPin) updateBestNet(); });

  cellBestNetPin?.addEventListener('click', () => {
    if (bestNetPin) {
      // Toggle off: back to tracking the map centre.
      clearBestNetPin();
      updateBestNet();
      return;
    }
    statusMode.textContent = 'Click map to drop the signal probe pin';
    map.once('click', (e) => {
      const el = document.createElement('div');
      el.className = 'bestnet-pin';
      bestNetPin = new maplibregl.Marker({ element: el }).setLngLat(e.lngLat).addTo(map);
      cellBestNetPin.setAttribute('aria-pressed', 'true');
      statusMode.textContent = 'Signal probe pin set';
      updateBestNet();
    });
  });
}

/** Wire the cellular layer visibility and Show/Clear buttons. */
function initCellularControls() {
  // M23 §2: the Show coverage button is a true toggle. Shown → a click hides
  // the rasters + tower markers without dropping the fetched towers; hidden →
  // a click (re)computes and shows them.
  let cellShown = false;
  const reflectCellBtn = () => {
    showCellBtn.textContent = cellShown ? 'Hide coverage' : 'Show coverage';
    showCellBtn.setAttribute('aria-pressed', String(cellShown));
  };

  cellEnabled.addEventListener('change', () => {
    const on = cellEnabled.checked;
    cellPanel.hidden = !on;
    cellular.setVisible(on);
    if (!on) {
      cellular.clear();
      cellReadout.textContent = '';
      clearBestNetPin();
      cellShown = false;
      reflectCellBtn();
    }
    updateBestNet();
  });

  showCellBtn.addEventListener('click', async () => {
    if (cellShown) {
      cellular.setVisible(false);
      cellShown = false;
      reflectCellBtn();
      statusMode.textContent = 'Cellular coverage hidden';
      return;
    }
    cellEnabled.checked = true;
    cellPanel.hidden = false;
    cellular.setVisible(true);
    const types = checkedCellTypes();
    if (!types.length) {
      cellReadout.textContent = 'Tick at least one network type, then Show coverage.';
      return;
    }
    cellReadout.textContent = 'Fetching towers from OpenStreetMap…';
    statusMode.textContent = 'Cellular: fetching towers…';
    showCellBtn.disabled = true;
    try {
      const result = await cellular.showCoverage(types, {
        useTerrain: useTerrainInput.checked,
        useClutter: useClutterInput.checked,
        maxN: 80,
        aoi: aoi?.getAoi?.() || null,
      });
      const meta = cellular.getMeta();
      if (cellAttribution) cellAttribution.textContent = meta.attribution;
      if (result.count === 0) {
        cellReadout.textContent = 'No cell towers found in view — pan/zoom to a populated area and try again.';
      } else {
        const per = Object.entries(result.totals || {})
          .filter(([, n]) => n > 0)
          .map(([t, n]) => `${CELL_TYPE_DEFAULTS[t].label.split(' · ')[0]} ${n}`)
          .join(' · ');
        cellReadout.textContent = `${result.count} OSM tower${result.count === 1 ? '' : 's'} in view${per ? ` (${per})` : ''}.`;
        cellShown = true;
        reflectCellBtn();
      }
      statusMode.textContent = 'Cellular coverage computing';
      updateBestNet();
    } catch (err) {
      cellReadout.textContent = `Overpass fetch failed: ${err.message}. Check your connection and try again.`;
      statusMode.textContent = 'Cellular fetch error';
    } finally {
      showCellBtn.disabled = false;
    }
  });

  clearCellBtn.addEventListener('click', () => {
    cellular.clear();
    cellReadout.textContent = '';
    cellEnabled.checked = false;
    cellPanel.hidden = true;
    clearBestNetPin();
    updateBestNet();
    cellShown = false;
    reflectCellBtn();
    statusMode.textContent = 'Cellular cleared';
  });

  initBestNetIndicator();
}

/** Render the placed-waypoint chips; click focuses the map, × removes it. */
function renderWaypointList(all) {
  const ul = $('#waypointsList');
  if (!ul) return;
  ul.innerHTML = '';
  ul.hidden = all.length === 0;
  for (const wp of all) {
    const li = document.createElement('li');
    li.className = 'waypoint-chip';
    li.dataset.id = wp.id;
    const name = document.createElement('span');
    name.className = 'waypoint-chip__name';
    name.textContent = wp.name;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'waypoint-chip__del';
    del.textContent = '×';
    del.setAttribute('aria-label', `Delete ${wp.name}`);
    del.addEventListener('click', (e) => { e.stopPropagation(); waypoints?.remove(wp.id); });
    li.appendChild(name);
    li.appendChild(del);
    li.addEventListener('click', () => map.flyTo({ center: [wp.lng, wp.lat], zoom: Math.max(map.getZoom(), 14) }));
    ul.appendChild(li);
  }
}

/** Render the recommended-site rows; hover highlights the marker, click flies to it. */
function renderSiteList(sites) {
  siteList.innerHTML = '';
  sites.forEach((s, i) => {
    const li = document.createElement('li');
    li.className = 'site-list__row';
    li.innerHTML =
      `<span class="site-list__n">#${i + 1}</span>` +
      `<span class="site-list__name">${s.label ?? 'Site'}</span>` +
      `<span class="site-list__elev" data-numeric>${Math.round(s.elevM)} m</span>` +
      `<span class="site-list__new" data-numeric>+${Math.round(s.newlyCovered * 100)}% new</span>` +
      `<span class="site-list__cum" data-numeric>cum ${Math.round(s.cumulativeFrac * 100)}%</span>`;
    li.addEventListener('mouseenter', () => recommender?.setHighlight(i));
    li.addEventListener('mouseleave', () => recommender?.setHighlight(null));
    li.addEventListener('click', () => recommender?.flyTo(i));
    siteList.appendChild(li);
  });
}

function clampNum(v, min, max, fallback) {
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Currently selected digital mode (M15); 'Analogue' when none/unknown. */
function getDigitalMode() {
  const m = digitalModeSelect?.value;
  return MODE_THRESHOLDS[m] ? m : 'Analogue';
}

/**
 * Write a mode's threshold preset into the threshold input fields so
 * coverageParams() (which reads the fields) picks them up. The preset array is
 * [excellent, good, marginal, none, floor]; floor stays the fixed −120 dBm.
 */
function applyModeThresholds(mode) {
  const t = MODE_THRESHOLDS[mode] ?? MODE_THRESHOLDS.Analogue;
  if (thExcellent) thExcellent.value = String(t[0]);
  if (thGood) thGood.value = String(t[1]);
  if (thMarginal) thMarginal.value = String(t[2]);
  if (thNone) thNone.value = String(t[3]);
  updateSignalLegend();
}

/**
 * Keep the Signal legend's dBm labels in sync with the threshold fields —
 * they change via mode presets, "Apply to coverage" and manual edits.
 */
function updateSignalLegend() {
  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  const v = (input, fallback) => clampNum(input?.value, -200, 0, fallback);
  set('legendValExcellent', `≥ ${v(thExcellent, -85)} dBm`);
  set('legendValGood', `≥ ${v(thGood, -95)} dBm`);
  set('legendValMarginal', `≥ ${v(thMarginal, -103)} dBm`);
  set('legendValNone', `< ${v(thNone, -110)} dBm`);
}

/**
 * Resolve the model selector (E2) to the engine the worker runs:
 * 'p1812' | 'fallback'. CloudRF is handled before the worker is involved;
 * 'auto' means P.1812 whenever terrain is on (P.1812 is a terrain model).
 */
function resolveEngine() {
  const b = backendSettings?.getBackend?.() ?? 'builtin';
  if (b === 'p1812') return 'p1812';
  if (b === 'auto' && useTerrainInput.checked) return 'p1812';
  return 'fallback';
}

/** Human label for the engine about to run / just run (result hint + report). */
function engineLabel(engineOverride) {
  const b = backendSettings?.getBackend?.() ?? 'builtin';
  if (!engineOverride && b === 'cloudrf' && backendSettings?.getApiKey?.()) return 'CloudRF ITM';
  const engine = engineOverride ?? resolveEngine();
  if (engine === 'p1812') {
    const { p, pL } = backendSettings?.getPercentiles?.() ?? { p: 50, pL: 50 };
    return `P.1812 · ${p}% time / ${pL}% loc`;
  }
  return useTerrainInput.checked ? 'FSPL+Deygout' : 'FSPL · flat';
}

/** Shared link/engine params (everything except bounds/tx/txHeightM). */
function coverageParams() {
  const freqMHz = clampNum(freqInput.value, 30, 6000, 150);
  const powerW = clampNum(powerInput.value, 0.01, 100, 5);
  const pct = backendSettings?.getPercentiles?.() ?? { p: 50, pL: 50 };
  return {
    eirpDbm: wattsToDbm(powerW) + TX_GAIN_DBI,
    freqMHz,
    rxGainDbi: 0,
    clutterDb: 0,
    engine: resolveEngine(),
    p: pct.p,
    pL: pct.pL,
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

/**
 * Compute window for a coverage run: a square centred on the transmitter whose
 * half-side is the conservative max free-space range, so the raster edge is
 * shaped by the signal physics (round, via below-floor TRANSPARENT cells) rather
 * than the AOI rectangle. The AOI bbox is the floor — never smaller than the
 * drawn area, so the whole AOI always stays visible.
 */
// Upper bound on how far past the AOI the compute window may grow, as a
// multiple of the AOI half-extent. Pure free-space VHF/UHF reaches thousands of
// km before the conservative −120 dBm floor (terrain, not FSPL, is what limits
// terrestrial range), so an uncapped FSPL range would yield invalid latitudes
// and an AOI-dwarfing window. Capping relative to the AOI keeps it prominent
// while still showing signal that genuinely spills beyond it; when the range is
// smaller than this the window tightens to the range and the below-floor
// (TRANSPARENT) cells give the raster its natural round edge.
const WINDOW_CAP_MULT = 3;

// Floor on the half-extent so a single-point / single-site mission still gets a
// window large enough to show the signal, not a sliver around the bbox.
const MIN_HALF_DEG = 0.05; // ≈ 5.5 km

function coverageBoundsFor(bbox, center, params) {
  const halfLat = Math.max((bbox.north - bbox.south) / 2, MIN_HALF_DEG);
  const halfLng = Math.max((bbox.east - bbox.west) / 2, MIN_HALF_DEG);
  const rangeM = maxRangeM(params);
  const dLat = Math.min(rangeM / 111320, WINDOW_CAP_MULT * halfLat);
  const dLng = Math.min(
    rangeM / (111320 * Math.cos((center.lat * Math.PI) / 180)),
    WINDOW_CAP_MULT * halfLng,
  );
  return {
    west: Math.min(center.lng - dLng, bbox.west),
    south: Math.min(center.lat - dLat, bbox.south),
    east: Math.max(center.lng + dLng, bbox.east),
    north: Math.max(center.lat + dLat, bbox.north),
  };
}

function runCoverage() {
  // Single-tx coverage and the M3 multi-site raster share one map layer, so a
  // fresh coverage run supersedes any recommendation — clear stale site markers
  // and the list instead of leaving them floating over the new raster.
  if (recommender?.hasSites()) recommender.clear();
  const params = {
    ...coverageParams(),
    txHeightM: clampNum(txHeightInput.value, 1, 300, 10),
  };
  const sites = mission.getSites();
  const area = aoi?.getAoi?.();
  const bbox = mission.bbox();
  if (!bbox) {
    coverageHelp.textContent = 'Define a mission first — draw an AOI or place a fixed site.';
    return;
  }

  // Transmitter source: fixed sites (multi-tx) take precedence; otherwise the
  // AOI centre is the single transmitter (the M2 default).
  let txs = null;
  let center;
  if (sites.length) {
    txs = sites.map((s) => ({ lat: s.lat, lng: s.lng, txHeightM: params.txHeightM }));
    center = { lat: sites[0].lat, lng: sites[0].lng };
  } else if (area) {
    center = area.center;
  } else {
    coverageHelp.textContent =
      'No transmitter — place a fixed site, or draw an AOI so its centre becomes the tx.';
    return;
  }

  const compBounds = coverageBoundsFor(bbox, center, params);
  const aoiMask = area ? { type: area.type, center: area.center, radiusM: area.radiusM, ring: area.ring } : null;

  const runBuiltin = () => {
    clearCloudRFResult(); // drop any stale CloudRF raster before the built-in paint
    coverage.compute(compBounds, center, params, {
      aoi: aoiMask,
      txs,
      marker: !txs, // multi-site markers stand in for the single tx marker
      files: { ...dataFiles }, // E1: local COGs ride along (in-browser only)
    });
    coverageEngine.textContent = engineLabel(params.engine);
  };

  // M18: when the CloudRF backend is selected (and a key is set), run the hosted
  // ITM job; transparently fall back to the built-in engine on any failure.
  if (backendSettings?.getBackend?.() === 'cloudrf' && backendSettings.getApiKey()) {
    runCloudRF(compBounds, center, params, runBuiltin);
    return;
  }
  runBuiltin();
}

const CLOUDRF_SRC = 'cloudrf';
const CLOUDRF_LAYER = 'cloudrf-layer';

/** Run a CloudRF coverage job and paint it; fall back to built-in on null. */
async function runCloudRF(compBounds, center, params, fallback) {
  const radio = {
    freqMHz: params.freqMHz,
    powerW: clampNum(powerInput.value, 0.01, 100, 5),
    txHeightM: params.txHeightM,
    rxHeightM: params.rxHeightM,
    rxSensDbm: params.thresholds.marginal,
  };
  coverage.clear(); // remove the built-in raster while the hosted job runs
  progress.hidden = false;
  progressBar.style.width = '0%';
  statusMode.textContent = 'CloudRF…';
  let result = null;
  try {
    result = await runCloudRFCoverage({
      apiKey: backendSettings.getApiKey(),
      bounds: compBounds,
      tx: { lat: center.lat, lng: center.lng, txHeightM: params.txHeightM },
      radio,
      onProgress: (frac) => {
        progress.hidden = false;
        progressBar.style.width = `${Math.round(frac * 100)}%`;
        statusMode.textContent = frac >= 1 ? 'Coverage ready' : 'CloudRF…';
      },
    });
  } catch {
    result = null;
  }
  if (!result) {
    // Auth/transport failure — note it and run the built-in engine instead.
    coverageHelp.textContent = 'CloudRF unavailable (check key / network) — using built-in engine.';
    progress.hidden = true;
    progressBar.style.width = '0%';
    fallback();
    return;
  }
  paintCloudRFResult(result);
  planStale = false; // hosted run supersedes any pending stale state
  stalePill.disarm();
  refreshWorkflowUi();
  progress.hidden = true;
  progressBar.style.width = '0%';
  opacityRow.hidden = false;
  coverageEngine.textContent = 'CloudRF ITM';
  coverageHelp.textContent = 'Hosted CloudRF ITM coverage (Longley-Rice over SRTM). Planning-grade, not survey-grade.';
}

/**
 * Paint a CloudRF result PNG as a MapLibre image source, reusing the image-source
 * pattern from coverage.js (TL, TR, BR, BL corner coordinates), sitting just
 * below the AOI outline like the built-in raster.
 */
function paintCloudRFResult({ imageUrl, bounds }) {
  const coordinates = [
    [bounds.west, bounds.north],
    [bounds.east, bounds.north],
    [bounds.east, bounds.south],
    [bounds.west, bounds.south],
  ];
  if (map.getSource(CLOUDRF_SRC)) {
    map.getSource(CLOUDRF_SRC).updateImage({ url: imageUrl, coordinates });
  } else {
    map.addSource(CLOUDRF_SRC, { type: 'image', url: imageUrl, coordinates });
    const beforeId = map.getLayer('aoi-fill') ? 'aoi-fill' : undefined;
    map.addLayer(
      {
        id: CLOUDRF_LAYER,
        type: 'raster',
        source: CLOUDRF_SRC,
        paint: { 'raster-opacity': coverage?.getOpacity?.() ?? 0.7, 'raster-resampling': 'linear', 'raster-fade-duration': 0 },
      },
      beforeId,
    );
  }
}

/** Remove the CloudRF raster (e.g. before a built-in run or on clear). */
function clearCloudRFResult() {
  if (map.getLayer(CLOUDRF_LAYER)) map.removeLayer(CLOUDRF_LAYER);
  if (map.getSource(CLOUDRF_SRC)) map.removeSource(CLOUDRF_SRC);
}

/**
 * Run a coverage pass for one team (M13), keyed to that team's radio when set,
 * then stash the covered fraction back onto the team. Tx source mirrors the
 * single-tx run: fixed sites take precedence, else the AOI centre.
 */
async function runTeamCoverage(team) {
  if (recommender?.hasSites()) recommender.clear();

  // Start from the form's link/engine params, then override freq + EIRP from
  // the team's chosen radio so its band/power shape the footprint.
  const params = { ...coverageParams(), txHeightM: clampNum(txHeightInput.value, 1, 300, 10) };
  const radio = team.radioId ? radios?.getArsenal?.().find((r) => r.id === team.radioId) : null;
  if (radio) {
    if (Number.isFinite(Number(radio.defaultFreqMHz))) params.freqMHz = Number(radio.defaultFreqMHz);
    if (Number.isFinite(Number(radio.powerW))) params.eirpDbm = wattsToDbm(Number(radio.powerW)) + TX_GAIN_DBI;
  }

  const sites = mission.getSites();
  const area = aoi?.getAoi?.();
  const bbox = mission.bbox();
  if (!bbox) {
    coverageHelp.textContent = 'Define a mission first — draw an AOI or place a fixed site.';
    return;
  }
  let txs = null;
  let center;
  if (sites.length) {
    txs = sites.map((s) => ({ lat: s.lat, lng: s.lng, txHeightM: params.txHeightM }));
    center = { lat: sites[0].lat, lng: sites[0].lng };
  } else if (area) {
    center = area.center;
  } else {
    coverageHelp.textContent = 'No transmitter — place a fixed site, or draw an AOI so its centre becomes the tx.';
    return;
  }

  const aoiMask = area ? { type: area.type, center: area.center, radiusM: area.radiusM, ring: area.ring } : null;
  statusMode.textContent = `Coverage for ${team.name}…`;
  coverageEngine.textContent = engineLabel(params.engine);
  const stats = await coverage.computeAsync(coverageBoundsFor(bbox, center, params), center, params, {
    aoi: aoiMask,
    txs,
    marker: !txs,
    files: { ...dataFiles }, // E1
  });
  teamsPanel?.updateTeamCoverage(team.id, stats);
  statusMode.textContent = `${team.name} coverage ready`;
}

// ---- Mission file (M21 §A) ------------------------------------------------
// Save the full mission as a local *.groundlink.json (inputs only — results
// are recomputed on load; never API keys). Load replaces the current state
// (confirm when dirty) and runs the normal analyse path once.

/** Gather the serializable mission state from the domain modules. */
function gatherMissionState() {
  const area = aoi?.getAoi?.() ?? null;
  const droneEntry = registry.byKind('drone')[0] ?? null;
  const basemapCategory = activeBasemapCategory();
  return {
    aoi: area
      ? area.type === 'radius'
        ? { type: 'radius', center: area.center, radiusM: area.radiusM }
        : { type: 'polygon', ring: area.ring }
      : null,
    sites: (mission?.getSites?.() ?? []).map(({ lat, lng, name }) => ({ lat, lng, name })),
    points: (mission?.getPoints?.() ?? []).map(({ lat, lng, name }) => ({ lat, lng, name })),
    route: mission?.getRoute?.() ?? [],
    waypoints: (waypoints?.getAll?.() ?? []).map(({ lat, lng, name, icon }) => ({ lat, lng, name, icon })),
    drone: droneEntry ? { lngLat: [...droneEntry.lngLat], altM: drone?.getAltitude?.() ?? 120 } : null,
    arsenal: radios?.getArsenal?.() ?? [],
    structures: (radios?.getStructures?.() ?? []).map(({ id, name, infraId, fieldId }) => ({ id, name, infraId, fieldId })),
    coverage: {
      freqMHz: clampNum(freqInput.value, 30, 6000, 150),
      powerW: clampNum(powerInput.value, 0.01, 100, 5),
      txHeightM: clampNum(txHeightInput.value, 1, 300, 10),
      rxHeightM: clampNum(rxHeightInput.value, 0.5, 50, 1.5),
      useTerrain: useTerrainInput.checked,
      useClutter: useClutterInput.checked,
      thresholds: coverageParams().thresholds,
      digitalMode: getDigitalMode(),
    },
    pace: { ewThreat: $('#ewThreat')?.value ?? 'medium', cellForPace: $('#cellForPace')?.value ?? 'none' },
    power: {
      hours: clampNum(powerHours.value, 1, 720, 8),
      everyMin: clampNum(powerEveryMin.value, 1, 240, 30),
      txMin: clampNum(powerTxMin.value, 0, 60, 2),
      continuousH: clampNum(powerContinuousH.value, 0, 72, 0),
      bankV: clampNum(powerBankV.value, 12, 24, 12),
      droneWh: clampNum(powerDroneWh.value, 20, 2000, 370),
      atakMa: clampNum(powerAtakMa.value, 50, 3000, 600),
      atakMah: clampNum(powerAtakMah.value, 1000, 20000, 5000),
    },
    teams: teams?.getTeams?.() ?? [],
    basemap: { category: basemapCategory, variant: mapApi.getVariant?.(basemapCategory) ?? null },
    opDatetime: opDatetime?.value || null,
  };
}

/** Replace the app state with a parsed mission and analyse once. */
function applyMissionState(m) {
  applyingMission = true;
  try {
    undoStack.clear(); // history describes the old mission
    // Drop everything on the map — results included, they are recomputed.
    recommender?.clear?.();
    drone?.clear?.();
    coverage?.clear?.();
    clearCloudRFResult();
    clearCliffLayer(map);
    opacityRow.hidden = true;
    for (const wp of waypoints?.getAll?.() ?? []) waypoints.remove(wp.id);
    mission?.clearAll?.();
    aoi?.clear?.();

    // View context first, so the mission lands on the right canvas.
    if (m.basemap?.category) switchBasemap(m.basemap.category, m.basemap.variant ?? undefined);
    if (m.opDatetime && opDatetime) {
      opDatetime.value = m.opDatetime;
      applyDayNight();
    }

    if (m.aoi?.type === 'radius') aoi.setRadius([m.aoi.center.lng, m.aoi.center.lat], m.aoi.radiusM);
    else if (m.aoi?.type === 'polygon') aoi.setPolygon(m.aoi.ring);

    for (const s of m.sites) mission.addSite(s.lat, s.lng, s.name);
    for (const p of m.points) mission.addPoint(p.lat, p.lng, p.name);
    if (m.route.length) mission.setRoute(m.route);
    missionTools?.refresh?.();

    for (const w of m.waypoints) waypoints?.add?.(w.lat, w.lng, w.name, w.icon);

    if (m.drone) {
      drone?.place?.(m.drone.lngLat, m.drone.altM);
      if (droneAlt) {
        droneAlt.value = String(m.drone.altM);
        droneAltVal.textContent = `${m.drone.altM} m`;
      }
    }

    if (m.arsenal.length || m.structures.length) {
      radios?.restore?.({ arsenal: m.arsenal, structures: m.structures });
    }

    const c = m.coverage;
    if (c) {
      if (c.freqMHz != null) freqInput.value = String(c.freqMHz);
      if (c.powerW != null) powerInput.value = String(c.powerW);
      if (c.txHeightM != null) txHeightInput.value = String(c.txHeightM);
      if (c.rxHeightM != null) rxHeightInput.value = String(c.rxHeightM);
      useTerrainInput.checked = Boolean(c.useTerrain);
      useClutterInput.checked = Boolean(c.useClutter);
      const t = c.thresholds ?? {};
      if (t.excellent != null) thExcellent.value = String(t.excellent);
      if (t.good != null) thGood.value = String(t.good);
      if (t.marginal != null) thMarginal.value = String(t.marginal);
      if (t.none != null) thNone.value = String(t.none);
      if (digitalModeSelect && [...digitalModeSelect.options].some((o) => o.value === c.digitalMode)) {
        digitalModeSelect.value = c.digitalMode;
      }
      updateSignalLegend();
    }

    if (m.pace) {
      const ew = $('#ewThreat');
      const cell = $('#cellForPace');
      if (ew) ew.value = m.pace.ewThreat;
      if (cell) cell.value = m.pace.cellForPace;
    }

    if (m.power) {
      const setIf = (el, v) => {
        if (el && v != null) el.value = String(v);
      };
      setIf(powerHours, m.power.hours);
      setIf(powerEveryMin, m.power.everyMin);
      setIf(powerTxMin, m.power.txMin);
      setIf(powerContinuousH, m.power.continuousH);
      setIf(powerBankV, m.power.bankV);
      setIf(powerDroneWh, m.power.droneWh);
      setIf(powerAtakMa, m.power.atakMa);
      setIf(powerAtakMah, m.power.atakMah);
    }

    if (m.teams.length && teams) {
      for (const t of teams.getTeams()) teams.removeTeam(t.id);
      for (const t of m.teams) teams.addTeam(t);
      teamsPanel?.render?.();
    }

    // Bring the mission into view.
    const bbox = mission.bbox();
    if (aoi.getAoi()) aoi.fitBounds({ padding: 80 });
    else if (bbox) {
      map.fitBounds([[bbox.west, bbox.south], [bbox.east, bbox.north]], { padding: 80, maxZoom: 14, duration: 800 });
    }

    refreshWorkflowUi();

    // One analyse run — the same code path as the Analyse button.
    if (!computeBtn.disabled) runCoverage();
  } finally {
    applyingMission = false;
  }
  setDirty(false);
}

/** Parse + confirm + apply mission-file text. Returns true when loaded. */
function loadMissionFromText(text, name) {
  const r = parseMission(text);
  if (!r.ok) {
    statusMode.textContent = r.error;
    return false;
  }
  if (missionDirty && !window.confirm('Replace the current mission? Unsaved changes will be lost.')) {
    statusMode.textContent = 'Mission load cancelled';
    return false;
  }
  applyMissionState(r.mission);
  statusMode.textContent = `Mission loaded from ${name}`;
  return true;
}

/** Serialize and download the mission file (after the dialog confirms). */
function downloadMission() {
  const data = serializeMission(gatherMissionState(), { savedAt: new Date().toISOString() });
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = missionFilename(new Date());
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  setDirty(false);
  statusMode.textContent = 'Mission file saved — keep it local';
}

// Save dialog — the OPSEC warning lives here, before any download happens.
const msaveDialog = $('#msaveDialog');
const msaveName = $('#msaveName');
let msavePrevFocus = null;

function openSaveDialog() {
  if (!msaveDialog) return;
  msaveName.textContent = missionFilename(new Date());
  msavePrevFocus = document.activeElement;
  msaveDialog.hidden = false;
  $('#msaveConfirm')?.focus();
}
function closeSaveDialog() {
  msaveDialog.hidden = true;
  msavePrevFocus?.focus?.();
  msavePrevFocus = null;
}
$('#msaveCancel')?.addEventListener('click', closeSaveDialog);
$('#msaveConfirm')?.addEventListener('click', () => {
  downloadMission();
  closeSaveDialog();
});
msaveDialog?.addEventListener('click', (e) => {
  if (e.target === msaveDialog) closeSaveDialog();
});
// Capture phase: the dialog's Esc must win over focus mode / panel handlers.
document.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Escape' && msaveDialog && !msaveDialog.hidden) {
      e.stopPropagation();
      closeSaveDialog();
    }
  },
  true,
);

// Output-group buttons (Data export section).
$('#saveMissionBtn')?.addEventListener('click', openSaveDialog);
$('#openMissionBtn')?.addEventListener('click', () => $('#importBtn')?.click());

// ---- Global shortcuts: ⌘S save · ⌘Z / ⇧⌘Z undo / redo (M21 §A + §D) -------
document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key === 's' && !e.shiftKey) {
    e.preventDefault(); // the browser's "save page" is never what we want here
    openSaveDialog();
    return;
  }
  if (key !== 'z') return;
  const ae = document.activeElement;
  if (/^(input|textarea|select)$/i.test(ae?.tagName ?? '') || ae?.isContentEditable) return; // native text undo
  e.preventDefault();
  const op = e.shiftKey ? undoStack.redo() : undoStack.undo();
  statusMode.textContent = op
    ? `${e.shiftKey ? 'Redone' : 'Undone'}: ${op.label}`
    : `Nothing to ${e.shiftKey ? 'redo' : 'undo'}`;
});

// ---- Mobile slide-over / phone bottom-sheet panel -----------------------

const app = $('#app');
const panelToggle = $('#panelToggle');
const panel = $('#panel');

// mq: mobile (slide-over on 541–760px, bottom sheet on ≤540px)
const mq = window.matchMedia('(max-width: 760px)');
// mqPhone: true only for actual phones; tablets stay on the desktop layout
const mqPhone = window.matchMedia('(max-width: 540px)');

const panelCollapse = $('#panelCollapse');

const openPanel = () => {
  app.dataset.panel = 'open';
  panelToggle.setAttribute('aria-expanded', 'true');
  // On phone the toggle stays visible; focus a panel control on slide-over only
  if (mq.matches && !mqPhone.matches) panel.querySelector('button, [tabindex]')?.focus();
};
const closePanel = () => {
  app.dataset.panel = 'closed';
  panelToggle.setAttribute('aria-expanded', 'false');
  if (mq.matches) panelToggle.focus();
};

// M19 §5: desktop collapse goes to a 52 px icon strip (persisted) instead of
// a zero-width sliver; the strip + chevron live in src/ui/lpanel.js.
const lpanelCtl = createLeftPanel({
  app,
  strip: $('#panelStrip'),
  collapseBtn: panelCollapse,
  onResize: resize,
  reveal: (anchor) => {
    const k = MODULE_KEY_BY_ANCHOR[anchor];
    if (k) panelGroups.openForModule(k); // group may be collapsed (M20 §2)
    sectionTabs.reveal(anchor);
  },
  // M21 §B: while a section is fullscreen the strip switches focus instead of
  // expanding the panel; the expand chevron exits focus, then expands.
  intercept({ type, module }) {
    if (!focusCtl?.isActive()) return false;
    if (type === 'module') {
      focusCtl.enter(module.anchor);
      return true;
    }
    focusCtl.exit();
    return false;
  },
});

panelToggle.addEventListener('click', () => {
  if (mqPhone.matches) {
    // Phone: bottom-sheet — toggle fully open / fully closed
    if (app.dataset.panel === 'open') closePanel();
    else openPanel();
  } else if (mq.matches) {
    // Tablet slide-over: toggle only opens; X / scrim closes
    openPanel();
  } else {
    // Desktop: collapse / expand the side panel
    lpanelCtl.toggle();
  }
});
// Edge-tab handle on the panel border collapses the panel too.
$('#collapsePanel')?.addEventListener('click', () => lpanelCtl.toggle());
$('#scrim').addEventListener('click', closePanel);
$('#panelClose').addEventListener('click', closePanel);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && mq.matches && app.dataset.panel === 'open') closePanel();
});

// ---- M19 workspace: toolbar · left-panel tabs · context menu · drag -------
// The left menu is the only panel: every section is a tab that opens and
// closes (sliding body); the map keeps the whole right side free.

// Section tabs — every .section header toggles; toolbar icons mirror state.
let toolbarCtl = null; // assigned below; tab restores fire before it exists
const sectionTabs = createSectionTabs($('#panel .panel__body') ?? $('.panel__body'), {
  onChange(key, open) {
    toolbarCtl?.setPressed(key, open);
  },
});

// M20 §2: group headers (Mission / Radios / Analysis / Output) collapse their
// member tabs together; closed set persists in gl.ui.groups.v1.
const panelGroups = createPanelGroups($('#panel .panel__body') ?? $('.panel__body'), { renderBadge });

const MODULE_KEY_BY_ANCHOR = Object.fromEntries(TOOLBAR_MODULES.map((m) => [m.anchor, m.key]));

// M20 §2: per-module badge spans on the section headers (right-aligned).
const sectionBadgeEls = new Map(); // module key -> span
for (const key of ['objects', 'aoi', 'radios', 'coverage']) {
  const head = document.getElementById(MODULE_BY_KEY[key].anchor)?.closest('.section')?.querySelector('.section__head');
  if (!head) continue;
  const span = document.createElement('span');
  span.className = 'gl-badge gl-badge--section';
  span.hidden = true;
  head.appendChild(span);
  sectionBadgeEls.set(key, span);
}

/** Expand the panel + the owning group, open a section's tab, scroll to it. */
function jumpToAnchor(anchorId) {
  if (focusCtl?.isActive()) focusCtl.exit(); // edit-jumps land in the panel, not the surface
  lpanelCtl.setCollapsed(false, { persist: false });
  if (mq.matches) openPanel();
  const moduleKey = MODULE_KEY_BY_ANCHOR[anchorId];
  if (moduleKey) panelGroups.openForModule(moduleKey);
  setTimeout(() => sectionTabs.reveal(anchorId), 180);
}

/** The left-panel section that "owns" an object's settings / edit jump. */
function anchorForEntry(entry) {
  if (entry.owner === 'recommend') return 'siteTitle';
  if (entry.kind === 'drone') return 'droneTitle';
  if (entry.kind === 'marker' || entry.kind === 'waypoint') return 'missionTitle';
  return 'coverageTitle'; // masts/tx: RF params live in the Coverage section
}

const dragMove = initDragMove(map, registry, {
  onLiveCoord(pt) {
    lastCursor = pt;
    renderCursor();
    resultCard.hide(); // §3: the card never blocks the view while dragging
  },
  onStatus(msg) { statusMode.textContent = msg; },
});

const ctxMenu = createContextMenu({
  registry,
  onStatus(msg) { statusMode.textContent = msg; },
  onAction(action, entry) {
    if (action === 'settings') jumpToAnchor(anchorForEntry(entry));
    else if (action === 'move') dragMove.armMove(entry.id);
    else if (action === 'optimise') mastWizard.openFor(entry.id); // M35
  },
});

// ---- Mast-height wizard (M35) — advisory minimum clearing height -----------
// Applying routes through the normal flows: drone altitude via registry.sync
// (→ stale pill), the global tx height via the same objects:changed event the
// settings re-tune path uses. Both push an undo op.
function applyMastHeight(entry, heightM) {
  if (entry.kind === 'drone') {
    const from = drone?.getAltitude?.() ?? 120;
    drone?.setAltitude?.(heightM);
    undoStack.push({
      label: `${entry.name} altitude ${heightM} m`,
      undo: () => drone?.setAltitude?.(from),
      redo: () => drone?.setAltitude?.(heightM),
    });
    statusMode.textContent = `${entry.name}: altitude ${heightM} m AGL applied`;
    return; // setAltitude → registry.sync → objects:changed arms the recompute
  }
  const from = clampNum(txHeightInput.value, 1, 300, 10);
  const setH = (v) => { txHeightInput.value = String(v); };
  setH(heightM);
  undoStack.push({
    label: `Tx height ${heightM} m`,
    undo: () => setH(from),
    redo: () => setH(heightM),
  });
  document.dispatchEvent(new CustomEvent('objects:changed', { detail: { type: 'settings', id: entry.id } }));
  statusMode.textContent = `Tx height ${heightM} m applied (was ${from} m)`;
}

const mastWizard = createMastWizard(document.querySelector('.map-wrap'), {
  registry,
  getAoi: () => aoi?.getAoi?.() ?? null,
  getPoints: () => mission?.getPoints?.() ?? [],
  getFreqMHz: () => clampNum(freqInput.value, 30, 6000, 150),
  getRxHeightM: () => clampNum(rxHeightInput.value, 0.5, 50, 1.5),
  getEirpDbm: () => wattsToDbm(clampNum(powerInput.value, 0.01, 100, 5)) + TX_GAIN_DBI,
  getThresholdDbm: () => clampNum(thMarginal.value, -200, 0, -103),
  getMaxM: (e) => (e.kind === 'drone' ? 120 : 30),
  // E1 seam: the wizard sees the same data the coverage run would — local
  // COGs, the OPFS offline package, or network tiles.
  async buildSamplers(bounds) {
    const dem = await buildElevationSampler({ bounds, cog: dataFiles.elevationCog });
    const clutter = useClutterInput.checked
      ? await buildClutterSampler({ bounds, cog: dataFiles.clutterCog })
      : null;
    return { dem, clutter };
  },
  onApply: applyMastHeight,
  onStatus: (msg) => { statusMode.textContent = msg; },
});

// Object hit-test ahead of the map's coords-only contextmenu popup: markers
// are DOM elements above the canvas, so a capture listener on the container
// sees right-clicks the canvas handler never gets.
map.getContainer().addEventListener(
  'contextmenu',
  (e) => {
    const entry = registry.byElement(e.target);
    if (!entry) return; // empty map → existing coordinate popup
    e.preventDefault();
    e.stopPropagation();
    ctxMenu.openFor(entry.id, e.clientX, e.clientY);
  },
  true,
);

// Objects tab — the registry list + detail in the left panel's first section.
let selectedMarkerEl = null;
const objList = createObjectList(
  {
    list: $('#objList'),
    empty: $('#objListEmpty'),
    detail: $('#objDetail'),
  },
  {
    registry,
    formatCoord: (pt, fmt) => formatCoordinate(pt, fmt ?? COORD_CYCLE[coordFmtIndex]),
    onStatus(msg) { statusMode.textContent = msg; },
    onOpenMenu: (id, x, y) => ctxMenu.openFor(id, x, y),
    onFlyTo(id) {
      const e = registry.get(id);
      if (e) map.flyTo({ center: e.lngLat, zoom: Math.max(map.getZoom(), 13) });
    },
    onSelect(id) {
      selectedMarkerEl?.classList.remove('is-selected');
      selectedMarkerEl = id ? registry.get(id)?.marker?.getElement() ?? null : null;
      selectedMarkerEl?.classList.add('is-selected');
    },
    onEdit(id) {
      const e = registry.get(id);
      if (e) jumpToAnchor(anchorForEntry(e));
    },
    rfSummary(e) {
      if (e.kind === 'drone') return `Alt ${e.settings?.altM ?? drone?.getAltitude?.() ?? '—'} m AGL`;
      return `${freqInput.value} MHz · ${powerInput.value} W · tx ${txHeightInput.value} m`;
    },
  },
);

// ---- M20 workflow state → stepper + badges --------------------------------
// One gather + one refresh: every state-changing path (AOI, registry, arsenal,
// coverage paint/clear, plan build, stale flag) funnels through here.

function gatherUiState() {
  const all = registry.all();
  return {
    aoiSet: Boolean(aoi?.getAoi?.()),
    objectCount: all.length,
    rfObjectCount: all.filter((e) => RF_KINDS.includes(e.kind)).length,
    arsenalCount: radios?.getArsenal?.().length ?? 0,
    hasResult: Boolean(coverage?.hasCoverage?.() || lastPlan || map.getLayer?.(CLOUDRF_LAYER)),
    stale: planStale,
  };
}

function refreshWorkflowUi() {
  const s = gatherUiState();
  toolbarCtl?.updateStepper(planState(s));
  const b = computeBadges(s);
  panelGroups.setBadges(b.groups);
  for (const [key, el] of sectionBadgeEls) renderBadge(el, b.modules[key]);
  lpanelCtl?.setBadges(b.modules);
  focusCtl?.setBadges(b.modules); // M21: surface header badge follows along
  // M21 §C: the starter card retires for good the moment anything exists.
  emptyState?.update({ ...s, importCount: importer?.getFeatures?.().length ?? 0 });
}

// ---- M20 §3: result summary card + stale-plan pill -------------------------

const resultCard = createResultCard(document.querySelector('.map-wrap'), {
  onZoneClick(z) {
    map.flyTo({ center: [z.centroid.lng, z.centroid.lat], zoom: Math.max(map.getZoom(), 12), duration: 800 });
  },
  onRelayAdvice() {
    jumpToAnchor('siteTitle');
    if (!recommendBtn.disabled) recommendBtn.click();
  },
  onReport() {
    jumpToAnchor('paceTitle');
    buildPaceBtn.click();
  },
});

let pendingRecompute = null; // what the armed pill will run (drone vs coverage)
const stalePill = createStalePill(document.querySelector('.map-wrap'), {
  onRecompute() {
    pendingRecompute?.(); // planStale clears when the run paints ('done')
  },
  onCancel() {
    // Plan stays stale: the §2 badge dot and the amber stepper ring remain.
    statusMode.textContent = 'Auto-recompute cancelled — plan is outdated';
  },
});

/** Summarise the last painted raster against the AOI and show the card. */
function showResultCard() {
  if (!lastPaint) return;
  const area = aoi?.getAoi?.();
  const aoiMask = area ? { type: area.type, center: area.center, radiusM: area.radiusM, ring: area.ring } : null;
  resultCard.show(
    summarizeCoverage({ ...lastPaint, aoi: aoiMask, thresholds: coverageParams().thresholds }),
  );
}

// M20 §1: a stepper click jumps to that step's "do this next" tab.
const STEP_ANCHORS = { mission: 'aoiTitle', radios: 'radioTitle', plan: 'coverageTitle' };

toolbarCtl = createToolbar(
  {
    root: $('#toolbar'),
    modulesHost: $('#toolbarModules'),
    stepperHost: $('#planStepper'),
    rightHost: $('#toolbarRight'),
  },
  {
    onModule(m) {
      // Fullscreen focus active: a toolbar module click switches focus (M21).
      if (focusCtl?.isActive()) {
        focusCtl.enter(m.anchor);
        return;
      }
      // Collapsed strip or mobile: always open + reveal; otherwise toggle.
      if (mq.matches || lpanelCtl.isCollapsed()) jumpToAnchor(m.anchor);
      else if (sectionTabs.isOpen(m.anchor)) sectionTabs.setOpen(m.anchor, false);
      else {
        panelGroups.openForModule(m.key); // group may be collapsed (M20 §2)
        sectionTabs.reveal(m.anchor);
      }
    },
    onSearch() { palette?.open(); },
    onBasemap() { railState.toggle('basemap'); }, // M20 §5: open the rail flyout
    onSettings() { jumpToAnchor('coverageTitle'); }, // backend settings live there
    onStep(stepKey) { jumpToAnchor(STEP_ANCHORS[stepKey]); },
  },
);
// Mirror the restored open/closed state onto the toolbar icons.
for (const m of TOOLBAR_MODULES) toolbarCtl.setPressed(m.anchor, sectionTabs.isOpen(m.anchor));

// ---- Focus mode (M21 §B) — any section fullscreen over the map ------------
// Expand button on every section header; the portalled form gets a wide grid;
// Objects and Power get dashboard layouts on top of their existing data.

const objectsDash = createObjectsDash({
  registry,
  formatCoord: (pt) => formatCoordinate(pt, COORD_CYCLE[coordFmtIndex]),
  rfSummary: (e) =>
    e.kind === 'drone'
      ? `alt ${e.settings?.altM ?? drone?.getAltitude?.() ?? '—'} m AGL`
      : `${freqInput.value} MHz · ${powerInput.value} W · tx ${txHeightInput.value} m`,
  onSelect(id) {
    selectedMarkerEl?.classList.remove('is-selected');
    selectedMarkerEl = id ? registry.get(id)?.marker?.getElement() ?? null : null;
    selectedMarkerEl?.classList.add('is-selected');
  },
  onFlyTo(id) {
    const e = registry.get(id);
    if (e) map.flyTo({ center: e.lngLat, zoom: Math.max(map.getZoom(), 13) });
  },
  onOpenMenu: (id, x, y) => ctxMenu.openFor(id, x, y),
  onStatus(msg) { statusMode.textContent = msg; },
});

const powerDash = createPowerDash({
  getModel: () => lastPowerModel,
  buildPlan: () => buildPowerPlan(),
});

let focusReturnCollapsed = false; // panel state to restore on exit
focusCtl = createFocusMode({
  host: document.querySelector('.map-wrap'),
  panelBody: $('#panel .panel__body') ?? $('.panel__body'),
  modules: TOOLBAR_MODULES,
  dashboards: { objectsTitle: objectsDash, powerTitle: powerDash },
  onEnter(key, m, { switched }) {
    if (!switched) focusReturnCollapsed = lpanelCtl.isCollapsed();
    lpanelCtl.setCollapsed(true, { persist: false }); // strip stays for switching
    lpanelCtl.setFocused(m?.key ?? null);
    setTimeout(() => resize(), 200); // map lives on under the surface
    statusMode.textContent = `${m?.label ?? 'Section'} fullscreen — Esc returns to the map`;
  },
  onExit() {
    lpanelCtl.setFocused(null);
    lpanelCtl.setCollapsed(focusReturnCollapsed, { persist: false });
    setTimeout(() => resize(), 200);
    statusMode.textContent = 'Ready';
  },
});

refreshWorkflowUi();

// RF recompute on move/re-tune (M19 §0, made visible by M20 §3): moving or
// re-tuning a tx/mast/repeater/drone marks the plan stale and arms the pill's
// 5 s countdown instead of M19's silent 400 ms debounce. Recommended masts
// are skipped — recommend.js cancels-and-restarts its own combined raster.
document.addEventListener('objects:changed', (ev) => {
  const { type, id } = ev.detail || {};
  if (type !== 'move' && type !== 'settings') return;
  const e = registry.get(id);
  if (!e || !RF_KINDS.includes(e.kind) || e.owner === 'recommend') return;
  if (!coverage?.hasCoverage?.()) return; // nothing painted → nothing to refresh
  if (e.kind !== 'drone' && recommender?.hasSites?.()) return; // recommend owns the raster
  planStale = true;
  resultCard.hide(); // the figures no longer describe the map
  refreshWorkflowUi();
  pendingRecompute = e.kind === 'drone' ? () => drone?.computeRelay() : () => runCoverage();
  stalePill.arm(`${e.name} ${type === 'move' ? 'moved' : 'updated'}`);
});

// Any registry change can move the stepper/badges (add/remove/move/rename).
document.addEventListener('objects:changed', (ev) => {
  const t = ev.detail?.type;
  if (t === 'add' || t === 'move' || t === 'rename' || t === 'remove' || t === 'settings') markDirty();
  refreshWorkflowUi();
});

// The object list shows grid refs in the active coordinate format.
statusCoords.addEventListener('click', () => objList.refresh());

// PWA: service worker, offline indicator, install prompt (M17). On a new
// deploy the tab reloads onto the fresh build (M23) — but never over unsaved
// mission edits; the new worker controls fetches either way, so a deferred
// reload still lands on the new build whenever the user refreshes.
initPwa({ shouldAutoReload: () => !missionDirty });

// Dev-only handle for testing/automation (stripped from production builds).
if (import.meta.env.DEV) {
  window.__gl = {
    map, mapApi,
    get aoi() { return aoi; },
    get coverage() { return coverage; },
    get recommender() { return recommender; },
    get mission() { return mission; },
    get missionTools() { return missionTools; },
    get waypoints() { return waypoints; },
    get teams() { return teams; },
    get radios() { return radios; },
    get drone() { return drone; },
    get cellular() { return cellular; },
    pace: { build: () => buildPace(gatherPaceContext()), get last() { return lastPlan; } },
    power: { build: () => buildPowerPlan() },
    get powerBom() { return lastPowerBom; },
    // M19 workspace handles
    registry,
    objList,
    tabs: sectionTabs,
    lpanel: lpanelCtl,
    get toolbar() { return toolbarCtl; },
    ctxMenu,
    // M20 handles
    groups: panelGroups,
    get palette() { return palette; },
    rail: railState,
    resultCard,
    stalePill,
    refreshWorkflowUi,
    gatherUiState,
    // M21 handles
    get focus() { return focusCtl; },
    get emptyState() { return emptyState; },
    undoStack,
    missionFile: {
      gather: gatherMissionState,
      apply: applyMissionState,
      load: loadMissionFromText,
      serialize: () => serializeMission(gatherMissionState(), { savedAt: new Date().toISOString() }),
    },
  };
}
