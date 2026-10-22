# GroundLink 0.9.0-beta (+M48) — product review, 21 Oct 2026

Scope: stress test, five user personas that touch every tool, competitor analysis, a prioritised improvement plan per component, and advice on asking for help on Reddit. Nothing in the app was changed for this review.

---

## 1. Verdict in six lines

1. **Stable.** No crash, no XSS, no memory leak, no data corruption found across fuzzing, hostile files, undo spam, mutation during compute, and offline mode.
2. **Typical performance is good.** A coverage run takes 1–2 s. 120 sites take 17 s without freezing the page because the work runs in a worker.
3. **The weak spot is trust, not stability.** The app can show confident numbers on thin ground: a readiness score of 100 with nothing analysed, "100% covered" with default radio values, a coverage grid that is much coarser than it looks.
4. **A few input paths have no guard rails.** One click can freeze the page for 32 s, a hand-edited mission file can half-load, and objects far apart give opaque errors.
5. **Against competitors** GroundLink wins on mission-level planning (PACE, readiness, Erlang, deconfliction, power, satcom) and on being free, offline and account-free. It loses on antenna patterns, global clutter, best-server/interference rasters, and perception ("no ITM"). One free competitor, Meshtastic Site Planner, already ships in-browser ITM and offline.
6. **Do not post for help on Reddit yet.** First fix the trust items in section 7 (P0) and add a licence file. Details in section 8.

---

## 2. Method and limits (read before trusting the numbers)

- Real app on the Vite dev server, driven in the built-in browser pane. Real mouse clicks for map work (AOI circle, polygon, route, points, path profile, drone/GCS placement). Scripted DOM clicks and form events for the rest.
- **Tool coverage:** 190 of 195 distinct controls were activated at least once. The five left are the three stepper items, one section label and one conditional "Define AOI" button.
- Downloads were intercepted in memory. Nothing was written to disk and nothing was sent to CloudRF (the key test ran against a stubbed fetch with a dummy value).
- **Not tested:** a real phone, real field data, real FCC lookups (the dummy ID gave no visible result), CloudRF with a real key, GeoTIFF/COG upload, long multi-hour sessions, Safari and Firefox, a production build served over HTTPS (service worker path).
- **Environment effects that are not app bugs:** the Esri imagery default returned 403 from this network, so the map was black until I chose Sentinel-2. The pane produces no animation frames until a screenshot is taken, which delayed app start. The WorldCover WMS answered curl but failed from the page for a reason I could not resolve here.
- Synthetic data only. Observer positions and CSV rows are generated, never real sites.

---

## 3. Stress test results

| # | Test | Result |
|---|---|---|
| S1 | 60 AOI changes in 230 ms incl. poles and antimeridian, with the new satcom panel live | Pass. Final panel matches the last AOI. No stale write. |
| S2 | Bulk add: 9 valid + 17 hostile lines | 12 added, 12 rejected with line numbers, no XSS. Parser gaps in section 5. |
| S3 | Coverage at 5, 20, 50, 200 km radius | 1.1–2.0 s each. Grid always 48,400 cells (see F6). |
| S4 | 25 sites 2.5 s, 120 sites 17 s, 3 sites on 3 continents | Local fine. Worldwide throws and silently falls back to flat earth (F7). |
| S5 | Triple-click Compute | One result, no error. |
| S6 | Site recommendation, 6 parameter sets incl. 0, −5, 150, 500 | No error. Invalid values stay in the field (F14). |
| S7 | Alps, 868 MHz at 25 mW, 20 km | Single site covers 9%. Eight recommended sites reach about 82%. Realistic. Site 1 sits on a 3,868 m summit (F20). |
| S8 | Mission file: 14 variants incl. wrong format, newer version, prototype pollution | Format/version checks good, no pollution. Lat 95 throws mid-load, a null-coordinate site vanishes silently, 100k-char names freeze 2.5 s (F8). |
| S9 | Import: KML, GeoJSON, GPX, empty, bad XML, XML bomb, XSS names, 5.3 MB / 50k points | Robust. GPX already works. Invalid geometry leaves "Importing…" stuck (F11). |
| S10 | Promote 50k imported points to sites | **Page frozen 32 s** (F1). |
| S11 | Numeric fuzz on frequency, power, heights | No error. Silent clamping (F14). |
| S12 | Undo/redo ×100, delete and move during compute | Correct, no error. |
| S13 | Offline (all external fetches rejected) | Clear toast for towers, coverage still runs from cache. |
| S14 | 40 compute/clear cycles | Heap flat at 59–65 MB. No leak. |
| S15 | Keyboard: ⌘K, Ctrl+K, ⌘Z, ⌘S | All work. |
| S16 | Mobile 375 px | No horizontal scroll, but toolbar clips, beta card covers half the map, 43 of 213 controls are under 32 px. |
| S17 | Accessibility scan | No duplicate ids or images without alt. Five controls without a name, no h1, 306 tab stops. |

