/**
 * M19 — shared inline SVG icon set for the top toolbar, the collapsed
 * left-panel icon strip and the object-list rows. Stroke style matches the
 * existing UI icons (round caps, ~1.8 stroke, currentColor) — no new colours.
 */

const wrap = (body, vb = '0 0 24 24') =>
  `<svg class="ico" viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** Module icons, keyed by toolbar/section key. */
export const MODULE_ICONS = {
  mission: wrap('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  aoi: wrap('<path d="M5 5h6M15 5h4v4M19 13v6h-6M9 19H5v-4M5 9v2"/>'),
  radios: wrap('<rect x="7" y="6" width="10" height="14" rx="2"/><path d="M10 6V3.5M9.8 10h4.4"/><circle cx="12" cy="15" r="2.2"/>'),
  roles: wrap('<circle cx="8" cy="8" r="2.6"/><circle cx="16.5" cy="9.5" r="2.1"/><path d="M3.8 18.6c0-2.7 1.9-4.4 4.2-4.4s4.2 1.7 4.2 4.4M13.5 17.2c.4-2 1.6-3.1 3-3.1 1.7 0 3.1 1.4 3.1 3.6"/>'),
  coverage: wrap('<path d="M12 20V9"/><path d="M8 20h8"/><path d="M12 9l-3 4.5h6L12 9z"/><path d="M8.5 6.5a5 5 0 0 1 7 0M6 4a8.5 8.5 0 0 1 12 0"/>'),
  sites: wrap('<path d="M6 20l4-12 2.5 6L15 9l3 11"/><path d="M4 20h16"/><circle cx="10" cy="6" r="1.4" fill="currentColor" stroke="none"/>'),
  drone: wrap('<circle cx="5" cy="5" r="2.4"/><circle cx="19" cy="5" r="2.4"/><circle cx="5" cy="19" r="2.4"/><circle cx="19" cy="19" r="2.4"/><path d="M6.7 6.7l3 3M17.3 6.7l-3 3M6.7 17.3l3-3M17.3 17.3l-3-3"/><rect x="9.5" y="9.5" width="5" height="5" rx="1.2" fill="currentColor" stroke="none"/>'),
  pace: wrap('<path d="M5 4h11l3 3v13H5z"/><path d="M9 9h6M9 13h6M9 17h4"/>'),
  export: wrap('<path d="M12 15V3M8 7l4-4 4 4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>'),
  power: wrap('<path d="M13 2L5 13h6l-1 9 8-11h-6l1-9z"/>'),
  cellular: wrap('<path d="M4 19h2v-4H4zM9 19h2v-7H9zM14 19h2V8h-2zM19 19h2V4h-2z"/>'),
  layers: wrap('<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>'),
  settings: wrap('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'),
  search: wrap('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
  basemap: wrap('<path d="M9 4L3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4z"/><path d="M9 4v13M15 6.5v13"/>'),
  objects: wrap('<path d="M4 6h2M4 12h2M4 18h2M9 6h11M9 12h11M9 18h11"/>'),
};

/** Object-kind icons (registry rows + context-menu header). */
export const OBJECT_ICONS = {
  tx: MODULE_ICONS.coverage,
  mast: MODULE_ICONS.coverage,
  repeater: wrap('<path d="M7 20V9M17 20V12"/><path d="M7 9l-2.2 3.4h4.4L7 9zM17 12l-1.8 2.8h3.6L17 12z"/><path d="M9.5 6.5c1.6-1.4 3.4-1.4 5 0"/><path d="M4 20h16"/>'),
  marker: wrap('<circle cx="12" cy="10" r="3"/><path d="M12 21c-4-5-7-7.7-7-11a7 7 0 0 1 14 0c0 3.3-3 6-7 11z"/>'),
  waypoint: wrap('<path d="M6 21V4"/><path d="M6 5h11l-2.5 3.5L17 12H6"/>'),
  drone: MODULE_ICONS.drone,
};

export function objectIconSvg(kind) {
  return OBJECT_ICONS[kind] || OBJECT_ICONS.marker;
}
