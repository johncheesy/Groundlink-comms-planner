# M6 — PACE plan & comms-structure report (authoritative spec)

Turn everything the planner already knows — the M5 radio mix, the M3/M4 sites,
the last coverage run, the M2.1 airborne relay — into a coherent **PACE plan**
(Primary · Alternate · Contingency · Emergency), a **comms-structure summary**,
and an **exportable report**. Read alongside `CLAUDE.md`, `../context.md`,
`docs/M5-radio-import.md` (the mix output is M6's input contract).

## Current state (build on, don't duplicate)

- `src/radios/mix.js` already emits a ranked band list where each band carries a
  *first-pass* `pace` tag (`Primary|Alternate|Contingency|Emergency`) and a
  `why`. M6 **consolidates** that first pass into one recommendation per tier —
  it does not re-rank bands.
- The status bar already shows a one-line PACE readout; M6 adds the full plan.

## 1. PACE engine — `src/pace/pace.js` (pure, unit-tested)

`buildPace(input) -> plan`. Pure + DOM-free so it is unit-testable and reused by
the report builder.

Input (all optional, sensible fallbacks): `{ mix, sites:{fixed,recommended},
coverage:{coveredFrac,terrain,clutter}, drone:{relay,altitudeM}, params,
mission, build, generatedAt }`.

Output:

```
{
  legs: [ { tier, band, asset, role, why, status }, …4 ],   // P, A, C, E order
  overlays: [ { band, why } ],     // non-tier additions (LoRa telemetry)
  structure: { fixedSites, recommendedSites, totalSites, talkInHeightM, topology, note },
  summary: string,
  gaps: [tier, …],                 // tiers the rules could not fill
  context: { …echoed for the report… },
}
```

`leg.status`: `ok` terrestrial LOS band the raster models · `separate` a real
leg not rastered this milestone (HF NVIS) · `asset` an assured/airborne asset
(satcom, UAS relay) · `gap` no candidate for this tier.

### Consolidation rules (rule-based, explainable — no AI)

- **Primary** — best-ranked terrestrial line-of-sight band (VHF/UHF) from the mix.
- **Alternate** — the 2nd terrestrial band if present; else the **airborne relay**
  when a drone relay is active (matches the app's "Airborne = Alternate"
  convention); else a gap with guidance.
- **Contingency** — HF NVIS (flagged `separate`) if present; else the airborne
  relay if not already used; else a 3rd terrestrial band; else a gap.
- **Emergency** — Satcom, always (the mix always proposes it).
- **Overlays** — LoRa is a telemetry/tracking overlay, not a voice tier; surfaced
  separately.
- Unfilled tiers are reported honestly in `gaps` with a one-line "how to fill it".

Topology from site count: `0 → standalone`, `1 → single-hub`, `≥2 → relay-network`.

## 2. Report export — `src/pace/report.js` (client-side, zero dependency)

One report, three export routes the user ticks (checkboxes, any combination):

- **PDF** — open a print-optimised report in a new tab and trigger the browser
  print dialog → *Save as PDF*. Highest fidelity, no dependency. Pop-up blocked →
  fall back to a downloadable standalone `.html`.
- **Word** — an `application/msword` `.doc` Blob (HTML that Word opens + edits).
- **Excel** — an `application/vnd.ms-excel` `.xls` Blob of the plan tables.

Rationale and the later true-OOXML option: `docs/decisions/0003-report-export.md`.

The report carries: header (build stamp + timestamp), the plan summary, the PACE
table, the comms structure (site table + topology + talk-in), mission & link
parameters, the full radio mix, and the standing caveats.

**OPSEC.** Everything is built and downloaded in the browser; no coordinates are
uploaded or committed. The footer states this explicitly.

## 3. UI — "Comms plan" panel section

A section after Drone relay: **Build comms plan** → renders the four PACE legs
(tier badge + bearer + role/why), the structure line, and the summary. Then an
**Export report** block with **PDF / Word / Excel** checkboxes (PDF ticked by
default) and an **Export report** button. Reuses the existing `.badge` tier
colours (Primary = ok, Alternate = ref, Contingency = warn, Emergency = bad).

## 4. Wiring — `src/main.js`

- `gatherPaceContext()` snapshots the mix (`recommendMix(gatherMixInput())`),
  fixed sites (`mission.getSites()`), recommended masts (`recommender.getSites()`),
  coverage stats, drone state (`hasDrone`/`getAltitude`), link params, mission
  summary and the build stamp.
- `renderPace(plan)` paints the legs/structure/summary; the export button reads
  the checkboxes and calls `exportReport(lastPlan, { pdf, word, excel })`.
- DEV handle: `window.__gl.pace.build()` / `window.__gl.pace.last`.

## Acceptance

1. With a VHF/UHF/HF/Satcom mix → four distinct tiers: Primary VHF, Alternate
   UHF, Contingency HF NVIS (separate), Emergency Satcom; no gaps.
2. Minimal mix (VHF + Satcom) → Primary VHF, Emergency Satcom, Alternate +
   Contingency reported as gaps with guidance.
3. Place a drone relay, then build → Alternate becomes the airborne relay (with
   its altitude).
4. Tick PDF → a print view opens; tick Word and Excel → `.doc` and `.xls`
   download; tick all three → all happen. Untick all → a "tick at least one" hint.
5. Report header shows the build stamp; footer states it was generated locally and
   not uploaded.
6. `src/pace/pace.test.js` covers the four-tier consolidation, satcom-always-
   Emergency, gap reporting, the airborne-Alternate path, topology, the LoRa
   overlay and the summary.