---

## 4. Persona sessions

| Persona | Flow | What worked | Friction |
|---|---|---|---|
| **P1 Anti-poaching coordinator** | Search a reserve, draw AOI, radios, run-all, site advice, drone relay + optimiser, GCS, cellular, power, PACE, three report formats | Typeahead search is excellent. Run-all chain is a good idea. Exports captured. | "Analysis complete — 100% covered" appears with no radio chosen (defaults 150 MHz, 5 W). Drone optimiser shows 100% at every height, which hides its value. Clutter silently unavailable (F10). |
| **P2 SAR lead** | Alps route, points, waypoint, HF, path profile, mast-height wizard | Path profile is professional (obstruction, −7.1 dB margin). HF panel works. | Satcom panel ignores route/point missions (F19). Waypoint dialog and profile tool were armed at once. |
| **P3 Humanitarian telecom** | Radio library, FCC, DMR, teams, bulk add, polygon AOI, freq plan, topology, all exports, save mission | Bulk add and polygon feel good. Exports work after a coverage run. | Save structure crashes on `prompt()` (F9). FCC lookup shows no result after 12 s. Raster exports silently do nothing without coverage (F12). |
| **P4 Defence signals officer** | RSSI calibration, thresholds, model section, CloudRF settings, brief, ops dashboard | Calibration import/apply/export works. Brief and dashboard render. | Readiness score logic misleads (F2). CloudRF test says "Key rejected" for a network failure. |
| **P5 Mining/expedition power user** | 3D, tilt/bearing, buildings (two sources), basemaps, theme, offline pack, zoom, locate | 3D, buildings and themes work. | Offline pack said "AOI too large" for a 1.5 km AOI. Cause was a stray far-away waypoint in my own test state (same weakness as F5). |

---

## 5. Findings register

Severity: **S1** damages trust or blocks use. **S2** wrong or confusing, workaround exists. **S3** polish.

