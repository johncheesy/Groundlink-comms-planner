import 'maplibre-gl/dist/maplibre-gl.css';
import '../styles/index.css';

import { initMap, keepMapSized } from './map/map.js';
import { createAoiController } from './map/aoi.js';
import { createCoverageController } from './coverage/coverage.js';
import { createDroneController } from './drone/drone.js';
import { createRecommendController } from './recommend/recommend.js';
import { createMission } from './mission/mission.js';
import { createMissionTools } from './mission/mission-tools.js';
import { parseCoordinate, formatCoordinate, COORD_CYCLE } from './geo/coords.js';
import { createRadios } from './radios/radios.js';
import { recommendMix } from './radios/mix.js';
import { createSearch } from './ui/search.js';
import { createImportController } from './io/import.js';
import { initThemeToggle, applyInitialTheme } from './ui/theme.js';
import { wattsToDbm, maxRangeM, haversineM } from './coverage/model.js';
import { BASEMAP_VARIANTS } from './map/basemaps.js';

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

// ---- Variant picker dropdown -------------------------------------------
let variantMenuOpen = false;
let variantMenuCategory = null;

function buildVariantMenu(category) {
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
      switchBasemap(category, v.id, true);
      closeVariantMenu();
    });
    variantMenu.appendChild(btn);
  }
}

function openVariantMenu(category, anchorBtn) {
  if (variantMenuOpen && variantMenuCategory === category) {
    closeVariantMenu();
    return;
  }
  buildVariantMenu(category);
  // Position dropdown below the basemap switch, flush to the right of the toolbar.
  // The menu uses position:fixed so getBoundingClientRect() values are used directly.
  const switchRect = anchorBtn.closest('.basemap-switch').getBoundingClientRect();
  variantMenu.style.right = (window.innerWidth - switchRect.right) + 'px';
  variantMenu.style.top = (switchRect.bottom + 4) + 'px';
  variantMenu.style.left = 'auto';
  variantMenu.removeAttribute('hidden');
  variantMenuOpen = true;
  variantMenuCategory = category;
}

function closeVariantMenu() {
  variantMenu.setAttribute('hidden', '');
  variantMenuOpen = false;
  variantMenuCategory = null;
}

// Close when clicking outside the menu or the basemap switch
document.addEventListener('click', (e) => {
  if (variantMenuOpen && !variantMenu.contains(e.target) && !basemapSwitch.contains(e.target)) {
    closeVariantMenu();
  }
});

// Click on chip: if it's the active one → open variant picker;
//                if it's a different one → switch category.
basemapSwitch.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-basemap]');
  if (!btn) return;
  const category = btn.dataset.basemap;
  if (btn.classList.contains('is-active')) {
    // second press on active chip → variant picker
    openVariantMenu(category, btn);
  } else {
    closeVariantMenu();
    switchBasemap(category);
  }
});

// Desktop right-click on any chip → variant picker for that category
basemapSwitch.addEventListener('contextmenu', (e) => {
  const btn = e.target.closest('[data-basemap]');
  if (!btn) return;
  e.preventDefault();
  openVariantMenu(btn.dataset.basemap, btn);
});

