import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl from 'maplibre-gl';
import '../styles/index.css';
import { esc as htmlEsc } from './util/esc.js';

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
import { costedBom, bomToCsv } from './power/cost.js';
import { buildPace } from './pace/pace.js';
// report.js (HTML/Word/Excel writers) loads lazily on the export click —
// startup never needs it.
// hf-panel.js (M12 ionosphere model + chart) loads lazily after boot —
// non-critical UI, ~6 kB minified off the startup path.
import { createPalette } from './ui/search.js';
import { createImportController } from './io/import.js';
import { createExportPanel } from './export/export-panel.js';
// M37: brief.js loads lazily on first use (generateBrief + openBrief)
// to keep the startup bundle small. See openMissionBrief() below.
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
import { createOpsDashboard } from './ui/dash-ops.js'; // M36
import { createSatcomPanel } from './ui/satcom-panel.js'; // M38
import { satcomAssessment } from './connectivity/satcom.js'; // M47: best satcom status
import { createDeconflictPanel } from './ui/deconflict-panel.js'; // M39
import { generateFreqPlan, openFreqPlan } from './export/freq-plan.js'; // M40
import { createTopologyPanel } from './ui/topology.js'; // M41
import { optimizeDroneHeight, DEFAULT_ALTITUDES } from './analysis/drone-optimizer.js'; // M42
import { generateGapReport, openGapReport } from './export/gap-report.js'; // M43
import { suggestRadios } from './analysis/radio-suggest.js'; // M46
import { createRadioSuggestPanel } from './ui/radio-suggest-panel.js'; // M46
import {
  computeReadiness, dimCoverage, dimPace, dimDeconfliction,
  dimLinkQuality, dimSatcom,
} from './analysis/readiness.js'; // M47
import { createEmptyState } from './ui/emptystate.js';
import { createUndoStack } from './ui/undo.js';
import { wattsToDbm, maxRangeM, haversineM, MODE_THRESHOLDS, fsplDb, receivedDbm } from './coverage/model.js';
import { BASEMAP_VARIANTS } from './map/basemaps.js';
import { HIRES_SOURCES, createCoverageMemory } from './map/hires-imagery.js';
import { createMapNotice } from './ui/map-notice.js';
import { describeAssumptions, cellSizeM } from './analysis/assumptions.js';
import { ANTENNA_PRESETS, normalizeAntenna, isOmni, antennaText } from './coverage/antenna.js';
import { LIMITS, isLatLng, missionSpanProblem } from './geo/validate.js';
import { terrainCredit } from './data/terrain-tiles.js';
import { setOvertureBuildings } from './map/pmtiles.js';
import { packageAoi, readManifest, clearOfflinePack } from './data/offline.js';
import { buildElevationSampler, buildClutterSampler } from './data/sources.js';
import { landcoverReasonText } from './workers/worldcover.js';
import { createMastWizard } from './ui/mast-wizard.js';
import { copyText } from './util/clipboard.js';
// analysis/calibration.js (M27) loads lazily on the first CSV import /
// calibration export — see calMod() below.

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

const mapApi = initMap($('#map'), { onBasemapFailover: handleBasemapFailover, onHiresResult: handleHiresResult });
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
    copyText(text).then((ok) => { statusMode.textContent = ok ? 'Coordinate copied' : 'Copy failed — clipboard not available here'; });
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
  getEirp: () => wattsToDbm(clampNum($('#powerInput')?.value, 0.01, 100, 5)) + txGainDbi(),
  onProfile(data) { profilePanel.show(data); },
  onStatus(msg) { statusMode.textContent = msg; },
  onDone: reflectProfileBtn,
});