| ID | Sev | Component | Finding | Evidence |
|---|---|---|---|---|
| F1 | S1 | Import | "Points → sites" has no cap. 50k points freeze the page. | 32,380 ms long task, 50,000 sites created |
| F2 | S1 | Readiness | Score averages only the dimensions that exist. Missing ones do not count against it. An AOI alone shows 100, a route in the Alps 75. | `computeReadiness` filters nulls; badge values 100/75/13/42 seen |
| F3 | S1 | Coverage | Defaults (150 MHz, 5 W, 10 m mast, clutter off, optimistic thresholds) produce "100% covered" without any radio chosen, and the completion toast does not say so. | Kruger 13 km UHF 2 W also 100% |
| F4 | S1 | Coverage | Fixed 220-cell grid over a window larger than the AOI. Effective AOI resolution is about 73 cells across. | 3.4k–4.2k AOI cells of 48.4k. About 136 m/cell at 5 km, 545 m at 20 km, 1.4 km at 50 km |
| F5 | S1 | Mission | Objects far apart (Amsterdam + Cape Town) throw a LngLat error, fall back to flat earth with no warning. Offline pack reports "AOI too large". | console error; "FSPL · flat" |
| F6 | S1 | Map | No state or fallback when the default imagery provider is blocked. The user sees a black map and no explanation. | Esri 403 here; OSM/Sentinel available |
| F7 | S2 | Mission file | Lat 95 throws during apply and leaves 200 sites plus an AOI half-loaded. A site with null coordinates is dropped with a normal "loaded" message. 100k-char names freeze 2.5 s. | S8 |
| F8 | S2 | Import | Invalid geometry leaves "Importing…" and an unhandled rejection. | S9 |
| F9 | S2 | Radios | `radios.js:364` uses `window.prompt()`, uncaught where prompts are blocked. Nothing saved. | Uncaught Error |
| F10 | S2 | Clutter | 4 s time-out and silent null on any failure. Message says "Africa-only" even when the cause is slowness. Cold request took 5.1 s by curl. In-page fetch failed here for an unresolved reason. | worldcover.js, curl timing |
| F11 | S2 | Coordinates | Parser rejects decimal comma (Dutch/EU), `N52.5 E4.5` prefix style, parentheses, leading +, `geo:` URIs, Google Maps links, unicode minus, semicolons. | S2 matrix |
| F12 | S2 | Export | GeoTIFF, KMZ and TAK buttons are enabled but do nothing without coverage. No message. | out+0, then 206 KB / 17 KB / 14 KB after compute |
| F13 | S2 | Inputs | Invalid numbers are clamped (30–6000 MHz, 0.01–100 W, 1–300 m) while the field keeps showing the invalid value. | `coverageParams` |
| F14 | S2 | Exports | "Word" and "Excel" are HTML files with a changed extension. Excel warns on open. "PDF" is browser print. | blob types |
| F15 | S2 | Satcom | Panel only follows an AOI. Route and point missions show "Define a mission area". | P2 |
| F16 | S2 | Recommend | No accessibility or practicality constraint. Sites land on summits (3,868 m). | S7 |
| F17 | S3 | Satcom | Footer prints "−1.3° N, 36.8° E" for southern and western positions. | satcom-panel.js |
| F18 | S3 | Mission | Names are uncapped (5,000 chars accepted). | S2 |
| F19 | S3 | Cellular | Readout says "No towers found" when the real cause is a failed fetch. | offline test |
| F20 | S3 | Status | "Placing point" stays in the status bar after the mode ended. | P2 |
| F21 | S3 | Tools | Waypoint placement and path profile can be armed at the same time. | P2 |
| F22 | S3 | CloudRF | Network failure reported as "Key rejected". | P4 |
| F23 | S3 | Clipboard | `writeText` has no catch. Unhandled rejection when permission is denied. | sweep |
| F24 | S3 | AOI | `setRadius` accepts lat 95 and throws. Not reachable by drawing, reachable by file load (F7). | S1 |
| F25 | S3 | Mobile | Toolbar clips, beta card covers half the map, 43 small tap targets. | S16 |
| F26 | S3 | A11y | Five unnamed controls (bulk textarea, four power fields), no h1, long tab order. | S17 |
| F27 | S3 | Startup | App wiring waits for the first map frame. A tab opened in the background has dead controls until focused. Low risk, noted. | observation |

---

## 6. Competitor analysis

Source: a research agent that fetched vendor pages on 21 Oct 2026. Full report with URLs and matrix: `competitors.md` in the session scratchpad (copy it into the repo if you want to keep it). Items the agent could not verify are marked.

### 6.1 Who they are and what they offer

