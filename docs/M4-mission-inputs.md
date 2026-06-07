# M4 — Mission input modes (authoritative spec)

Make all four planning inputs first-class: **Area / Fixed sites / Route / Points**, with coordinate entry in **lat/long, MGRS and UTM**, and click-to-place. Routes are only one mode — never privilege them. Read alongside `CLAUDE.md`, `../context.md`, `docs/M3-site-recommendation.md`.

## Current state (build on, don't duplicate)

- AOI radius/polygon: `src/map/aoi.js` (`setMode`, `getAoi`, `clear`, `fitBounds`).
- Search bar: `src/ui/search.js` — parses decimal lat/long only; Nominatim geocoding.
- Import: `src/io/import.js` — KML/KMZ/GPX rendered as a passive overlay.

## 1. Mission model — `src/mission/mission.js`

One source of truth for what the user is planning for:

```
mission = {
  aoi:    null | { type:'radius'|'polygon', ... },   // delegate to aoi.js
  sites:  [{ id, lat, lng, name }],                  // fixed masts/repeaters (known infrastructure)
  route:  [{ lat, lng }],                            // ordered vertices, one route to start
  points: [{ id, lat, lng, name }],                  // positions that need comms (demand)
}
```

- Emits `onChange(missionSummary)` for the panel + status bar.
- `demandPoints()` helper merges: AOI grid (M3 logic) + route resampled every ~250 m + explicit points. This is the single demand input for coverage/recommendation.
- Fixed sites act as *pre-placed transmitters*: M3's greedy starts from their coverage and only adds masts where they fall short (pass them to the recommend worker as locked picks).

## 2. Map tools — click-to-place

Extend the existing toolbar pattern (`aoi.setMode` style, one armed mode at a time):

- **Site**: click → numbered site marker (teal `--feat-site`), draggable.
- **Route**: click vertices, Enter to finish, Esc cancels (same interaction grammar as the polygon tool); azure `--feat-track` line; vertices draggable.
- **Point**: click → demand point marker (amber `--feat-event`), draggable.
- Each mode shows the same draw-hint chip as AOI drawing; Esc always disarms.
- Panel "Mission" section lists elements per type with counts + per-type clear; deleting an element via its popup (small × in the existing import-style popup).

## 3. Coordinate entry — lat/long, MGRS, UTM

### Parser — `src/geo/coords.js` (pure, unit-tested)

`parseCoordinate(text) -> { lat, lng, fmt: 'latlng'|'dms'|'mgrs'|'utm' } | null`

- Decimal: `52.3676, 4.9041` (existing regex).
- DMS: `52°22'03"N 4°54'15"E` (and `52 22 03 N ...`).
- MGRS: `31UFU 91733 09227` (with/without spaces, 2–5 digit precision). Use the `mgrs` npm package (~5 kB, the proj4js extract) — justified dependency.
- UTM: `31U 629133 5803437` (zone + easting + northing, hemisphere from band letter or explicit N/S). Implement the standard Karney/Krüger-series conversion in ~80 lines — no extra dependency.
- `formatCoordinate({lat,lng}, fmt)` for the reverse (status bar readout follows the user's last-used format).

### Wire-up

- Search bar (`search.js`): run `parseCoordinate` before geocoding — any recognised format flies + pins (replaces the current decimal-only regex).
- **Bulk add**: textarea in the Mission section — one coordinate per line, any format, optional trailing name (`31UFU 91733 09227 OP Alpha`). Parse all, report failures per line, add as Points (toggle: as Sites).
- Status bar: click the coords readout to cycle lat/long → MGRS → UTM.

## 4. Import → mission promotion

After a KML/KMZ/GPX import, offer "Use as mission input": imported lines → route, points → sites *or* demand points (user picks), first polygon → AOI. Import stays a passive overlay unless promoted. Client-side only (OPSEC).

## 5. Coverage integration

- "Compute coverage" works for any mission with ≥1 transmitter source: AOI centre (current), fixed sites (`txs[]`, already multi-tx after M3), or recommended sites.
- Compute bounds = bbox of all mission elements + signal-range padding (the round-coverage rule from the M3 dispatch).
- Recommend sites (M3) consumes `mission.demandPoints()` instead of AOI-grid-only, and respects locked fixed sites.

## Acceptance

1. Type `31UFU 91733 09227` in the search bar → map flies to Amsterdam area, pin dropped; same for UTM and DMS forms.
2. Paste 10 mixed-format lines in bulk-add → 10 amber points, bad lines reported with line numbers.
3. Place 2 fixed sites + draw a route → recommend → greedy only adds masts where the fixed sites leave route demand uncovered.
4. Import a GPX track → promote to route → dead-zone analysis along it works via the same demand pipeline.
5. Esc always exits any armed mode; all modes work on phone (tap-to-place, bottom-sheet list).
6. `src/geo/coords.js` has unit tests covering all four formats incl. southern hemisphere + round-trips.
