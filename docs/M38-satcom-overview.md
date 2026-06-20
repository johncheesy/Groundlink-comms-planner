# M38 — Satellite Communications Overview

> **Status: shipped — Jun 2026.**

## What it does

Adds a collapsible **Satcom** section inside the HF/ionosphere tab of the left panel. When an AOI centre is set, it shows:

- **Best GEO summary**: satellite name, network, elevation angle, and an SVG protractor arc showing the look angle.
- **GEO table**: all visible GEO satellites (elevation > 5°), sorted by elevation. Each row shows the arc indicator, satellite name/network/band, elevation (°), and azimuth (°).
- **LEO badges**: Iridium, Starlink, Globalstar, O3b — always available by nature of their orbits.
- **Footer**: note on obstruction / terrain clearance, coords used.

## Files

| File | Role |
|---|---|
| `src/connectivity/satcom.js` | GEO_SATS catalogue, `geoLookAngle()`, `satcomAssessment()` |
| `src/ui/satcom-panel.js` | Panel create/update/clear, `elevationArc()` SVG helper |
| `index.html` | `<details id="satcomPanel">` after HF section |
| `styles/components.css` | `.satcom-*` classes |

## Key decisions

- **GEO look angle formula** — standard spherical Earth geometry:  
  `cosGamma = cos(φ) · cos(Δλ)`, elevation = `atan2(cosGamma − R_ratio, sin(gamma))`  
  where `R_ratio = Re / (Re + 35786) ≈ 0.15127`.
- **SVG className fix** — SVG elements require `el.setAttribute('class', ...)` not `el.className = ...` (SVGAnimatedString is read-only). Fixed during testing.
- **Catalogue** — 9 GEO satellites covering L/S/C/Ku/Ka/X bands; LEO networks are static badges (not orbit-computed).
- Seeded from `aoi.onChange` using the same centroid-update pattern as the HF panel.

## API

```js
const panel = createSatcomPanel(host, { onCentroidNeeded });
panel.update({ lat, lng }); // call on AOI change
panel.clear();              // reset to placeholder state
```