| Competitor | Who uses it, why | Price / licence (as fetched) | Threat |
|---|---|---|---|
| **CloudRF** | Defence, blue-light, telecom, TAK users. Calibrated engines, about 3,000 antenna patterns, global clutter/canopy/LiDAR, API, ATAK plugin, VOACAP HF, satellite tool, offline SOOTHSAYER server. | Free tier: 10 km radius, 50 calls/month. £40 to £288 per month. SOOTHSAYER by quote. | High |
| **Meshtastic Site Planner** | LoRa/mesh community. ITM via SPLAT! in WebAssembly, offline PWA, multi-site, highpoint search, link analysis, KML/GeoJSON. | Free, GPL-3.0, no account | High for LoRa, low for tactical planning |
| **Radio Mobile / Online** | Hams and NGOs for 25 years. Familiar, free. | Free; online version needs an account and is slow | Medium |
| **Airendil** | Modern free browser planner, six elevation sources incl. LiDAR, per-node antenna beamwidth. Weaker physics. | Free, no account | Medium |
| **Hawk Mesh, 9M2PJU, RF Coverage Explorer, CellScope Pro, CanIReach** | Niche browser or phone tools. Some already have best-server/SINR or relay counting. | Mostly free | Low |
| **Cambium LINKPlanner, Ubiquiti UISP** | Link design for their own hardware. LINKPlanner has a BOM. | Pricing unverified | Low |
| **ATDI HTZ, EDX, Atoll, HII TIREM/VIPER** | Procurement-grade defence and operator suites. Set the credibility bar. | Quote only | Low commercially |
| **SPLAT!, Signal-Server** | Engines behind other tools. | GPL, dated | Low |

### 6.2 What they do better