// Long-press on touch (≥500 ms) → variant picker
let longPressTimer = null;
basemapSwitch.addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('[data-basemap]');
  if (!btn) return;
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    openVariantMenu(btn.dataset.basemap, btn);
  }, 500);
});
basemapSwitch.addEventListener('pointerup', () => { clearTimeout(longPressTimer); longPressTimer = null; });
basemapSwitch.addEventListener('pointercancel', () => { clearTimeout(longPressTimer); longPressTimer = null; });

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
let recommender = null;
let mission = null;
let missionTools = null;
let radios = null;
let currentAoiAreaM2 = 0;

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
      if (!has) {
        // AOI removed → any recommended sites are stale.
        recommender?.clear();
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
        // update status bar terrain indicator
        if (statusTerrain) {
          statusTerrain.textContent = terrain
            ? (clutter ? 'DEM + clutter' : 'DEM')
            : 'flat';
        }
        const bits = [];
        const stats = coverage.getStats();
        if (stats && stats.coveredFracAoi != null) {
          bits.push(`${Math.round(stats.coveredFracAoi * 100)}% of the AOI is covered (marginal or better).`);
        }
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
  });

  // Mission input-mode segmented buttons (Area / Sites / Route / Points).
  missionModes.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mode]');
    if (btn) armMissionMode(btn.dataset.mode);
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
  opacityInput.addEventListener('input', () => coverage.setOpacity(opacityInput.value / 100));
  clearCoverageBtn.addEventListener('click', () => {
    // Recommended sites paint into this same raster — clear them too so the
    // numbered markers and the site list don't linger over a cleared map.
    if (recommender?.hasSites()) recommender.clear();
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
  computeRelayBtn.addEventListener('click', () => {
    // Drone relay paints the same shared raster — supersede any recommendation.
    if (recommender?.hasSites()) recommender.clear();
    drone.computeRelay();
  });
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
        maxSites: clampNum($('#maxSites').value, 1, 6, 3),
        targetFrac: clampNum($('#targetCoverage').value, 10, 100, 95) / 100,
      },
    );
    coverageEngine.textContent = useTerrainInput.checked ? 'FSPL+Deygout' : 'FSPL · flat';
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
      coverageHelp.textContent =
        `Coverage controls set from the active radio set — talk-in at ${vals.rxHeightM} m, ` +
        `thresholds from ${Math.round(vals.rxSensDbm)} dBm sensitivity. Compute to plot.`;
    },
    onStatus(msg) { statusMode.textContent = msg; },
  });

  recommendMixBtn.addEventListener('click', () => {
    renderMix(recommendMix(gatherMixInput()));
    statusMode.textContent = 'Radio mix ready';
  });

  // ---- Location search + coordinate entry ------------------------------
  createSearch(map, {
    input: $('#searchInput'),
    form: $('#searchForm'),
    results: $('#searchResults'),
    clearBtn: $('#searchClear'),
    onStatus: (msg) => { statusMode.textContent = msg; },
  });

  // ---- Import KML / KMZ / GPX (+ promote to mission input) -------------
  const importInput = $('#importInput');
  const clearImportBtn = $('#clearImportBtn');
  const importPromote = $('#importPromote');
  const importPromoteText = $('#importPromoteText');
  const importPromoteBtns = $('#importPromoteBtns');
  const importer = createImportController(map, {
    onStatus(msg) { statusMode.textContent = msg; },
  });
  $('#importBtn').addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', async () => {
    let byType = null;
    for (const file of importInput.files) {
      const r = await importer.importFile(file);
      if (r.ok) { clearImportBtn.hidden = false; byType = r.byType; }
    }
    importInput.value = ''; // allow re-importing the same file
    if (byType) offerImportPromotion(byType);
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
function onMissionChange(s) {
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
    applyBtn: $('#applyRadios'),
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

  const aoiMask = area ? { type: area.type, center: area.center, radiusM: area.radiusM, ring: area.ring } : null;
  coverage.compute(coverageBoundsFor(bbox, center, params), center, params, {
    aoi: aoiMask,
    txs,
    marker: !txs, // multi-site markers stand in for the single tx marker
  });
  coverageEngine.textContent = useTerrainInput.checked ? 'FSPL+Deygout' : 'FSPL · flat';
}

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

// Desktop: collapse the panel to a sliver so the map gets the full width.
// The map needs a resize once the grid column finishes animating.
const setCollapsed = (collapsed) => {
  app.dataset.collapsed = collapsed ? 'true' : 'false';
  panelToggle.setAttribute('aria-expanded', String(!collapsed));
  setTimeout(() => resize(), 260);
};

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
    setCollapsed(app.dataset.collapsed !== 'true');
  }
});
panelCollapse.addEventListener('click', () => setCollapsed(true));
$('#scrim').addEventListener('click', closePanel);
$('#panelClose').addEventListener('click', closePanel);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && mq.matches && app.dataset.panel === 'open') closePanel();
});

// Dev-only handle for testing/automation (stripped from production builds).
if (import.meta.env.DEV) {
  window.__gl = {
    map, mapApi,
    get aoi() { return aoi; },
    get coverage() { return coverage; },
    get recommender() { return recommender; },
    get mission() { return mission; },
    get missionTools() { return missionTools; },
    get radios() { return radios; },
  };
}