profileToolBtn?.addEventListener('click', () => {
  if (profileTool.isActive()) {
    profileTool.deactivate();
  } else {
    // Review F21: one map tool at a time — drop an armed waypoint placement.
    if (waypoints?.isPlacing?.()) {
      waypoints.cancelPlacing();
      $('#placeWaypointBtn')?.classList.remove('is-active');
    }
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

/** Switch category (and optionally variant). A deliberate choice clears any failover notice. */
function switchBasemap(category, variantId) {
  const result = mapApi.setBasemap(category, variantId);
  reflectBasemap(result.category);
  mapNotice?.hide();
}

// ---- High-resolution aerial: which source is really on screen --------------
// The tile handler reports every source that delivered real imagery, with the
// tile position. A source counts as "showing" when it has delivered imagery
// inside the current view, so the readout follows panning and still holds when
// MapLibre redraws from its own cache. (Bounding rectangles alone would credit
// the wrong country near a border.)
const hiresMemory = createCoverageMemory();
let hiresStatusTimer = 0;
function handleHiresResult({ id, real, z, x, y }) {
  if (!real) return;
  hiresMemory.record(id, z, x, y);
  window.clearTimeout(hiresStatusTimer);
  hiresStatusTimer = window.setTimeout(updateHiresStatus, 700);
}
mapApi.map.on('idle', () => window.setTimeout(() => updateHiresStatus(), 800));
function updateHiresStatus() {
  const showing = mapApi.isHiresOn() && mapApi.getBasemap() === 'imagery';
  let live = [];
  if (showing) {
    const b = mapApi.map.getBounds();
    const ids = new Set(hiresMemory.inView({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }));
    live = HIRES_SOURCES.filter((s) => ids.has(s.id));
  }
  // Credit only the providers whose imagery is really in view (licence terms
  // require the credit; listing eleven at once buries it).
  mapApi.setHiresCredits(live.map((s) => s.attribution));
  const el = document.getElementById('hiresNow');
  if (!el) return;
  if (!showing) { el.textContent = ''; return; }
  el.textContent = live.length
    ? `Showing: ${live.map((s) => `${s.label} · ${s.resolution}`).join(', ')}`
    : 'No national aerial imagery in this view. Showing the global layer.';
}

// ---- Basemap provider failover notice -------------------------------------
// map.js detects an unreachable imagery provider and moves to another source;
// this tells the user what happened and offers a retry. Hoisted: initMap()
// above may report a provider that was already known to be down at startup.
let mapNotice = null;
function handleBasemapFailover(info) {
  mapNotice ??= createMapNotice(document.querySelector('.map-wrap'));
  const { kind, from, to } = info;
  if (kind !== 'none') {
    reflectBasemap(mapApi.getBasemap());
    if (railState?.current?.() === 'basemap') renderVariantMenu();
  }
  const retry = { label: `Try ${from.label} again`, onClick: () => switchBasemap(from.category, from.variantId) };
  const note = to ? BASEMAP_VARIANTS[to.category]?.find((v) => v.id === to.variantId)?.note : null;
  let message;
  if (kind === 'none') {
    message = `${from.label} can't be reached from this network and no other map source is available. Check your connection.`;
  } else if (kind === 'degraded') {
    message = `No satellite imagery source can be reached from this network, so the map switched to ${to.label}.`;
  } else {
    message = `${from.label} can't be reached from this network, so the map switched to ${to.label}.${note ? ` ${note}` : ''}`;
  }
  mapNotice.show({ message, tone: 'warn', actions: [retry] });
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

  if (category === 'imagery') {
    const row = document.createElement('label');
    row.className = 'basemap-hires';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.id = 'hiresToggle';
    box.checked = mapApi.isHiresOn();
    box.addEventListener('change', () => { mapApi.setHires(box.checked); updateHiresStatus(); });
    const text = document.createElement('span');
    text.textContent = 'National aerial photos where available (off: Esri only)';
    row.append(box, text);
    variantMenu.appendChild(row);
    const now = document.createElement('div');
    now.id = 'hiresNow';
    now.className = 'basemap-hires__now';
    variantMenu.appendChild(now);
    const cov = document.createElement('div');
    cov.className = 'basemap-hires__cov';
    cov.textContent = `National aerial programmes: ${HIRES_SOURCES.map((s) => s.short).join(', ')}. Elsewhere the global layer (10 m) is the sharpest open imagery.`;
    variantMenu.appendChild(cov);
    const terms = document.createElement('div');
    terms.className = 'basemap-hires__cov basemap-hires__terms';
    terms.textContent =
      'Terms: intended for research and other non-commercial use. Esri imagery stays under Esri\'s own terms, needs its credit, and is never stored offline by this app. ' +
      'Sentinel-2 is CC BY-NC-SA (non-commercial). National aerial sources are open data under each provider\'s terms. Check them before any commercial use.';
    variantMenu.appendChild(terms);
    updateHiresStatus();
  }

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
  ops: { btn: $('#railOpsBtn'), panel: $('#railFlyoutOps') }, // M36
  basemap: { btn: $('#railBasemapBtn'), panel: $('#railFlyoutBasemap') },
  view: { btn: $('#railViewBtn'), panel: $('#railFlyoutView') },
  data: { btn: $('#railDataBtn'), panel: $('#railFlyoutData') }, // E1
};

const railState = createRailState({
  onChange(current) {
    for (const [key, f] of Object.entries(railFlyouts)) {
      if (!f.btn || !f.panel) continue;
      const open = current === key;
      f.panel.hidden = !open;
      f.btn.setAttribute('aria-expanded', String(open));
      f.btn.classList.toggle('is-active', open);
    }
    if (current === 'basemap') renderVariantMenu();
    if (current === 'ops') opsDash?.show(); // M36: render on open
    else opsDash?.hide();
  },
});

railFlyouts.ops?.btn?.addEventListener('click', () => railState.toggle('ops')); // M36
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
  const spread = missionSpanProblem(bbox);
  if (spread) {
    offlineStatus.textContent = spread;
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
// M27 field calibration — fitted per-radio offsets; offsets + choice persist
// (gl.calibration.v1, try/catch), measurement points stay in-memory only.
const CAL_STORE_KEY = 'gl.calibration.v1';
const calState = { fits: [], samples: [], offsets: {}, formRadioId: null, applied: false };
let hfPanel = null; // M12 HF ionosphere panel
let satPanel = null; // M38 satcom look-angle panel
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
let lastSatcomStatus = null; // M47: best GEO satellite status ('ok'|'warn'|'marginal'|null)

// M45: Compute FSPL-based link-budget margin per topology edge.
// Uses assigned radios' RF parameters and the AOI reach distance as the
// worst-case link span. Returns { 'hq:rebro-static': { marginDb, model }, … }.
function computeLinkMargins() {
  const arsenal = radios?.getArsenal?.() ?? [];
  const ctx = gatherRoleContext();
  const reachM = Math.max((ctx.reachKm ?? 5) * 1000, 500);
  if (!arsenal.length) return {};

  const roles = assignRoles(arsenal, ctx);
  const roleMap = Object.fromEntries(roles.map((r) => [r.key, r]));

  const EDGES = [
    ['hq', 'rebro-static'],
    ['hq', 'rebro-mobile'],
    ['rebro-static', 'mobile-cp'],
    ['rebro-mobile', 'mobile-cp'],
    ['mobile-cp', 'operator'],
  ];

  const margins = {};
  for (const [fromKey, toKey] of EDGES) {
    const fromRole = roleMap[fromKey];
    const toRole   = roleMap[toKey];
    if (!fromRole?.radio || !toRole?.radio) continue;

    // Use the weaker radio's TX for worst-case budget
    const txW    = Math.min(fromRole.radio.txMaxW ?? 5, toRole.radio.txMaxW ?? 5);
    const freqMHz = fromRole.radio.defaultFreqMHz
      ?? fromRole.radio.freqRangeMHz?.[0]
      ?? 150;
    const rxSens = Math.max(
      fromRole.radio.rxSensDbm ?? -110,
      toRole.radio.rxSensDbm  ?? -110,
    );

    const eirpDbm  = 10 * Math.log10(Math.max(txW, 0.001) * 1000);
    const rxDbm    = receivedDbm({ eirpDbm, freqMHz }, reachM);
    const marginDb = rxDbm - rxSens;

    margins[`${fromKey}:${toKey}`] = {
      marginDb: Math.round(marginDb * 10) / 10,
      model: 'FSPL',
    };
  }
  return margins;
}

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

// Run once the style exists. `isStyleLoaded()` and the map 'load' event also wait
// for the first basemap TILES, so a slow or blocked imagery provider used to
// leave the whole app (AOI, mission tools, toolbar wiring) dead. Nothing here
// needs tiles, only the style, so 'style.load' is enough; 'load' stays as the
// backstop and the guard makes `fn` run exactly once.
function whenStyleReady(fn) {
  let ran = false;
  const run = () => { if (!ran) { ran = true; fn(); } };
  if (map.isStyleLoaded()) { run(); return; }
  map.once('style.load', run);
  map.once('load', run);
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
      hfPanel?.refresh(); // HF planning follows the mission centre
      refreshSatcom(); // M38: satcom look angles too
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
  (async () => {
    const host = $('#hfPanelInner');
    if (!host) return;
    const { createHfPanel } = await import('./hf/hf-panel.js');
    let hf;
    const refresh = () => {
      const p = hf.getParams();
      const c = missionCentre();
      hf.update(c?.lat ?? 51.5, c?.lng ?? 0, p.dt, p.pathKm, p.solarCycle);
    };
    hf = createHfPanel(host, { onParamsChange: refresh });
    hfPanel = { refresh };
    refresh();
  })();

  // M38: Satcom panel — GEO look angles + LEO system availability.
  // Pure-math, no API calls. Follows the mission centre (refreshSatcom).
  (() => {
    const host = $('#satcomPanelInner');
    if (!host) return;
    satPanel = createSatcomPanel(host, {
      onCentroidNeeded: () => {
        // Scroll the mission section into view so user can draw an AOI
        document.querySelector('#areaTitle')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
    });
    refreshSatcom(); // seed from whatever mission already exists (file load)
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
      updateIntelChip('running'); // Maven intel chip
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
        updateOpsDash(); // M36
        updateIntelChip('idle'); // Maven intel chip
      }
      if (state === 'done') {
        planStale = false; // a fresh run supersedes any pending stale state
        stalePill.disarm();
        showResultCard();
        if (runAllPending) finishRunAll(); // E3c: chain relay + PACE after coverage
        // M45: compute link margins now that we know the AOI reach
        lastLinkMargins = computeLinkMargins();
        if ($('#topologyDetails')?.open) topoPanel?.update();
        updateOpsDash(); // M36
        updateReadinessBadge(); // M47
        updateIntelChip('ok'); // Maven intel chip
      }
      if (state === 'cleared' || state === 'done') refreshServerViewUi(); // M24
      if (state === 'cleared' || state === 'done') refreshWorkflowUi();
      if (state === 'error') {
        coverageHelp.textContent = 'Coverage worker failed — see console.';
        showToast('Coverage compute failed — see browser console for details');
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
        else if (terrain && info?.elevSource) bits.push(`Terrain: ${terrainCredit(info.elevSource)}.`);
        if (useClutterInput.checked) {
          bits.push(clutter
            ? clutterSourceText(info?.clutterSource)
            : `No clutter in this run: ${landcoverReasonText(info?.clutterError)}. Run again, or load a local COG in the Data flyout.`);
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
      onStatus(state, info) {
        if (state === 'error') {
          const why = info?.message ? ` (${info.message})` : '';
          cellHelp.textContent = `Cellular worker failed${why} — see console.`;
          // Also surface in the primary readout: cellHelp is easy to miss.
          if (cellReadout) cellReadout.textContent = `Coverage compute failed${why}. See the browser console for details.`;
          showToast(`Cellular coverage failed${why}`);
        }
      },
    });
  }
  cellular = createCellularController(map, cellCoverages, {
    onStatus(state, info) {
      if (state === 'loading') {
        if (cellReadout) cellReadout.textContent = 'Loading towers (snapshot, else OpenStreetMap)…';
      } else if (state === 'error') {
        if (cellReadout) cellReadout.textContent = `Error: ${info?.message || 'Tower fetch failed.'}`;
        showToast(`Cellular data unavailable — ${info?.message || 'tower fetch failed'}`);
      }
      // 'computing' and 'empty' states are handled in the showCellBtn click handler
    },
  });
  initCellularControls();
  initCalibrationControls();

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
      statusMode.textContent = m ? `Placing ${m}` : 'Ready';
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
      if (profileTool.isActive()) { profileTool.deactivate(); reflectProfileBtn(); } // F21
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
  runAllBtn?.addEventListener('click', runAll); // E3c
  briefBtn?.addEventListener('click', () => openMissionBrief()); // M37

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
    const spread = missionSpanProblem(bbox);
    if (spread) {
      siteResults.hidden = false;
      siteList.innerHTML = '';
      siteHelp.textContent = spread;
      return;
    }
    const params = omniParams({ ...coverageParams(), txHeightM: clampNum(txHeightInput.value, 1, 300, 10) });
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
      decoPanel?.update(radios.getArsenal()); // M39: re-run freq deconfliction
      updateSuggestPanel?.(); // M46: re-score on arsenal change (fn defined later)
      // M47: recompute readiness on arsenal/deconflict change
      // Use setTimeout to ensure decoPanel has updated first
      setTimeout(() => updateReadinessBadge?.(), 0);
    },
  });

  // ---- M39: Freq deconfliction panel -------------------------------------
  let decoPanel = null;
  (() => {
    const host = $('#deconflictPanel');
    if (!host) return;
    decoPanel = createDeconflictPanel(host);
    // Seed with current arsenal (might be empty on first load)
    decoPanel.update(radios?.getArsenal?.() ?? []);
  })();

  // ---- M40: Freq plan export button -------------------------------------
  const freqPlanBtn = $('#freqPlanBtn');
  freqPlanBtn?.addEventListener('click', async () => {
    const { generateFreqPlan: gen, openFreqPlan: open } = await import('./export/freq-plan.js');
    const html = gen({
      arsenal: radios?.getArsenal?.() ?? [],
      paceLegs: lastPlan?.legs ?? [],
      missionName: 'GroundLink Mission',
      buildVersion: `${BUILD.version}+${BUILD.sha}`,
    });
    open(html);
    statusMode.textContent = 'Freq plan opened — Ctrl+P to print';
  });

  // ---- M41+M45: Network topology panel with link-quality edges ----------
  let topoPanel = null;
  // M45: last computed link margins, updated after each coverage run.
  // Shape: { 'hq:rebro-static': { marginDb: 14.2, model: 'FSPL' }, … }
  let lastLinkMargins = {};

  (() => {
    const host = $('#topologyPanel');
    if (!host) return;
    topoPanel = createTopologyPanel(host, {
      getArsenal: () => radios?.getArsenal?.() ?? [],
      getLastPlan: () => lastPlan,
      getRoleContext: () => gatherRoleContext(),
      getLinkMargins: () => lastLinkMargins, // M45
    });
    // Render on first open of the details element
    const details = $('#topologyDetails');
    details?.addEventListener('toggle', () => {
      if (details.open) topoPanel.update();
    }, { once: true });
  })();

  // ---- M46: Smart radio-to-node suggestion panel -----------------------
  let suggestPanel = null;
  (() => {
    const host = $('#radioSuggestPanel');
    if (!host) return;
    suggestPanel = createRadioSuggestPanel(host, {
      onApply({ roleKey, radio }) {
        // Advisory assignment: mark dirty so plan can be rebuilt
        statusMode.textContent = `${radio.label} suggested for ${roleKey} — assign via Roles panel`;
        markDirty();
      },
    });
    updateSuggestPanel();
  })();

  function updateSuggestPanel() {
    if (!suggestPanel) return;
    const arsenal = radios?.getArsenal?.() ?? [];
    const ctx = gatherRoleContext();
    const roles = assignRoles(arsenal, ctx);
    const suggestions = suggestRadios(arsenal, roles, ctx);
    suggestPanel.update(suggestions);
  }

  // ---- M47: Readiness score toolbar badge init -------------------------
  const intelScoreBadge = $('#intelScoreBadge');
  const intelScoreNum   = $('#intelScoreNum');

  function updateReadinessBadge() {
    const covData = lastPaint
      ? summarizeCoverage({
          ...lastPaint,
          aoi: (() => { const a = aoi?.getAoi?.(); return a ? { type: a.type, center: a.center, radiusM: a.radiusM, ring: a.ring } : null; })(),
          thresholds: coverageParams().thresholds,
        })
      : null;

    // Deconfliction compares radios with each other: with fewer than two there is
    // nothing to check, and "no conflicts" must not count as a passed check.
    const arsenal = radios?.getArsenal?.() ?? [];
    const decoSummary = decoPanel?.check(arsenal);
    const decoConflicts = decoSummary && arsenal.length >= 2
      ? Array.from({ length: decoSummary.errors }, () => ({ severity: 'error' }))
          .concat(Array.from({ length: decoSummary.warnings }, () => ({ severity: 'warn' })))
      : null;

    const dims = {
      coverage:      dimCoverage(covData),
      pace:          dimPace(lastPlan),
      deconfliction: dimDeconfliction(decoConflicts),
      linkQuality:   dimLinkQuality(Object.keys(lastLinkMargins).length ? lastLinkMargins : null),
      power:         null, // wired when power dash exposes minEnduranceH
      satcom:        dimSatcom(lastSatcomStatus ? { bestStatus: lastSatcomStatus } : null),
    };
    const result = computeReadiness(dims);

    if (result.score == null) {
      if (intelScoreBadge) {
        intelScoreBadge.className = 'intel-score-badge';
        intelScoreBadge.removeAttribute('title');
      }
      if (intelScoreNum) intelScoreNum.textContent = '—';
      updateOpsDashReadiness(result); // dashboard explains why there is no score yet
      return;
    }

    const tier = result.tier;
    if (intelScoreBadge) {
      intelScoreBadge.className = `intel-score-badge is-visible intel-score-badge--${tier}`;
      intelScoreBadge.title = `Mission readiness: ${result.score}/100 (${tier}), based on ${result.assessed} of ${result.total} checks. Open Ops Dashboard for breakdown.`;
    }
    if (intelScoreNum) intelScoreNum.textContent = result.score;
    updateOpsDashReadiness(result);
  }

  function updateOpsDashReadiness(readiness) {
    opsDash?.update({ readiness });
  }

  // ---- M42: Drone height optimizer -------------------------------------
  const optimizeDroneBtn = $('#optimizeDroneHeight');
  const droneOptPanel = $('#droneOptPanel');

  optimizeDroneBtn?.addEventListener('click', async () => {
    if (!drone?.hasDrone?.()) {
      statusMode.textContent = 'Place a drone relay first';
      return;
    }
    const pos = { lng: drone.hasDrone() ? coverage.getStats?.()?.lng : null, lat: null };
    // Get drone position from registry
    const droneEntry = registry.byKind('drone')[0];
    if (!droneEntry) { statusMode.textContent = 'No drone placed'; return; }

    if (droneOptPanel) {
      droneOptPanel.hidden = false;
      droneOptPanel.innerHTML = '<div class="drone-opt-progress">Sampling altitudes…</div>';
    }
    statusMode.textContent = 'Optimizing drone altitude…';

    try {
      const bounds = (() => {
        const a = aoi?.getAoi?.();
        if (a) return a.bounds ?? a;
        const { lng, lat } = droneEntry.lngLat ? { lng: droneEntry.lngLat[0], lat: droneEntry.lngLat[1] } : { lng: 0, lat: 0 };
        const r = 30 / 111;
        return { west: lng - r, south: lat - r, east: lng + r, north: lat + r };
      })();
      const dronePos = { lng: droneEntry.lngLat[0], lat: droneEntry.lngLat[1] };

      const { best, results } = await optimizeDroneHeight({
        dronePos,
        altitudes: DEFAULT_ALTITUDES,
        bounds,
        baseParams: coverageParams(),
        computeAsync: (b, tx, p, opts) => coverage.computeAsync(b, tx, p, opts),
        onProgress(done, total) {
          statusMode.textContent = `Optimizing… ${done}/${total} altitudes`;
          if (droneOptPanel) droneOptPanel.innerHTML = `<div class="drone-opt-progress">Testing ${done}/${total} altitudes…</div>`;
        },
      });

      // Render bar chart
      if (droneOptPanel) {
        const maxFrac = Math.max(...results.map((r) => r.coveredFrac), 0.01);
        const bars = results.map((r) => {
          const isBest = r.altM === best.altM;
          const h = Math.max(4, Math.round((r.coveredFrac / maxFrac) * 64));
          return `<div class="drone-opt-bar${isBest ? ' drone-opt-bar--best' : ''}">
            <div class="drone-opt-bar__fill" style="height:${h}px"></div>
            <div class="drone-opt-bar__pct">${Math.round(r.coveredFrac * 100)}%</div>
            <div class="drone-opt-bar__alt">${r.altM}m</div>
          </div>`;
        }).join('');
        droneOptPanel.innerHTML =
          `<div class="drone-opt-chart">${bars}</div>` +
          `<div class="drone-opt-result">Optimal: ${best.altM} m AGL — ${Math.round(best.coveredFrac * 100)}% coverage</div>`;
      }

      // Apply best altitude
      drone.setAltitude(best.altM);
      if (droneAlt) { droneAlt.value = String(best.altM); droneAltVal.textContent = `${best.altM} m`; }
      statusMode.textContent = `Optimal altitude: ${best.altM} m AGL (${Math.round(best.coveredFrac * 100)}% coverage)`;
    } catch (err) {
      console.error('[M42] drone optimize error', err);
      if (droneOptPanel) droneOptPanel.innerHTML = '<div class="drone-opt-progress">Error — check console</div>';
      statusMode.textContent = 'Altitude optimisation failed';
    }
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
    topoPanel?.update(); // M41: topology reflects new role assignments
    updateSuggestPanel(); // M46: re-score suggestions after role assignment
  });

  // ---- Comms plan + report (M6) ----------------------------------------
  buildPaceBtn.addEventListener('click', () => {
    lastPlan = buildPace(gatherPaceContext());
    renderPace(lastPlan);
    statusMode.textContent = 'Comms plan ready';
    refreshWorkflowUi();
    updateOpsDash(); // M36
    topoPanel?.update(); // M41: refresh topology when PACE changes
    updateReadinessBadge?.(); // M47
  });

  exportReportBtn.addEventListener('click', async () => {
    if (!lastPlan) return;
    const formats = { pdf: fmtPdf.checked, word: fmtWord.checked, excel: fmtExcel.checked };
    if (!formats.pdf && !formats.word && !formats.excel) {
      exportHelp.textContent = 'Tick at least one format (PDF, Word or Excel) to export.';
      return;
    }
    const { exportReport } = await import('./pace/report.js');
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
          { label: 'Best-server zones', keywords: 'multi site zones handover overlap view', run: () => { jumpToAnchor('coverageTitle'); if (coverage?.hasServerData?.()) viewServerBtn?.click(); else statusMode.textContent = 'Best-server needs a coverage run with two or more sites'; } },
          { label: 'Interference map (C/I)', keywords: 'co-channel simulcast sinr ci overlap view', run: () => { jumpToAnchor('coverageTitle'); if (coverage?.hasServerData?.()) viewInterferenceBtn?.click(); else statusMode.textContent = 'Interference needs a coverage run with two or more sites'; } },
          { label: 'Recommend sites', keywords: 'masts relay advice', run: () => { jumpToAnchor('siteTitle'); if (!recommendBtn.disabled) recommendBtn.click(); } },
          { label: 'Optimise mast height', keywords: 'antenna height wizard clearance fresnel mast drone', run: () => {
            const rf = ['mast', 'repeater', 'tx', 'drone'].flatMap((k) => registry.byKind(k));
            if (rf.length) mastWizard.openFor(rf[0].id);
            else statusMode.textContent = 'No mast to optimise — place a site or the drone first';
          } },
          { label: 'Build comms plan', keywords: 'pace report', run: () => { jumpToAnchor('paceTitle'); buildPaceBtn.click(); } },
          { label: 'Export report', keywords: 'pdf word excel download', run: () => { jumpToAnchor('paceTitle'); exportReportBtn.click(); } },
          { label: 'Export mission brief', keywords: 'brief html print pdf summary mission map', run: () => openMissionBrief() }, // M37
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
    const r = mission.setRoute(line.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })));
    const notes = [];
    if (r.thinned) notes.push(`thinned from ${r.kept + r.thinned} to ${r.kept} vertices, shape kept`);
    if (r.dropped) notes.push(`${r.dropped} invalid vertices skipped`);
    statusMode.textContent = `Route set, ${r.kept} vertices${notes.length ? ` (${notes.join('; ')})` : ''}`;
  }
  function promotePoints(asSites) {
    let added = 0;
    let invalid = 0;
    let overLimit = 0;
    for (const f of importer.getFeatures()) {
      if (f.geometry?.type !== 'Point') continue;
      const [lng, lat] = f.geometry.coordinates;
      const name = f.properties?.name || '';
      const item = asSites ? mission.addSite(lat, lng, name) : mission.addPoint(lat, lng, name);
      if (item) added += 1;
      else if (isLatLng(lat, lng)) overLimit += 1;
      else invalid += 1;
    }
    const noun = asSites ? 'site' : 'demand point';
    const limit = asSites ? LIMITS.sites : LIMITS.points;
    const parts = [`Added ${added} ${noun}${added === 1 ? '' : 's'}.`];
    if (overLimit) parts.push(`${overLimit} more skipped: the planner holds at most ${limit}. Filter the file to the points you need.`);
    if (invalid) parts.push(`${invalid} skipped: invalid coordinates.`);
    statusMode.textContent = parts.join(' ');
    if (overLimit || invalid) showToast(parts.slice(1).join(' '));
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
    // Keep the specific message promotePoints/promoteLinesToRoute just wrote (it
    // says what was skipped); only fall back to the generic one.
    if (!/^(Added|Route set)/.test(statusMode.textContent)) statusMode.textContent = 'Imported data added to the mission';
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
const antennaPreset = $('#antennaPreset');
const antennaAzimuth = $('#antennaAzimuth');
const antennaGain = $('#antennaGain');
const antennaBeam = $('#antennaBeam');
const antennaFb = $('#antennaFb');
const rxGainInput = $('#rxGain');
const opacityInput = $('#opacityInput');
const opacityRow = $('#opacityRow');
const clearCoverageBtn = $('#clearCoverage');
const progress = $('#coverageProgress');
const progressBar = $('#coverageProgressBar');
const coverageHelp = $('#coverageHelp');
const coverageEngine = $('#coverageEngine');

// Tx antenna: a preset fills gain/beamwidth/front-to-back; editing any of
// them makes it Custom. Pointing only matters for directional antennas.
function readAntenna() {
  return normalizeAntenna({
    preset: antennaPreset?.value,
    gainDbi: antennaGain?.value,
    beamwidthDeg: antennaBeam?.value,
    fbDb: antennaFb?.value,
    azimuthDeg: antennaAzimuth?.value,
  });
}
function writeAntenna(a) {
  const n = normalizeAntenna(a);
  if (antennaPreset) antennaPreset.value = n.preset;
  if (antennaGain) antennaGain.value = String(n.gainDbi);
  if (antennaBeam) antennaBeam.value = String(n.beamwidthDeg);
  if (antennaFb) antennaFb.value = String(n.fbDb);
  if (antennaAzimuth) {
    antennaAzimuth.value = String(n.azimuthDeg);
    antennaAzimuth.disabled = isOmni(n);
  }
}
/** Peak transmit antenna gain (dBi) — the EIRP term. */
const txGainDbi = () => readAntenna().gainDbi;
antennaPreset?.addEventListener('change', () => {
  const p = ANTENNA_PRESETS[antennaPreset.value];
  writeAntenna(p ? { ...p, preset: antennaPreset.value, azimuthDeg: antennaAzimuth?.value } : readAntenna());
});
for (const el of [antennaGain, antennaBeam, antennaFb]) {
  el?.addEventListener('input', () => {
    if (antennaPreset) antennaPreset.value = 'custom';
    if (antennaAzimuth) antennaAzimuth.disabled = isOmni(readAntenna());
  });
}

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
  exportPanel?.refresh(hasCoverage || hasMission, hasCoverage);
}

/**
 * Where the mission is, for the location-only panels (satcom, HF): the AOI
 * centre, else the middle of the sites / route / points (review F15).
 */
function missionCentre() {
  const c = aoi?.getAoi?.()?.center;
  if (c?.lat != null) return c;
  const b = mission?.bbox?.();
  return b ? { lat: (b.south + b.north) / 2, lng: (b.west + b.east) / 2 } : null;
}

/** M38: satcom look angles + the M47 readiness input follow the mission centre. */
function refreshSatcom() {
  const c = missionCentre();
  if (c) {
    satPanel?.update({ lat: c.lat, lng: c.lng });
    try {
      lastSatcomStatus = satcomAssessment(c.lat, c.lng).bestGeo?.status ?? null;
    } catch (_) { lastSatcomStatus = null; }
  } else {
    satPanel?.clear();
    lastSatcomStatus = null;
  }
  setTimeout(() => updateReadinessBadge?.(), 0);
}

function onMissionChange(s) {
  markDirty(); // any mission edit is unsaved work (M21 §A)
  refreshExportPanel();
  refreshSatcom();
  hfPanel?.refresh();
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

/**
 * Which clutter layers a run used, from the sampler id ("worldcover+chm+ghsl",
 * "cog", …), and which fell back to typical heights.
 */
function clutterSourceText(id = '') {
  if (id === 'cog') return 'Clutter heights from your local COG.';
  const has = (k) => id.split('+').some((p) => p.startsWith(k));
  const used = [];
  if (has('worldcover')) used.push('ESA WorldCover land cover');
  if (has('chm')) used.push('Meta tree heights');
  if (has('ghsl')) used.push('GHSL building heights');
  const missing = [];
  if (!has('chm')) missing.push('tree');
  if (!has('ghsl')) missing.push('building');
  return `Clutter from ${used.join(', ').replace(/, ([^,]*)$/, ' and $1')}.` +
    (missing.length ? ` No ${missing.join(' or ')} heights for this area, typical heights used.` : '');
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
  let overLimit = 0;
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
    const item = asSites ? mission.addSite(parsed.lat, parsed.lng, name) : mission.addPoint(parsed.lat, parsed.lng, name);
    if (!item) {
      // Valid line, but the limit is reached: keep it in the box instead of losing it.
      overLimit += 1;
      badLines.push(raw);
      return;
    }
    added += 1;
  });
  missionTools.refresh();

  const parts = [];
  if (added) parts.push(`Added ${added} ${asSites ? 'site' : 'point'}${added > 1 ? 's' : ''}.`);
  if (badNums.length) {
    const shown = badNums.slice(0, 12).join(', ');
    parts.push(`Could not parse line${badNums.length > 1 ? 's' : ''} ${shown}${badNums.length > 12 ? ` and ${badNums.length - 12} more` : ''}.`);
  }
  if (overLimit) parts.push(`${overLimit} line${overLimit > 1 ? 's' : ''} left in the box: the planner holds at most ${asSites ? LIMITS.sites : LIMITS.points} ${asSites ? 'sites' : 'points'}.`);
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

// htmlEsc imported from './util/esc.js' at the top of this file.

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
const runAllBtn = $('#runAllBtn'); // E3c
const briefBtn = $('#briefBtn'); // M37

// M38 / Maven: toolbar intel chip — live coverage % + model name
const intelDot   = $('#intelDot');
const intelCov   = $('#intelCov');
const intelModel = $('#intelModel');

function updateIntelChip(state = 'idle') {
  // state: 'idle' | 'running' | 'ok' | 'stale'
  if (!intelDot) return;
  intelDot.className = 'toolbar__intel__dot' +
    (state === 'running' ? ' toolbar__intel__dot--run' :
     state === 'ok'      ? ' toolbar__intel__dot--ok' :
     state === 'stale'   ? ' toolbar__intel__dot--warn' : '');

  const b = backendSettings?.getBackend?.() ?? 'builtin';
  let modelShort;
  if (b === 'cloudrf' && backendSettings?.getApiKey?.()) modelShort = 'ITM/CloudRF';
  else if (resolveEngine?.() === 'p1812') modelShort = 'P.1812';
  else modelShort = useTerrainInput?.checked ? 'FSPL+Dey' : 'FSPL';

  if (state === 'idle') {
    if (intelCov) intelCov.textContent = '—';
    if (intelModel) intelModel.textContent = 'no run';
    return;
  }
  if (state === 'running') {
    if (intelModel) intelModel.textContent = `${modelShort} running…`;
    return;
  }

  const stats = coverage?.getStats?.();
  const pct = stats?.coveredFracAoi != null
    ? `${Math.round(stats.coveredFracAoi * 100)}%`
    : '—';
  if (intelCov) intelCov.textContent = pct;
  if (intelModel) intelModel.textContent = `${modelShort}${state === 'stale' ? ' · stale' : ''}`;
}
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
    bom: lastCostedBom?.rows ?? lastPowerBom, // M26: costed rows when built
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
      const bearer = l.status === 'gap' ? '— not filled —' : htmlEsc(l.band || l.asset || '');
      const tag = l.status === 'separate' ? ' · separate module' : l.status === 'asset' ? ' · asset' : '';
      return (
        `<div class="pace-row${l.status === 'gap' ? ' pace-row--gap' : ''}">` +
        `<span class="pace-tier badge ${PACE_BADGE[l.tier] || 'badge--ref'}">${htmlEsc(l.tier)}</span>` +
        `<span class="pace-bearer">${bearer}<span class="pace-tag">${htmlEsc(tag)}</span></span>` +
        `<span class="pace-why">${htmlEsc(l.role)} — ${htmlEsc(l.why)}</span>` +
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
  // M26: costed quote over the same lines + the role-assigned radios.
  lastBomNodes = nodes;
  lastCostedBom = costedBom({ nodes, powerLines: lastPowerBom, priceMap: bomPriceMap });
  powerBom.innerHTML = renderBomTable(lastCostedBom, hasDrone);

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

// M26: per-power-line user prices (item label → number), session-scoped like
// the rest of the power form. Radio prices live on the arsenal radios.
const bomPriceMap = {};
let lastCostedBom = null;
let lastBomNodes = [];

// Re-cost on price entry ('change' fires on blur/Enter, so the re-render
// never steals focus mid-typing); export the quote as CSV on demand.
powerBom?.addEventListener('change', (e) => {
  const input = e.target.closest?.('[data-bom-item]');
  if (!input) return;
  bomPriceMap[input.dataset.bomItem] = input.value;
  lastCostedBom = costedBom({ nodes: lastBomNodes, powerLines: lastPowerBom, priceMap: bomPriceMap });
  powerBom.innerHTML = renderBomTable(lastCostedBom, !!drone?.hasDrone?.());
});
powerBom?.addEventListener('click', (e) => {
  if (e.target?.id !== 'exportBomCsv' || !lastCostedBom) return;
  const blob = new Blob([bomToCsv(lastCostedBom)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `GroundLink-BOM_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  statusMode.textContent = 'BOM exported (CSV) — generated locally';
});

function renderBomTable(costed, hasDrone) {
  if (!costed?.rows.length) return '<p class="help">No nodes to roll up yet — add radios to the Arsenal and build the plan.</p>';
  const note = hasDrone ? '' : '<p class="help">Place a drone relay to include airborne-relay batteries.</p>';
  const fmt = (n) => (n == null ? '—' : n.toLocaleString('en', { minimumFractionDigits: 0, maximumFractionDigits: 2 }));
  const rows = costed.rows
    .map((l) => {
      // Radio prices come from the arsenal (edit the radio); power-line
      // prices are typed right here. Both stay user-entered — never fetched.
      const priceCell = l.kind === 'power'
        ? `<input class="input input--mini power-bom__price" data-bom-item="${htmlEsc(l.item)}" type="number" min="0" step="1" value="${l.unitPrice ?? ''}" aria-label="Unit price for ${htmlEsc(l.item)}" />`
        : (l.unitPrice == null ? '<span title="Set a price on the radio (Edit in the arsenal)">—</span>' : fmt(l.unitPrice));
      return (
        `<tr><td>${htmlEsc(l.item)}</td>` +
        `<td class="power-bom__qty" data-numeric>${l.qty}</td>` +
        `<td>${htmlEsc(l.unitSpec ?? '')}</td>` +
        `<td class="power-bom__qty" data-numeric>${priceCell}</td>` +
        `<td class="power-bom__qty" data-numeric>${fmt(l.total)}</td>` +
        `<td class="power-bom__why">${htmlEsc(l.rationale ?? '')}</td></tr>`
      );
    })
    .join('');
  const totalRow =
    `<tr class="power-bom__total"><td>Total (priced items)</td><td></td><td></td><td></td>` +
    `<td data-numeric>€ ${fmt(costed.totalKnown)}</td><td>${costed.unpricedCount ? `${costed.unpricedCount} item(s) unpriced — lower bound` : 'all items priced'}</td></tr>`;
  return (
    `<div class="power-bom__title">Mission bill of materials</div>` +
    `<table><thead><tr><th>Item</th><th>Qty</th><th>Spec</th><th>Unit €</th><th>Total €</th><th>Rationale</th></tr></thead>` +
    `<tbody>${rows}${totalRow}</tbody></table>${note}` +
    `<div class="power-bom__actions"><button class="btn" type="button" id="exportBomCsv">Export BOM (CSV)</button>` +
    `<span class="help">Indicative quote from your own prices — nothing is fetched.</span></div>`
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
// ---- M27: field calibration (RSSI import) ---------------------------------
// Pure logic in src/analysis/calibration.js — this wires the CSV input, the
// per-radio fit table, the deviation dots layer and the apply/persist flow.
// Spec + honesty notes: docs/M27-field-calibration.md.
const CAL_SRC = 'cal-points';
const CAL_LAYER = 'cal-points-layer';
let calRetryArmed = false;
let calPendingData = null;
let calModP = null;
const calMod = () => (calModP ??= import('./analysis/calibration.js'));

/** Active offset (dB) for a radio-keyed compute (teams). 0 when not applied. */
function calOffsetDb(radioId) {
  if (!calState.applied || !radioId) return 0;
  return Number(calState.offsets[radioId] ?? 0) || 0;
}

/** Active offset for the main (form) coverage — the radio chosen in the panel. */
function calFormOffsetDb() {
  return calOffsetDb(calState.formRadioId);
}

function saveCalStore() {
  try {
    localStorage.setItem(CAL_STORE_KEY, JSON.stringify({
      offsets: calState.offsets,
      formRadioId: calState.formRadioId,
      applied: calState.applied,
    }));
  } catch { /* embedded preview / private mode — offsets stay in-memory */ }
}

function loadCalStore() {
  try {
    const s = JSON.parse(localStorage.getItem(CAL_STORE_KEY) ?? 'null');
    if (!s || typeof s !== 'object') return;
    calState.offsets = s.offsets && typeof s.offsets === 'object' ? s.offsets : {};
    calState.formRadioId = typeof s.formRadioId === 'string' ? s.formRadioId : null;
    calState.applied = !!s.applied && Object.keys(calState.offsets).length > 0;
  } catch { /* ignore */ }
}

/** Per-point link params: form params, freq/EIRP overridden from the arsenal
 *  radio when the CSV's radio_id matches an arsenal id or label. */
function calParamsForRadio(radioId) {
  const params = { ...coverageParams() };
  const radio = radioId
    ? (radios?.getArsenal?.() ?? []).find((r) => r.id === radioId || r.label === radioId)
    : null;
  if (radio) {
    if (Number.isFinite(Number(radio.defaultFreqMHz))) params.freqMHz = Number(radio.defaultFreqMHz);
    if (Number.isFinite(Number(radio.powerW))) params.eirpDbm = wattsToDbm(Number(radio.powerW)) + params.antenna.gainDbi;
  }
  return params;
}

// Deviation dots: azure = model conservative (measured stronger), rose =
// model optimistic (the dangerous direction), teal = within ±3 dB.
function ensureCalLayer() {
  if (map.getSource(CAL_SRC)) return true;
  try {
    map.addSource(CAL_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: CAL_LAYER,
      type: 'circle',
      source: CAL_SRC,
      paint: {
        'circle-radius': 5,
        'circle-color': [
          'match', ['get', 'bucket'],
          'conservative', cssToken('--feat-track', '#46a6ff'),
          'optimistic', cssToken('--s5', '#ff6b8a'),
          cssToken('--s1', '#34e6c2'),
        ],
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#ffffff',
        'circle-opacity': 0.9,
        'circle-stroke-opacity': 0.8,
      },
    });
    return true;
  } catch {
    // Style still loading — same retry pattern as the tower/raster layers.
    if (!calRetryArmed) {
      calRetryArmed = true;
      map.once('load', () => {
        calRetryArmed = false;
        if (ensureCalLayer() && calPendingData) map.getSource(CAL_SRC).setData(calPendingData);
      });
    }
    return false;
  }
}

function cssToken(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

function updateCalLayer(samples) {
  calPendingData = {
    type: 'FeatureCollection',
    features: (samples ?? []).map((s) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: { bucket: s.bucket },
    })),
  };
  if (ensureCalLayer()) map.getSource(CAL_SRC).setData(calPendingData);
}

const fmtSignedDb = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;

const escapeHtml = htmlEsc; // alias — use htmlEsc (from util/esc.js) everywhere

/** Import + predict + fit from CSV text (exposed on __gl for tests). */
async function importCalText(text) {
  const calReadout = $('#calReadout');
  const { parseRssiCsv, predictDbm, fitCalibration, deviationBucket } = await calMod();
  const { points, skipped, error } = parseRssiCsv(text);
  if (error) { calReadout.textContent = error; return; }

  const sites = mission.getSites();
  const area = aoi?.getAoi?.();
  const txHeightM = clampNum(txHeightInput.value, 1, 300, 10);
  let txs;
  if (sites.length) txs = sites.map((s) => ({ lat: s.lat, lng: s.lng, txHeightM }));
  else if (area) txs = [{ lat: area.center.lat, lng: area.center.lng, txHeightM }];
  else {
    calReadout.textContent = 'Set up the mission first — prediction needs your transmitter (fixed site or AOI centre).';
    return;
  }

  calReadout.textContent = `Predicting at ${points.length} point${points.length === 1 ? '' : 's'}…`;
  let dem = null;
  if (useTerrainInput.checked) {
    const lats = points.map((p) => p.lat).concat(txs.map((t) => t.lat));
    const lngs = points.map((p) => p.lon).concat(txs.map((t) => t.lng));
    const pad = 0.02;
    const bounds = {
      west: Math.min(...lngs) - pad, east: Math.max(...lngs) + pad,
      south: Math.min(...lats) - pad, north: Math.max(...lats) + pad,
    };
    dem = await buildElevationSampler({ bounds, cog: dataFiles.elevationCog ?? null }).catch(() => null);
  }

  const paramsCache = new Map();
  const samples = points.map((pt) => {
    const key = pt.radioId ?? '';
    if (!paramsCache.has(key)) paramsCache.set(key, calParamsForRadio(pt.radioId));
    const predictedDbm = predictDbm(pt, txs, paramsCache.get(key), dem);
    const deltaDb = pt.dBm - predictedDbm;
    return { ...pt, predictedDbm, deltaDb, bucket: deviationBucket(deltaDb) };
  });
  calState.samples = samples;
  calState.fits = fitCalibration(
    samples.map((s) => ({ radioId: s.radioId, measuredDbm: s.dBm, predictedDbm: s.predictedDbm })),
  );
  renderCalUi({ skipped, terrain: !!dem });
  updateCalLayer(samples);
}

function renderCalUi({ skipped = 0, terrain = false } = {}) {
  const calReadout = $('#calReadout');
  const table = $('#calTable');
  const wrap = $('#calTableWrap');
  const applyRow = $('#calApplyRow');
  const actionRow = $('#calActionRow');
  const select = $('#calFormRadio');
  const clearBtn = $('#calClearBtn');
  const n = calState.samples.length;
  if (!n) {
    calReadout.textContent = '';
    wrap.hidden = true; applyRow.hidden = true; actionRow.hidden = true; clearBtn.hidden = true;
    return;
  }
  const agree = calState.samples.filter((s) => s.bucket === 'agree').length;
  calReadout.textContent =
    `${n} point${n === 1 ? '' : 's'}${skipped ? ` (${skipped} skipped)` : ''} · ` +
    `${terrain ? 'terrain-aware prediction' : 'flat FSPL prediction — terrain unavailable'} · ` +
    `${agree}/${n} within ±3 dB. Dots: azure = model conservative, rose = model optimistic.`;

  table.innerHTML =
    '<thead><tr><th>Radio</th><th>n</th><th>Offset</th><th>RMSE before → after</th></tr></thead><tbody>' +
    calState.fits.map((f) =>
      `<tr><td>${escapeHtml(f.radioId ?? '(no radio id)')}</td><td>${f.n}</td>` +
      `<td>${fmtSignedDb(f.offsetDb)}</td><td>${f.rmseBefore.toFixed(1)} → ${f.rmseAfter.toFixed(1)} dB</td></tr>`,
    ).join('') + '</tbody>';
  wrap.hidden = false;
  clearBtn.hidden = false;

  const ids = calState.fits.map((f) => f.radioId).filter(Boolean);
  select.innerHTML =
    '<option value="">— no offset —</option>' +
    ids.map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`).join('');
  if (ids.length === 1) select.value = ids[0];
  else if (calState.formRadioId && ids.includes(calState.formRadioId)) select.value = calState.formRadioId;
  applyRow.hidden = ids.length === 0;
  actionRow.hidden = false;
}

function initCalibrationControls() {
  const fileInput = $('#calFileInput');
  const importBtn = $('#calImportBtn');
  const clearBtn = $('#calClearBtn');
  const applyBtn = $('#calApplyBtn');
  const exportBtn = $('#calExportBtn');
  const select = $('#calFormRadio');
  if (!importBtn) return;

  loadCalStore();

  importBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      await importCalText(await file.text());
      statusMode.textContent = 'Calibration points imported';
    } catch (err) {
      $('#calReadout').textContent = `Import failed: ${err.message}`;
    }
  });

  applyBtn?.addEventListener('click', () => {
    if (!calState.fits.length) return;
    calState.offsets = Object.fromEntries(
      calState.fits.filter((f) => f.radioId).map((f) => [f.radioId, f.offsetDb]),
    );
    calState.formRadioId = select.value || null;
    calState.applied = Object.keys(calState.offsets).length > 0;
    saveCalStore();
    stalePill.arm('Calibration applied');
    const parts = Object.entries(calState.offsets).map(([id, o]) => `${id} ${fmtSignedDb(o)}`);
    statusMode.textContent = `Calibration applied — ${parts.join(' · ')}`;
    $('#calReadout').textContent =
      `Offsets active: ${parts.join(' · ')}. Team coverage uses each team's radio; ` +
      (calState.formRadioId
        ? `the main coverage applies ${calState.formRadioId}'s offset. Recompute to see the effect.`
        : 'pick a radio above to also shift the main coverage, then recompute.');
  });

  exportBtn?.addEventListener('click', async () => {
    if (!calState.fits.length) return;
    const { calibrationFile } = await calMod();
    const file = calibrationFile(calState.fits, {
      engine: 'fspl-deygout',
      generated: new Date().toISOString(),
    });
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'groundlink-calibration.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    statusMode.textContent = 'Calibration exported';
  });

  clearBtn?.addEventListener('click', () => {
    calState.samples = [];
    calState.fits = [];
    calState.offsets = {};
    calState.formRadioId = null;
    calState.applied = false;
    saveCalStore();
    updateCalLayer([]);
    renderCalUi();
    statusMode.textContent = 'Calibration cleared';
  });
}

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
    cellReadout.textContent = 'Loading towers (snapshot, else OpenStreetMap)…';
    statusMode.textContent = 'Cellular: loading towers…';
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
      // Name the source actually used — OpenCelliD snapshot or live OSM/Overpass.
      // The shipped snapshot is a 146-cell synthetic NL *sample*; flag that so a
      // sparse result there isn't mistaken for "the layer is broken".
      const isSample = meta.source === 'opencellid' && /sample/i.test(meta.region || '');
      const srcLabel = meta.source === 'opencellid'
        ? `OpenCelliD ${meta.region}`
        : 'live OpenStreetMap (Overpass)';
      if (result.error) {
        cellReadout.textContent = `Could not load towers: the tower services did not answer (${result.error}). Check the connection and try again.`;
      } else if (result.count === 0) {
        cellReadout.textContent = isSample
          ? `No sample towers here — the bundled OpenCelliD ${meta.region} set only covers a few NL cities. Pan to one, or move outside NL to use live OpenStreetMap data.`
          : `No cell towers found in view (source: ${srcLabel}) — pan/zoom to a populated area and try again.`;
      } else {
        const per = Object.entries(result.totals || {})
          .filter(([, n]) => n > 0)
          .map(([t, n]) => `${CELL_TYPE_DEFAULTS[t].label.split(' · ')[0]} ${n}`)
          .join(' · ');
        cellReadout.textContent = `${result.count} ${srcLabel} tower${result.count === 1 ? '' : 's'} in view${per ? ` (${per})` : ''}.`;
        cellShown = true;
        reflectCellBtn();
      }
      statusMode.textContent = 'Cellular coverage computing';
      updateBestNet();
    } catch (err) {
      cellReadout.textContent = `Tower fetch failed: ${err.message}. Check your connection and try again.`;
      statusMode.textContent = 'Cellular fetch error';
      showToast(`Cellular tower fetch failed — check your connection`);
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
      `<span class="site-list__name">${htmlEsc(s.label ?? 'Site')}</span>` +
      `<span class="site-list__elev" data-numeric>${Math.round(s.elevM)} m</span>` +
      `<span class="site-list__new" data-numeric>+${Math.round(s.newlyCovered * 100)}% new</span>` +
      `<span class="site-list__cum" data-numeric>cum ${Math.round(s.cumulativeFrac * 100)}%</span>`;
    li.addEventListener('mouseenter', () => recommender?.setHighlight(i));
    li.addEventListener('mouseleave', () => recommender?.setHighlight(null));
    li.addEventListener('click', () => recommender?.flyTo(i));
    siteList.appendChild(li);
  });
}