- **Model breadth and perceived credibility.** CloudRF and Meshtastic Site Planner offer ITM. Users equate ITM with "real". (CloudRF itself now recommends P.1812 over ITM in its own tests, which supports GroundLink's choice.)
- **Antenna patterns.** CloudRF about 3,000, Airendil beamwidth and front-to-back. GroundLink uses a fixed 2.15 dBi transmit gain and 0 dBi receive gain in the coverage path.
- **Clutter and canopy.** CloudRF includes global data on every plan. GroundLink depends on an Africa-only WMS or a local upload.
- **Best-server and interference rasters.** CloudRF, HTZ, CellScope Pro and RF Coverage Explorer have them.
- **Integration.** CloudRF has an API and a live ATAK plugin. GroundLink exports files only.

### 6.3 What GroundLink does better

- **Mission-level planning in one tool.** PACE generation, readiness, Erlang-B, frequency deconfliction and endurance. The agent found no competitor that does this. It did not inspect CloudRF's paid PNUT interface, so check before claiming uniqueness.
- **Free without caps, accounts or quotas, and offline.** CloudRF's free tier is 10 km and 50 calls.
- **Site recommendation, mast-height wizard and drone relay optimiser on the free tier.** CloudRF gates best-site analysis at the Gold plan.
- **Field calibration from RSSI CSV.** Found only in pro suites and one cellular tool.
- **Terrestrial, HF and satcom together,** including live LEO/MEO pass windows.

### 6.4 Honest caveats

- "Free, browser-only, offline" is **not unique**. Meshtastic Site Planner, Airendil and others match it.
- P.1812 and Delta-Bullington exist elsewhere. Without a published validation against CloudRF or field data, do not claim parity.
- Terrain from Terrarium is the same class of data Meshtastic uses. No accuracy edge.
- Radio import from FCC IDs is US-centric. This is an inference, not verified.

### 6.5 Underserved segments (where to aim)

Offline multi-site VHF/UHF planning for under-funded conservation and humanitarian teams. SAR and expedition teams needing HF plus VHF plus satcom in one plan. ATAK users without network. Mining and remote sites needing cheap DMR/P25 capacity planning with coverage. Phone-first field use.

---

## 7. Improvement plan, prioritised per component

Effort: S under a day, M a few days, L a week or more.

### P0 — Trust and safety (do first, about one week total)

| Component | Change | Effort | Fixes |
|---|---|---|---|
| Readiness | Show "n of 6 assessed". Hide the score until at least three dimensions exist, or count missing ones as zero. | S | F2 |
| Coverage | Show an assumptions strip in the result card: frequency, power, mast and receiver height, clutter on/off, grid cell size. Say "no radio selected, defaults used" in the completion toast. | S | F3 |
| Import | Cap "Points → sites" (for example 200, with a confirm above 50). Chunk the add. | S | F1 |
| Mission validation | Shared geo validator for file load, import and AOI. Reject or skip invalid coordinates and report "2 objects skipped". Cap name length. Wrap apply so a failure rolls back. | M | F7, F8, F18, F24 |
| Far-apart objects | Detect a mission span above a threshold and warn which objects are far from the AOI. Clamp the compute window to ±85° latitude. Say why offline packaging refuses. | M | F5 |
| Basemap | Detect repeated tile failures, show a banner, offer OSM or Sentinel-2, optionally switch automatically. | S | F6 |
| Radios | Replace `prompt()` with the existing dialog pattern. | S | F9 |

### P1 — Credibility with technical users (two to four weeks)

| Component | Change | Effort |
|---|---|---|
| Coverage resolution | Make cell size selectable and adaptive to AOI size. Tile large areas. Show the cell size. | L (F4) |
| Antenna model | Per-radio gain, beamwidth, heading and a simple pattern import. Start with omni, dipole, Yagi presets. | M–L |
| Clutter | Replace the Africa-only WMS with a global source delivered as PMTiles or COG, with a proper time-out and honest messages. | M–L (F10) |
| Validation page | Publish a comparison against CloudRF/ITM and any field RSSI you can share. This is the single best answer to "is it accurate?". | M |
| Best-server and interference rasters | Spec exists (`M24-best-server.md`, `bestserver.js` is already present). Finish and expose. | M |
| Exports | Real `.docx` and `.xlsx`, or rename honestly to HTML. Disable raster exports until coverage exists and say why. | M (F12, F14) |
| Coordinates | Accept decimal comma, N/E prefix, parentheses, `geo:` and map links, unicode minus. | S (F11) |
| Satcom and HF | Follow route and point missions, not only the AOI. Fix the N/E sign. Include the LEO window in the readiness score. | S–M (F15, F17) |
| Site recommendation | Optional accessibility layer (roads, slope, elevation ceiling) and a "must be within X km of a road" filter. | M (F16) |

### P1 progress (22 Oct 2026)

- **Terrain upgraded** to Copernicus GLO-30 via Mapterhorn (ADR 0007).
- **F4 coverage resolution:** the cell size now follows the AOI with a compute budget, plus a High detail setting (`src/coverage/grid.js`). A 20 km-radius AOI went from about 545 m to 321 m per cell (185 m on High).
- **F10 global clutter:** ESA WorldCover now comes from Microsoft Planetary Computer for the whole world (DEA WMS kept as Africa fallback), 15 s time-out, and the reason is shown when clutter is missing.
- **Tree heights:** Meta canopy height (CHM v2) refines WorldCover clutter; small P.1812 runs use bare-earth LiDAR where it exists (ADR 0008).
- **Antenna model (M49):** gain, beamwidth, pointing, front-to-back and rx gain with omni/dipole/Yagi/sector/panel presets (`src/coverage/antenna.js`).
- **Sharpest open aerial imagery** per country and Esri licence handling shipped (PR #29).

### P2 — Reach and differentiation (later)

| Component | Change | Effort |
|---|---|---|
| ITM in browser | Check licences first. SPLAT! is GPL. NTIA's own ITM implementation may be public domain, but verify before relying on it. | L |
| Sharing | Read-only share link with no coordinates in the URL, or an encrypted file hand-off. | M |
| TAK | Offline-capable ATAK plugin or data package workflow. CloudRF's plugin needs a network. | L |
| Costed BOM | Spec exists (`M26-auto-bom.md`). | M |
| Mobile | Phone layout pass: toolbar, beta card, tap targets. | M (F25) |
| Accessibility | Name the five controls, add an h1, review tab order. | S (F26) |
| Small fixes | F19–F23: status text, tool arming conflicts, error classification, clipboard catch. | S each |

### Suggested order

1. **Week 1:** the whole P0 table, plus a regression test per fix.
2. **Weeks 2–4:** resolution, antenna presets, validation page, best-server. These four change how technical users judge the tool.
3. **After that:** clutter, exports, ITM decision, sharing.

---

### Status of P0 (updated the same day)

All seven P0 items are done on branch `fix/p0-trust`, with tests (479 pass) and live checks in the app.

| P0 item | Result |
|---|---|
| Basemap failover (F6) | Done. Verified against a real Esri block: switches in about 10 s, a reload makes no Esri requests, retry falls back again without looping. |
| Readiness (F2) | Done. Needs 3 of 6 checks, shows "based on n of 6". |
| Assumptions strip (F3) | Done. Result card and completion toast. The grid cell size is shown but F4 (fixed 220-cell grid) is a P1 item and is not fixed yet. |
| Import cap (F1) | Done. 300 sites and 300 points. Promoting 20,000 points takes 1.9 s. |
| Mission validation (F7, F8, F18, F24) | Done. |
| Far-apart objects (F5) | Done. Explained in Coverage, Site recommendation and Offline package. |
| `prompt()` (F9) | Done. |

Not touched on purpose: F4, F10 to F17 and F19 to F27, which sit in P1 and P2.

---

## 8. Asking for help on Reddit

### Before posting

- **Add a licence file.** `GROUNDLINK CODE` has none and `package.json` says private. Without a licence nobody can lawfully contribute. Pick one on purpose. If you want to reuse GPL ITM code later, that choice interacts with it.
- **Add CONTRIBUTING and a short "good first issue" list.** The P0 and small P2 items are good candidates.
- **Scan git history for coordinates and secrets** before the repository gets attention. Your OPSEC rule covers the public build, not necessarily older commits.
- **Fix P0 first.** Technical readers will find the readiness score and the grid resolution within minutes.
- **Be upfront about how it was built.** Say it is AI-assisted. It avoids a trust hit and some communities require disclosure. Check each community's current rules yourself. I did not verify any subreddit rules or even that each name exists today.

### Where (candidates, verify each)

| Audience | Why | Ask |
|---|---|---|
| Amateur radio | Know propagation and will test claims | "Does this match your measured coverage?" |
| Meshtastic / LoRa | Direct comparison with their planner | "What would make you use this alongside it?" |
| TAK users | Export and plugin demand | "Which hand-off do you actually need offline?" |
| GIS | Data and tiling advice | Global clutter source, grid resolution |
| SAR, conservation, humanitarian | The target users | Workflow review, not promotion |

Post in one community first, wait for the feedback, fix, then widen.

### What to ask for (specific asks get answers)

1. Anyone with logged RSSI along a route to run it through the calibration tool and report the deviation.
2. A review of the propagation assumptions in `docs/E2-p1812-engine.md`.
3. Help choosing a global clutter source.
4. Testers on phones and in Safari and Firefox.

### Draft (English, edit freely)

> **Free, offline, browser-based comms coverage planner (beta) — looking for people to break it**
>
> I'm building GroundLink, a terrain-aware radio coverage and planning tool that runs entirely in the browser. No account, nothing uploaded, works offline after first load.
>
> What it does: area, site, route or point missions in lat/long, MGRS or UTM; coverage with FSPL+Deygout or ITU-R P.1812 over Terrarium terrain; site recommendation; mast-height and drone-relay helpers; PACE plan, frequency deconfliction, team capacity; GEO and live LEO satcom windows; KMZ, GeoJSON, GeoTIFF and TAK exports.
>
> What it is not: survey-grade. No antenna patterns yet, clutter is limited, and the coverage grid is coarse for large areas. I just ran a stress test and found things I'm fixing now.
>
> What I'd love help with: (1) run your own measured RSSI through the calibration tool and tell me how far off it is, (2) tell me what is missing for your use, (3) tell me where the UI confuses you.
>
> Built with AI assistance. Link: <url>. Please don't post real operational site coordinates in replies.

### Risks

- A "100% covered" screenshot from the default settings will be quoted against you. Fix F3 before posting.
- Self-promotion rules differ per community. Read them and ask the moderators if unsure.
- Comparison threads with Meshtastic Site Planner and CloudRF will happen. Have the honest section 6.4 ready.

---

## 9. What I did not do

- No code fixes for the findings above. Plan only, as requested.
- No posting anywhere.
- The earlier M48 work stays on branch `feat/leo-passes` (two commits), not merged or pushed. This report is a new, uncommitted file.
