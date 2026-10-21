# Data sources and licences

What the app fetches at runtime, where it comes from, and the terms as the provider states them. **Check each provider's current terms before commercial use.** GroundLink bundles none of this data; it is fetched live in the user's browser and never uploaded anywhere.

## Satellite and aerial imagery

There is **no global open satellite layer sharper than about 10 m** (Sentinel-2). Sharper open imagery (8 to 50 cm) exists only as national aerial orthophoto programmes, so GroundLink draws those above the global layer, inside each country's bounds, from zoom 10 (USA from zoom 13).

### Global base layers

| Layer | Resolution | Terms (as stated by the provider) | Note |
|---|---|---|---|
| Esri World Imagery | to about 30 cm in many places | Esri public service, attribution required, not an open licence | Best global detail. Can be blocked by some networks, in which case the app switches automatically. |
| EOX Sentinel-2 cloudless 2024 | 10 m | CC BY-NC-SA 4.0 (non-commercial) | Automatic fallback. Non-commercial terms apply. |

### National aerial imagery (`src/map/hires-imagery.js`)

All are keyless and serve CORS headers. Each was probed live on 21 Oct 2026 (status 200 at zoom 18/19 inside its country).

| Source | Area | Resolution | Terms stated |
|---|---|---|---|
| PDOK Luchtfoto HR | Netherlands | 8 cm | CC BY 4.0, Beeldmateriaal Nederland |
| SWISSIMAGE (swisstopo) | Switzerland | 10 cm | swisstopo open government data |
| NRW DOP (Geobasis NRW) | North Rhine-Westphalia | 10 to 20 cm | dl-de/zero-2-0 |
| IGN Orthophotos | France | 20 cm | Licence Ouverte |
| Luxembourg orthophoto (ACT) | Luxembourg | 20 cm | Administration du cadastre et de la topographie open data |
| Orthofoto Vlaanderen | Flanders, Belgium | 25 cm | Digitaal Vlaanderen |
| GUGiK orthophoto | Poland | 25 cm | GUGiK open data |
| basemap.at Orthofoto | Austria | 30 cm | CC BY 4.0 |
| Bayern DOP | Bavaria, Germany | 40 cm | CC BY 4.0 |
| PNOA (IGN España) | Spain | 25 to 50 cm | CC BY 4.0 |
| USGS Imagery | USA (lower 48) | about 0.3 to 1 m (NAIP) | US government work, public domain |

Not included, with the reason: United Kingdom (no open aerial imagery service), Denmark, Finland, Sweden (access needs a key or token), Wallonia and Czechia (service did not answer), Schleswig-Holstein (no CORS headers), Norway (timed out). Add them to `HIRES_SOURCES` when a keyless, CORS-enabled endpoint is confirmed.

### How blank areas are handled

Several services answer outside their coverage with a pure white JPEG or an error. A white tile would hide the base map, so the `hires://` tile handler turns white, empty and failed tiles into a transparent tile. A provider outage therefore shows the global layer instead of a hole.

### Attribution

Only the providers whose imagery is actually in view are credited (rebuilt as the view changes), so the required credit stays visible instead of being buried in a list of eleven.

## Other live sources

| Source | Used for | Terms |
|---|---|---|
| AWS Terrain Tiles (Terrarium) | Elevation | Open, see registry.opendata.aws/terrain-tiles |
| OpenStreetMap, Overpass, OpenFreeMap, Photon | Towers, buildings, search | ODbL 1.0, attribution required |
| CelesTrak | Satellite element sets (LEO pass window) | Public, citation requested |
| ESA WorldCover via Digital Earth Africa WMS | Clutter (Africa only) | CC BY 4.0 |
| Overture Maps buildings | 3D buildings (optional) | ODbL / CDLA, see overturemaps.org |
| FCC equipment database | Radio specifications | US public records |