// Review F13: number fields are clamped when read (clampNum), so show the value
// that is actually used — when a field is left outside its min/max, snap it to
// the limit (or back to its default when it isn't a number) and say so.
document.addEventListener('change', (e) => {
  const el = e.target;
  if (!(el instanceof HTMLInputElement) || el.type !== 'number') return;
  const min = el.min === '' ? -Infinity : Number(el.min);
  const max = el.max === '' ? Infinity : Number(el.max);
  const n = Number.parseFloat(el.value);
  let fixed = null;
  if (!Number.isFinite(n)) fixed = el.defaultValue;
  else if (n < min) fixed = String(min);
  else if (n > max) fixed = String(max);
  if (fixed == null || fixed === el.value) return;
  el.value = fixed;
  const label = (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim()) || el.getAttribute('aria-label') || 'Value';
  const range = Number.isFinite(min) && Number.isFinite(max) ? ` (allowed ${min}–${max})` : '';
  if (statusMode) statusMode.textContent = `${label} set to ${fixed}${range}`;
}, true);

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

/**
 * Site search places masts where no pointing is known yet, so it plans with
 * omni antennas: a directional antenna's peak gain in every direction would
 * be optimistic.
 */
function omniParams(params) {
  if (isOmni(params.antenna)) return params;
  const omni = normalizeAntenna({ preset: 'dipole' });
  return { ...params, eirpDbm: params.eirpDbm - params.antenna.gainDbi + omni.gainDbi, antenna: omni };
}

