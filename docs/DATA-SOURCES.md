# Data sources and licences

What the app fetches at runtime, where it comes from, and the terms as the provider states them. **Check each provider's current terms before commercial use.** GroundLink bundles none of this data; it is fetched live in the user's browser and never uploaded anywhere.

## Satellite and aerial imagery

There is **no global open satellite layer sharper than about 10 m** (Sentinel-2). Sharper open imagery (8 to 50 cm) exists only as national aerial orthophoto programmes, so GroundLink draws those above the global layer, inside each country's bounds, from zoom 10 (USA from zoom 13).

### Global base layers

| Layer | Resolution | Terms (as stated by the provider) | Note |
|---|---|---|---|
| Esri World Imagery | about 30 cm in over 1,000 metro areas, 15 cm in a few cities, 1 m or better over most land, 15 m worldwide at small scale (Esri's description, via search summaries; the page itself could not be fetched) | Esri's own terms, attribution required, **not an open licence** | Best global detail. Used for research and other non-commercial purposes. Never stored offline by this app (the service worker bypasses and purges it). Can be blocked by some networks, in which case the app switches automatically. |
| EOX Sentinel-2 cloudless 2024 | 10 m | CC BY-NC-SA 4.0 (non-commercial) | Automatic fallback. Non-commercial terms apply. |

### Intended use

GroundLink is meant for **research and other non-commercial use**. Loading a tile without a key is not the same as being licensed to store it or to use it in a commercial product:

- **Esri:** the app does not cache or store Esri tiles (service worker network-only, and an activate step deletes tiles stored by older builds). Storing Esri imagery for offline use, or using it commercially, is described as needing an Esri licence. The official terms page could not be retrieved, so this is the conservative reading; confirm with Esri before any commercial or defence deployment.
- **Sentinel-2 (EOX):** CC BY-NC-SA 4.0, non-commercial.
- **National sources:** open data, each under its own terms (table below).
- **No sharp global layer is both open and commercially clean.** For commercial use, either rely on the national sources where they exist or bring your own licensed imagery.

### National aerial imagery (`src/map/hires-imagery.js`)

All are keyless and serve CORS headers. Each was probed live on 21 Oct 2026 (status 200 inside its country at the zoom levels it serves, and behaviour outside checked).

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
| GSI Japan seamless photo | Japan | about 0.2 to 1 m | Government of Japan Standard Terms of Use v2.0 (CC BY compatible) |
| NSW Imagery | New South Wales, Australia | 12 to 50 cm | CC BY 4.0, NSW Spatial Services |
| NLSC aerial photo | Taiwan | about 0.25 m | Taiwan open government data licence |
| ČÚZK orthophoto | Czechia | 12 to 25 cm | CC BY 4.0 |
| Sachsen DOP | Saxony, Germany | 20 cm | dl-de/by-2-0 |
| Maa-amet orthophoto | Estonia | about 0.3 to 0.4 m | Estonian Land Board open data |

Per-source zoom limits are the highest level each service really serves. Estonia stops at zoom 16 because zoom 17 has holes (Tallinn's old town answers blank there); MapLibre enlarges the zoom 16 tile instead of leaving a gap. Japan stops at 18.

Not included, with the reason:
- **No open aerial imagery service found:** United Kingdom, Ireland, Canada, all of Africa, Latin America, the Middle East, most of Asia.
- **Needs a key or token:** Denmark, Finland, Sweden, New Zealand, South Korea.
- **Endpoint did not answer or failed the checks:** Wallonia, Slovakia, Portugal, Italy, Norway, Lithuania, Baden-Württemberg, Hamburg, Berlin, Brandenburg, Hessen, Lower Saxony (wrong or changed address; worth retrying with the provider's current documentation).
- **No CORS headers (cannot be used from a browser):** Schleswig-Holstein, USDA NAIP.
- **Tile service not suitable:** Hong Kong (very large PNG tiles, tiny area), Singapore (404).

Add a source to `HIRES_SOURCES` once a keyless, CORS-enabled endpoint is confirmed, and add its host to the Content-Security-Policy in `index.html` and the tile hosts in `public/sw.js`.

### How blank areas are handled

Several services answer outside their coverage with a pure white JPEG or an error. A white tile would hide the base map, so the `hires://` tile handler turns white, empty and failed tiles into a transparent tile. A provider outage therefore shows the global layer instead of a hole.

### Attribution

Only the providers whose imagery is actually in view are credited (rebuilt as the view changes), so the required credit stays visible instead of being buried in a list of eleven.

## Other live sources

| Source | Used for | Terms |
|---|---|---|
| Mapterhorn (Copernicus GLO-30, zoom ≤ 12) | Elevation for coverage, path profile, drone envelope, offline packages | Copernicus DEM licence, attribution required: "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA"; Mapterhorn attribution at mapterhorn.com/attribution. See ADR 0007 |
| AWS Terrain Tiles (Terrarium) | Elevation fallback per tile; 3D map terrain | Open, see registry.opendata.aws/terrain-tiles |
| OpenStreetMap, Overpass, OpenFreeMap, Photon | Towers, buildings, search | ODbL 1.0, attribution required |
| CelesTrak | Satellite element sets (LEO pass window) | Public, citation requested |
| ESA WorldCover 2021 via Microsoft Planetary Computer data API | Clutter (worldwide) | CC BY 4.0 |
| ESA WorldCover via Digital Earth Africa WMS | Clutter fallback (Africa only) | CC BY 4.0 |
| Meta/WRI Canopy Height Map v2 via source.coop (Taylor Geospatial mirror) | Tree heights in clutter | CC BY 4.0 |
| Bare-earth LiDAR via Mapterhorn (zoom 13–14, ~35 countries) | Terrain for small P.1812 runs with clutter | per source, see mapterhorn.com/attribution |
| Overture Maps buildings | 3D buildings (optional) | ODbL / CDLA, see overturemaps.org |
| FCC equipment database | Radio specifications | US public records |
