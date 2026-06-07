# M5 — Radio import & multi-band mix (authoritative spec)

Search & import the radios you actually carry; their specs drive the coverage model. Plus rule-based multi-band recommendations (feeds M6 PACE). Read alongside `CLAUDE.md`, `../context.md` (§Radio import — data sources).

## Reality check on data sources (researched, design follows from this)

- The FCC **EAS Web API** exists (KDB 953436: `getFCCIDList` etc.) and grant data is public, but **browser CORS is unverified and likely blocked** on `apps.fcc.gov`; we are web-first with **no backend**, so FCC lookup must be best-effort, never the critical path.
- A grant gives frequency range / max output power / emission designators — **not** channel plans or antenna limits. SDoC devices and much Part-97 (amateur) gear aren't in the DB at all.
- ETSI/CE has no usable public API; manufacturer datasheets are PDFs.

**Therefore: three tiers, all landing in the same editable model.**

## 1. Radio model — `src/radios/model.js`

```
radio = {
  id, label,                          // "Motorola R7 VHF"
  role: 'handheld'|'mobile'|'base'|'repeater'|'lora'|'satcom'|'hf',
  freqRangeMHz: [lo, hi],
  defaultFreqMHz,
  powerW,                             // max conducted output
  rxSensDbm,                          // receiver sensitivity (12 dB SINAD or spec)
  antennaGainDbi,
  defaultHeightM,                     // 1.5 handheld, 2 mobile, 10+ base/repeater
  source: 'library'|'fcc'|'manual',
  notes,
}
```

Every field user-editable in a small form; nothing is ever locked. Persist the user's radio set in `localStorage` (hosted origin only — in-memory fallback elsewhere, see CLAUDE.md constraint).

## 2. Tier 1 — curated built-in library (`src/radios/library.json`)

~20 entries covering the typical mix per sector: VHF/UHF handhelds (e.g. Motorola R7, Hytera HP685, Baofeng UV-5R class), VHF/UHF mobiles + repeaters (e.g. SLR 5500 class), HF manpack/base (Codan, Barrett class), LoRa/Meshtastic nodes, Iridium satcom (as PACE asset, no coverage raster). Indicative specs from public datasheets, flagged `"indicative": true` in the UI ("check against your radio"). Searchable by name/band/role. Instant, offline, zero requests.

## 3. Tier 2 — FCC ID lookup (best-effort)

- Input: FCC ID (printed on every certified device) or free-text model search.
- Try the EAS Web API directly from the browser (document the endpoint used). **On CORS/network failure — expected — degrade gracefully**: show a "Open FCC record" / "Open fccid.io" external link (new tab) plus a compact manual form (freq range, power, sensitivity) so the user transcribes four numbers. No scraping, no third-party fetch fallback.
- If a response does come through: map grant frequency range + output power into the model, leave sensitivity/gain at role defaults, set `source:'fcc'`.
- Caveat line in the UI, verbatim from context.md: grant ≠ channel plan; treat as a strong starting point, edit to match your config.
- A Phase-B tiny proxy (or build-time snapshot) is a *later* option — note it in `docs/decisions/`, don't build it now.

## 4. Wiring radios into coverage

- "Active radio set" in the panel: pick **infrastructure tx** (base/repeater) + **field unit** (handheld/mobile). Talk-in stays the binding link: tx params from the infrastructure radio, rx height + sensitivity from the field unit.
- Selecting radios fills the existing coverage controls (freq, power, heights) and derives thresholds from `rxSensDbm`: marginal = sens + 7 dB, good = sens + 15, excellent = sens + 25, none = sens (keep editable; defaults documented in the help line).
- M3 recommendation and the drone module read the same params — no separate radio state anywhere.

## 5. Multi-band mix recommendation — `src/radios/mix.js` (pure, unit-tested)

Rule-based (no AI, explainable), input = mission shape + terrain stats already available (AOI area / route length / max site-to-site distance; terrain ruggedness = stddev of the DEM sample grid; coverage fraction from the last run):

- **VHF**: default ground-mobile workhorse — range in vegetation/open terrain.
- **UHF**: dense urban / indoor / building penetration; short paths.
- **HF NVIS**: any required path > ~50 km or beyond-LOS with no repeater option — flag as separate module (no raster in this milestone).
- **LoRa**: low-rate telemetry/tracking overlay when many fixed points exist.
- **Satcom**: always proposed as Emergency leg (feeds M6 PACE) and primary where nothing else reaches.

Output: ranked list with a one-line *why* per band (e.g. "UHF: 60% of demand sits in built-up WorldCover classes"). Render in a "Radio mix" panel card. This output object is the contract M6 consumes — document its shape.

## Acceptance

1. Pick library handheld + repeater → coverage controls fill themselves; compute runs with those params; thresholds derived from sensitivity.
2. Enter a known FCC ID with network blocked → graceful manual-form fallback, no console error spam, external record link works.
3. Edit any imported spec → recompute uses the edit; `source` flips to `manual`.
4. Radio set survives reload on the hosted origin; in-memory in embedded previews.
5. A 60 km route mission with hilly DEM → mix recommends HF NVIS + VHF with readable rationale.
6. `mix.js` unit tests: urban AOI → UHF first; long route → HF present; satcom always in the list.