/** Shared link/engine params (everything except bounds/tx/txHeightM). */
function coverageParams() {
  const freqMHz = clampNum(freqInput.value, 30, 6000, 150);
  const powerW = clampNum(powerInput.value, 0.01, 100, 5);
  const pct = backendSettings?.getPercentiles?.() ?? { p: 50, pL: 50 };
  const antenna = readAntenna();
  return {
    eirpDbm: wattsToDbm(powerW) + antenna.gainDbi,
    freqMHz,
    rxGainDbi: clampNum(rxGainInput?.value, -10, 20, 0),
    antenna, // horizontal pattern, applied per cell by the coverage worker
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
  // Clamp to what the map can place: a window past ±85° latitude or ±180°
  // longitude made the raster overlay throw and the run fall back to flat earth.
  const clamp = (v, lim) => Math.max(-lim, Math.min(lim, v));
  return {
    west: clamp(Math.min(center.lng - dLng, bbox.west), 180),
    south: clamp(Math.min(center.lat - dLat, bbox.south), 85),
    east: clamp(Math.max(center.lng + dLng, bbox.east), 180),
    north: clamp(Math.max(center.lat + dLat, bbox.north), 85),
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
  // M27: shift the link budget by the fitted field-calibration offset when
  // the user tied the main coverage to a calibrated radio.
  const calOff = calFormOffsetDb();
  if (calOff) params.eirpDbm += calOff;
  const sites = mission.getSites();
  const area = aoi?.getAoi?.();
  const bbox = mission.bbox();
  if (!bbox) {
    coverageHelp.textContent = 'Define a mission first — draw an AOI or place a fixed site.';
    return;
  }
  const spread = missionSpanProblem(bbox);
  if (spread) {
    coverageHelp.textContent = spread;
    showToast('Mission too spread out for one plan. See the Coverage panel.');
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
      detail: coverageDetailValue(),
      aoi: aoiMask,
      txs,
      txNames: txs ? sites.map((s, i) => s.name || `Site ${i + 1}`) : null, // M24 legend
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

// ---- E3c: one-click Run All chain ----------------------------------------
// Flag consumed by the coverage onStatus('done') handler to chain step 2 + 3.
let runAllPending = false;

/**
 * Chain: coverage → (on done) site-recommend (if applicable) → PACE update.
 * Sets runAllPending so the existing onStatus callback completes the sequence.
 */
function runAll() {
  const bbox = mission?.bbox?.();
  if (!bbox) {
    showToast('Define a mission first — draw an AOI or place a site');
    return;
  }
  runAllPending = true;
  runCoverage();
}

/**
 * Called from the coverage onStatus('done') handler when runAllPending is set.
 * Chains site recommendation (if useful) then PACE rebuild.
 */
function finishRunAll() {
  runAllPending = false;
  // Step 2: relay/site advice
  const rfObjs = registry.all().filter((e) => RF_KINDS.includes(e.kind));
  if (rfObjs.length && !recommendBtn.disabled) {
    recommendBtn.click();
  }
  // Step 3: rebuild PACE plan
  if (!buildPaceBtn.disabled) {
    lastPlan = buildPace(gatherPaceContext());
    renderPace(lastPlan);
    refreshWorkflowUi();
  }
  const stats = coverage?.getStats?.();
  const covPct = stats?.coveredFracAoi != null ? `${Math.round(stats.coveredFracAoi * 100)}% covered` : 'done';
  const usedDefaults = currentAssumptions().source === 'defaults';
  showToast(`Analysis complete — ${covPct}${usedDefaults ? ' (default radio values, no radio selected)' : ''}`);
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
    txGainDbi: params.antenna.gainDbi,
    antenna: params.antenna,
    rxGainDbi: params.rxGainDbi,
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
    if (Number.isFinite(Number(radio.powerW))) params.eirpDbm = wattsToDbm(Number(radio.powerW)) + params.antenna.gainDbi;
  }
  // M27: per-radio field-calibration offset (mean measured − predicted).
  params.eirpDbm += calOffsetDb(team.radioId);

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
    txNames: txs ? sites.map((s, i) => s.name || `Site ${i + 1}`) : null, // M24 legend
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
      antenna: readAntenna(),
      rxGainDbi: clampNum(rxGainInput?.value, -10, 20, 0),
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
      writeAntenna(c.antenna ?? {}); // older files: dipole, as before
      if (rxGainInput) rxGainInput.value = String(c.rxGainDbi ?? 0);
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
  try {
    applyMissionState(r.mission);
  } catch (err) {
    // The file is sanitised before it gets here, so this is a last resort: say
    // what happened instead of leaving a half-applied mission with no message.
    statusMode.textContent = `Mission file could not be fully applied: ${err?.message ?? err}`;
    showToast('Mission file could not be fully applied. Check what is on the map.');
    return false;
  }
  const warnings = r.warnings ?? [];
  statusMode.textContent = warnings.length
    ? `Mission loaded from ${name} with skipped items: ${warnings.join(' ')}`
    : `Mission loaded from ${name}`;
  if (warnings.length) showToast(`Mission loaded, but some items were skipped. ${warnings[0]}`);
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
  getEirpDbm: () => wattsToDbm(clampNum(powerInput.value, 0.01, 100, 5)) + txGainDbi(),
  getThresholdDbm: () => clampNum(thMarginal.value, -200, 0, -103),
  getMaxM: (e) => (e.kind === 'drone' ? 120 : 30),
  // E1 seam: the wizard sees the same data the coverage run would — local
  // COGs, the OPFS offline package, or network tiles.
  async buildSamplers(bounds) {
    const dem = await buildElevationSampler({ bounds, cog: dataFiles.elevationCog });
    const clutter = useClutterInput.checked
      ? await buildClutterSampler({ bounds, cog: dataFiles.clutterCog }).catch(() => null)
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
  onBrief() { openMissionBrief(); }, // M37 — wired below
  onGapReport() { openCoverageGapReport(); }, // M43
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

// ---- M36: Mission Ops Dashboard -------------------------------------------
// Initialized after the rail is wired. Updated on every relevant state change:
// coverage done/clear, cellular update, drone state, PACE build, teams change.
const opsDash = createOpsDashboard($('#dashOpsInner'), {
  onRunCoverage: () => runCoverage(),
  onOpenPace: () => jumpToAnchor('paceTitle'),
  onOpenTeams: () => jumpToAnchor('teamsTitle'),
});

function updateOpsDash() {
  opsDash.update({
    coverage: lastPaint ? summarizeCoverage({ ...lastPaint, aoi: (() => { const a = aoi?.getAoi?.(); return a ? { type: a.type, center: a.center, radiusM: a.radiusM, ring: a.ring } : null; })(), thresholds: coverageParams().thresholds }) : null,
    coverageStale: planStale,
    cellular: cellular?.getState?.() ?? null,
    drone: drone?.getState?.() ?? null,
    pace: lastPlan ?? null,
    teams: teams?.summary?.() ?? null,
    erlang: null, // wired once erlang module exposes a .summary()
    // readiness is injected separately via updateReadinessBadge() → updateOpsDashReadiness()
  });
}

// ---- M24: best-server / interference view ----------------------------------
// Multi-site runs carry per-cell winner + margin data; the toggle re-renders
// the SAME raster from cached arrays (no recompute). The legend names the
// zones; the contested band marks cells where the top two sites sit within
// the threshold (co-channel interference / handover candidates).
const serverViewRow = $('#serverViewRow');
const viewQualityBtn = $('#viewQualityBtn');
const viewServerBtn = $('#viewServerBtn');
const viewInterferenceBtn = $('#viewInterferenceBtn');
const interferenceChk = $('#interferenceChk');
const overlapRow = $('#overlapRow');
const overlapDb = $('#overlapDb');
const bestServerLegend = $('#bestServerLegend');

const escHtml = htmlEsc; // alias — use htmlEsc (from util/esc.js) everywhere

function renderInterferenceLegend(ci) {
  const pct = (f) => Math.round(f * 100);
  const [b0, b1, b2, b3] = ci.bands;
  const labels = [`≥ ${b0} dB`, `${b1}–${b0} dB`, `${b2}–${b1} dB`, `${b3}–${b2} dB`, `< ${b3} dB`];
  const chips = labels.map((label, i) =>
    `<span class="srv-legend__chip"><i class="srv-legend__swatch" style="background:${ci.colors[i]}"></i>` +
    `C/I ${label}<b data-numeric>${pct(ci.fracs[i])}%</b></span>`);
  chips.push(`<p class="srv-legend__note">${pct(ci.atRiskFrac)}% of the covered area is below ${ci.riskDb} dB C/I, ` +
    'where most FM and digital voice breaks up. Assumes every site transmits on the same channel at the same time; ' +
    'give sites different channels where zones meet, or accept the overlap as handover area.</p>');
  bestServerLegend.innerHTML = chips.join('');
  bestServerLegend.hidden = false;
}

function renderServerLegend() {
  if (!bestServerLegend) return;
  const ci = coverage?.getView?.() === 'interference' ? coverage.getInterferenceInfo() : null;
  if (ci) {
    renderInterferenceLegend(ci);
    return;
  }
  const info = coverage?.getView?.() === 'server' ? coverage.getServerInfo() : null;
  if (!info) {
    bestServerLegend.hidden = true;
    bestServerLegend.innerHTML = '';
    return;
  }
  const chip = (color, label, pct) =>
    `<span class="srv-legend__chip"><i class="srv-legend__swatch" style="background:${color}"></i>` +
    `${label}<b data-numeric>${pct}%</b></span>`;
  const rows = info.legend.map((r) =>
    chip(info.colors[r.index % info.colors.length], escHtml(r.name), Math.round(r.frac * 100)),
  );
  if (info.interference) {
    rows.push(chip('var(--srv-contest)', `Contested &lt; ${info.thresholdDb} dB`, Math.round(info.contestedFrac * 100)));
  }
  bestServerLegend.innerHTML = rows.join('');
  bestServerLegend.hidden = false;
}

function reflectServerView() {
  const v = coverage?.getView?.() ?? 'quality';
  viewQualityBtn?.classList.toggle('is-active', v === 'quality');
  viewQualityBtn?.setAttribute('aria-pressed', String(v === 'quality'));
  viewServerBtn?.classList.toggle('is-active', v === 'server');
  viewServerBtn?.setAttribute('aria-pressed', String(v === 'server'));
  viewInterferenceBtn?.classList.toggle('is-active', v === 'interference');
  viewInterferenceBtn?.setAttribute('aria-pressed', String(v === 'interference'));
  if (overlapRow) overlapRow.hidden = v !== 'server'; // the overlap band belongs to the zone map
  renderServerLegend();
  // The M15 cliff band describes quality classes — hide it in server view.
  if (lastPaint) {
    const mode = digitalModeSelect?.value ?? 'Analogue';
    updateCliffLayer(map, lastPaint.classes, lastPaint.cols, lastPaint.rows, lastPaint.bounds, v === 'quality' && mode !== 'Analogue');
  }
}

function refreshServerViewUi() {
  const has = coverage?.hasServerData?.() ?? false;
  if (serverViewRow) serverViewRow.hidden = !has;
  if (has) reflectServerView();
  else renderServerLegend();
}

viewQualityBtn?.addEventListener('click', () => {
  coverage?.setView('quality');
  reflectServerView();
});
viewServerBtn?.addEventListener('click', () => {
  coverage?.setView('server');
  reflectServerView();
  statusMode.textContent = 'Best-server zones — strongest site per cell';
});
viewInterferenceBtn?.addEventListener('click', () => {
  coverage?.setView('interference');
  reflectServerView();
  statusMode.textContent = 'Interference — C/I with all sites on one channel';
});
const overlapMarginDb = () => clampNum(overlapDb?.value, 1, 20, 6);
interferenceChk?.addEventListener('change', () => {
  coverage?.setInterference(interferenceChk.checked, overlapMarginDb());
  renderServerLegend();
});
overlapDb?.addEventListener('change', () => {
  if (overlapDb) overlapDb.value = String(overlapMarginDb());
  coverage?.setInterference(interferenceChk?.checked ?? false, overlapMarginDb());
  renderServerLegend();
});

// ---- M37: Mission Brief Export -------------------------------------------
/**
 * Generate and open a print-ready mission brief in a new tab.
 * Loads brief.js lazily (not on the startup path).
 */
async function openMissionBrief() {
  const { generateBrief, openBrief } = await import('./export/brief.js');
  // Map screenshot — requires preserveDrawingBuffer: true (set in map.js)
  let mapImageDataUrl = null;
  try {
    mapImageDataUrl = map.getCanvas().toDataURL('image/png');
  } catch (e) {
    console.warn('M37: canvas screenshot failed —', e?.message);
  }
  // Coverage summary (summarizeCoverage is already statically imported)
  let covSummary = null;
  if (lastPaint) {
    const area = aoi?.getAoi?.();
    const aoiMask = area ? { type: area.type, center: area.center, radiusM: area.radiusM, ring: area.ring } : null;
    covSummary = summarizeCoverage({ ...lastPaint, aoi: aoiMask, thresholds: coverageParams().thresholds });
  }
  // Model info (same logic as showResultCard)
  const b = backendSettings?.getBackend?.() ?? 'builtin';
  let modelKey;
  if (b === 'cloudrf' && backendSettings?.getApiKey?.()) modelKey = 'cloudrf';
  else if (resolveEngine() === 'p1812') modelKey = 'p1812';
  else modelKey = useTerrainInput.checked ? 'deygout' : 'flat';
  const pct = backendSettings?.getPercentiles?.() ?? { p: 50, pL: 50 };
  const modelLabels = {
    p1812: { label: 'P.1812', margin: '±8 dB', percentileLabel: `${pct.p}% time` },
    deygout: { label: 'FSPL+Deygout', margin: '±12 dB', percentileLabel: null },
    cloudrf: { label: 'ITM/CloudRF', margin: '±6 dB', percentileLabel: null },
    flat: { label: 'FSPL flat', margin: '±15 dB', percentileLabel: null },
  };
  const modelInfo = modelLabels[modelKey] ?? { label: modelKey, margin: '±? dB', percentileLabel: null };
  const html = generateBrief({
    missionName: 'GroundLink Mission',
    mapImageDataUrl,
    coverageSummary: covSummary,
    paceResult: lastPlan,
    radios: radios?.getArsenal?.() ?? [],
    linkBudgets: [],   // M14 link budgets not yet threaded through; placeholder
    modelInfo,
    buildVersion: `${BUILD.version}+${BUILD.sha}`,
    maskCoords: false,
  });
  openBrief(html);
  statusMode.textContent = 'Mission brief opened in new tab — Ctrl+P to print or save as PDF';
}

/** M43 — Open the coverage gap report in a new tab. */
function openCoverageGapReport() {
  if (!lastPaint) {
    statusMode.textContent = 'Run coverage first to generate a gap report';
    return;
  }
  const area = aoi?.getAoi?.();
  const aoiMask = area ? { type: area.type, center: area.center, radiusM: area.radiusM, ring: area.ring } : null;
  const covSummary = summarizeCoverage({ ...lastPaint, aoi: aoiMask, thresholds: coverageParams().thresholds });

  const b = backendSettings?.getBackend?.() ?? 'builtin';
  let modelKey;
  if (b === 'cloudrf' && backendSettings?.getApiKey?.()) modelKey = 'cloudrf';
  else if (resolveEngine() === 'p1812') modelKey = 'p1812';
  else modelKey = useTerrainInput.checked ? 'deygout' : 'flat';
  const modelLabels = { p1812: 'P.1812', deygout: 'FSPL+Deygout', cloudrf: 'ITM/CloudRF', flat: 'FSPL flat' };
  const modelLabel = modelLabels[modelKey] ?? modelKey;

  const html = generateGapReport({
    deadZones: covSummary.deadZones ?? [],
    coverageSummary: covSummary,
    missionName: 'GroundLink Mission',
    modelLabel,
    buildVersion: `${BUILD.version}+${BUILD.sha}`,
  });
  openGapReport(html);
  statusMode.textContent = 'Gap report opened in new tab — Ctrl+P to print or save as PDF';
}

/** Summarise the last painted raster against the AOI and show the card. */
function showResultCard() {
  if (!lastPaint) return;
  const area = aoi?.getAoi?.();
  const aoiMask = area ? { type: area.type, center: area.center, radiusM: area.radiusM, ring: area.ring } : null;
  // E3b: resolve the current engine key for the model-accuracy badge
  const b = backendSettings?.getBackend?.() ?? 'builtin';
  let modelKey;
  if (b === 'cloudrf' && backendSettings?.getApiKey?.()) {
    modelKey = 'cloudrf';
  } else if (resolveEngine() === 'p1812') {
    modelKey = 'p1812';
  } else {
    modelKey = useTerrainInput.checked ? 'deygout' : 'flat';
  }
  const pct = backendSettings?.getPercentiles?.() ?? { p: 50, pL: 50 };
  const percentileLabel = modelKey === 'p1812' ? `${pct.p}% time` : null;
  resultCard.show(
    summarizeCoverage({ ...lastPaint, aoi: aoiMask, thresholds: coverageParams().thresholds }),
    { modelKey, percentileLabel },
    currentAssumptions(),
  );
}

// Grid detail (coverage/grid.js): remembered per browser, standard by default.
const DETAIL_PREF_KEY = 'gl.coverageDetail.v1';
const coverageDetailSelect = document.getElementById('coverageDetail');
try {
  const saved = localStorage.getItem(DETAIL_PREF_KEY);
  if (saved && coverageDetailSelect && [...coverageDetailSelect.options].some((o) => o.value === saved)) coverageDetailSelect.value = saved;
} catch (_) { /* private mode */ }
coverageDetailSelect?.addEventListener('change', () => {
  try { localStorage.setItem(DETAIL_PREF_KEY, coverageDetailSelect.value); } catch (_) { /* private mode */ }
});
function coverageDetailValue() {
  return coverageDetailSelect?.value === 'high' ? 'high' : 'standard';
}

/** What the last coverage run rested on (see analysis/assumptions.js). */
function currentAssumptions() {
  const st = coverage?.getStats?.() ?? {};
  const p = coverageParams();
  return describeAssumptions({
    freqMHz: p.freqMHz,
    powerW: clampNum(powerInput.value, 0.01, 100, 5),
    txHeightM: clampNum(txHeightInput.value, 1, 300, 10),
    rxHeightM: p.rxHeightM,
    terrainUsed: Boolean(st.terrain),
    clutterRequested: Boolean(useClutterInput.checked),
    clutterUsed: Boolean(st.clutter),
    cellM: lastPaint ? cellSizeM(lastPaint.bounds, lastPaint.cols) : null,
    radioApplied: Boolean(radios?.hasActive?.()),
    terrainSource: st.terrain ? terrainCredit(st.elevSource) : null,
    detail: coverageDetailValue(),
    antenna: antennaText(p.antenna),
    rxGainDbi: p.rxGainDbi,
  });
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
  updateIntelChip('stale'); // Maven intel chip
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
    // M27 handles (testing): import CSV text directly, inspect fits/offsets.
    calibration: { importText: importCalText, state: calState },
  };
}
