import 'leaflet/dist/leaflet.css';
import '../styles/index.css';

import L from 'leaflet';
import { initMap, keepMapSized } from './map/map.js';
import { createAoiController } from './map/aoi.js';
import { initThemeToggle } from './ui/theme.js';

const $ = (sel) => document.querySelector(sel);

// ---- Map ----------------------------------------------------------------

const { map, setBasemap } = initMap($('#map'));
const invalidate = keepMapSized(map);

// ---- Status bar ---------------------------------------------------------

const statusCoords = $('#statusCoords');
const statusZoom = $('#statusZoom');
const statusMode = $('#statusMode');
const statusAoi = $('#statusAoi');

const fmtLat = (lat) => `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}`;
const fmtLng = (lng) => `${Math.abs(lng).toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`;

map.on('mousemove', (e) => {
  statusCoords.textContent = `${fmtLat(e.latlng.lat)} ${fmtLng(e.latlng.lng)}`;
});
map.on('mouseout', () => {
  statusCoords.textContent = '—';
});

const updateZoom = () => {
  statusZoom.textContent = map.getZoom().toFixed(0);
};
map.on('zoomend', updateZoom);
updateZoom();

// ---- Theme toggle -------------------------------------------------------

initThemeToggle($('#themeToggle'), () => {
  // map canvas stays dark regardless; nothing to repaint, but keep it sized
  invalidate();
});

// ---- Basemap switcher ---------------------------------------------------

const basemapSwitch = $('#basemapSwitch');
basemapSwitch.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-basemap]');
  if (!btn) return;
  setBasemap(btn.dataset.basemap);
  basemapSwitch
    .querySelectorAll('.basemap-switch__btn')
    .forEach((b) => b.classList.toggle('is-active', b === btn));
});

// ---- Zoom toolbar -------------------------------------------------------

$('#zoomIn').addEventListener('click', () => map.zoomIn());
$('#zoomOut').addEventListener('click', () => map.zoomOut());

// ---- AOI drawing --------------------------------------------------------

const drawHint = $('#drawHint');
const aoiStatus = $('#aoiStatus');
const aoiReadout = $('#aoiReadout');
const drawRadiusBtn = $('#drawRadius');
const drawPolygonBtn = $('#drawPolygon');

const fmtArea = (m2) => {
  const km2 = m2 / 1e6;
  if (km2 >= 1) return `${km2.toFixed(km2 >= 100 ? 0 : 1)} km²`;
  return `${(m2 / 1e4).toFixed(1)} ha`; // hectares for sub-km2 areas
};
const fmtKm = (m) => `${(m / 1000).toFixed(m >= 100000 ? 0 : 1)} km`;

const aoi = createAoiController(map, {
  onChange(s) {
    if (!s || s.type === null) {
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
      aoiReadout.textContent = `Polygon · ${s.vertices} vertices · ${fmtArea(s.areaM2)} · ${fmtKm(
        s.perimeterM,
      )} perimeter.`;
      statusAoi.textContent = `${s.vertices} pts · ${fmtArea(s.areaM2)}`;
    }
    statusMode.textContent = 'AOI set';
    syncToolButtons();
  },
  onHint(text) {
    drawHint.classList.toggle('is-visible', Boolean(text));
    if (text) {
      // allow the "kbd" hint to render small inline markup safely
      drawHint.innerHTML = text
        .replace('Enter', '<kbd>Enter</kbd>')
        .replace('Esc', '<kbd>Esc</kbd>');
    }
    statusMode.textContent = aoi?.getMode?.()
      ? `Drawing ${aoi.getMode()}`
      : statusMode.textContent;
  },
});

function syncToolButtons() {
  const m = aoi.getMode();
  drawRadiusBtn.setAttribute('aria-pressed', String(m === 'radius'));
  drawRadiusBtn.classList.toggle('is-active', m === 'radius');
  drawPolygonBtn.setAttribute('aria-pressed', String(m === 'polygon'));
  drawPolygonBtn.classList.toggle('is-active', m === 'polygon');
  statusMode.textContent = m ? `Drawing ${m}` : statusMode.textContent;
}

drawRadiusBtn.addEventListener('click', () => {
  aoi.setMode('radius');
  syncToolButtons();
});
drawPolygonBtn.addEventListener('click', () => {
  aoi.setMode('polygon');
  syncToolButtons();
});
$('#clearAoi').addEventListener('click', () => {
  aoi.clear();
  aoi.setMode(null);
  syncToolButtons();
});

// ---- Mobile slide-over panel -------------------------------------------

const app = $('#app');
const openPanel = () => {
  app.dataset.panel = 'open';
};
const closePanel = () => {
  app.dataset.panel = 'closed';
};
$('#panelToggle').addEventListener('click', openPanel);
$('#scrim').addEventListener('click', closePanel);
// close the slide-over after the user commits to drawing on the map (mobile)
const mq = window.matchMedia('(max-width: 760px)');
[drawRadiusBtn, drawPolygonBtn].forEach((b) =>
  b.addEventListener('click', () => {
    if (mq.matches) closePanel();
  }),
);

// Fix Leaflet's default marker icon paths under Vite (not used yet, but safe).
delete L.Icon.Default.prototype._getIconUrl;

// Ensure correct sizing after first paint.
requestAnimationFrame(invalidate);

// Dev-only handle for testing/automation (stripped from production builds).
if (import.meta.env.DEV) {
  window.__gl = { map, aoi };
}
