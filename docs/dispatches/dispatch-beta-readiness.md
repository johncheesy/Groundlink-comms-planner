# Dispatch — BR1 · Beta Readiness

**GroundLink Comms Coverage Planner — full audit-driven upgrade to `v0.9.0-beta`.**
Runnable by Claude Code (from `GROUNDLINK CODE/`) or Cowork (from `THE GROUNDLINK/`).
Written 6 Jul 2026, grounded in a 4-track audit of the same date (Appendix A). Named **BR1** — deliberately outside the M-series, because M-numbering itself is one of the things this dispatch repairs.

---

## Mission

Take the app from "M47 feature-complete" to **beta-releasable**: security-hardened, OPSEC-clean, documentation truthful, performance-sane, UI polished, versioned and tagged. A complete refresh of any part is allowed **as long as it measurably improves the app** and respects the guardrails below. When in doubt: beta means *trustworthy and finishable*, not *more features*. Feature work is out of scope except where a gap would embarrass a beta.

## How to run this dispatch

1. Read `CLAUDE.md`, then `../context.md`, then `docs/design-tokens.md`. CLAUDE.md is the accurate status source; context.md is stale until Phase 2 fixes it.
2. Load the **Superpowers** skill (`groundlink-superpowers`) — it carries the Maven lens, the design law and the shipped-milestone list. Keep it active for every phase.
3. Work phase by phase, in order. Each phase ends with a **gate**: `npm test` + `npm run build` clean, a short phase report (format in §6), and a pause for Keith on anything marked ⚠️ KEITH.
4. Branch per phase (`br1/phase-1-security`, …). **Never push, merge, tag or rewrite history yourself** — prepare everything, hand the exact commands to Keith. He commits and deploys from Claude Code.
5. Small verifiable steps; ask before any change touching 6+ files at once. Test in a real browser (`npm run dev`) before declaring a phase done.

## Non-negotiable guardrails

- **OPSEC:** no real coordinates, secrets, personal names/emails or org references in any committed artifact. CloudRF key = sessionStorage only. Mission files stay local.
- **Free/no-key** external services only. Justify every new dependency; prefer zero.
- **Vanilla JS ES modules** — no frameworks. Plain CSS with tokens from `styles/tokens.css`; never hardcode theme colours.
- **Design law:** teal = action/signal, azure = assets, amber = events, aqua→rose coverage spectrum; Sora + Hanken Grotesk, tabular figures; map-first, dark canvas in both themes; **no AI-app tells** (purple/indigo gradients, glassy neon, sparkle icons, gradient headlines).
- **Domain-neutral wording** in all UI and public docs.
- TDD on pure logic; `npm test` + `npm run build` green before every gate.

## Tool arsenal — where to use what

Use each tool where listed. If a tool is not installed in the running environment, note it in the phase report and do the equivalent manually — **never skip the step itself**.

| Tool | Phase | Use for |
|---|---|---|
| `/powerup` | 0 | Load skills/plugins, prime context at the start of the run |
| `/insights` | 0, 3 | Codebase analysis: dependency graph, hot spots, `main.js` decomposition map |
| `/ultraplan` | 0, 3, 4 | Deep plan before executing: the phase plan itself, the `main.js` split, the visual-refresh scope |
| **Council this** (`council-this`) | Gates G1–G4 | Multi-expert verdicts on the four decisions in §5 |
| **Superpowers** (`groundlink-superpowers`) | all | Project context, Maven lens, design law, milestone registry |
| **UI UX Pro Max** (`ui-ux-pro-max`) | 4 | Heuristic review + polish of every panel, dialog, empty/error state |
| **Stitch MCP** | 4 | Generate 2–3 visual-refresh mockup directions *within* the token system before touching CSS |
| **21st.dev** (Magic MCP) | 4 | Component-pattern inspiration (toasts, command palette, gauges) — port patterns to vanilla JS + tokens, never import React |
| **Nano Banana 2** | 4, 5 | README hero/screenshot art, PWA icon refresh, empty-state illustration — must obey design law, no AI-tells |

---

## Phase 0 — Preflight & baseline (½ h)

1. `/powerup`; load Superpowers; `/insights` over `src/` for the decomposition map used in Phase 3.
2. Baseline on a clean branch: `npm ci && npm test && npm run build` — record test count (381 expected), dist size (9.1 MB, 2.9 MB excl. sourcemaps), and Lighthouse or equivalent load metrics from `vite preview`.
3. `/ultraplan` this dispatch against the live repo state: confirm the audit findings in Appendix A still hold (the repo may have moved since 6 Jul); adjust scope accordingly and say so in the phase report.
4. Snapshot git state. The tree was dirty on 6 Jul (`deploy-m41-m47.sh` staged, `day1.py` untracked) — list what's there now for Keith.

**Gate G0:** baseline report. No changes yet.

## Phase 1 — Security & OPSEC hardening (the beta blockers)

Fix in this order; each item cites the audit evidence.

**1.1 Repo scrub ⚠️ KEITH**
- Remove `cheatsheet-cyber-jscu.html` from the repo (tracked, 1,006 lines, personal cyber cheatsheet whose name references a national SIGINT unit — off-topic and OPSEC-hostile in a public repo). Also delete `day1.py` (junk) and retire `deploy-m41-m47.sh` (one-off Dutch deploy script, redundant with `deploy.yml`; if kept, move under `scripts/` and English-ify).
- Prepare — but do not run — the history purge (`git filter-repo` path list) for the cheatsheet. ⚠️ KEITH decides: purge history (invasive, force-push) vs delete-going-forward. Council gate G1 advises.
- Git author identity: public history links the alias to a personal Gmail. Prepare the `.mailmap` + config change for future commits; history rewrite again ⚠️ KEITH via G1.
- Clean `.git` cruft: stale `REBASE_HEAD`, macOS `index 2` duplicate.

**1.2 CSP tightening** (`index.html:9`)
- Replace wildcard `connect-src https:` and `img-src https:` with the explicit origin list the code actually contacts (~16 origins; the audit enumerated them: fonts.googleapis/gstatic, s3.amazonaws.com, ows.digitalearth.africa, data.source.coop, server.arcgisonline.com, service.pdok.nl, tiles.maps.eox.at, tile.opentopomap.org, tile.openstreetmap.org, basemaps.cartocdn.com, tiles.openfreemap.org, fonts.openmaptiles.org, api.cloudrf.com, overpass-api.de, overpass.kumi.systems, maps.mail.ru, photon.komoot.io). Add `font-src 'self'` alongside gstatic. Keep `script-src 'self'`, `object-src 'none'`, `base-uri 'self'`.
- Add `<meta name="referrer" content="no-referrer">`; add a JS frame-buster (deny all framing — GH Pages cannot send `frame-ancestors` and `<meta>` ignores that directive, so clickjacking protection must be JS-side). The app is **linked, not embedded**, from `groundlink.org` (Keith's decision, 23 Jul 2026 — see Phase 5.5), so a blanket frame-buster is correct and desirable. Document the meta-CSP limitations in `docs/decisions/`.
- Make the `maps.mail.ru` Overpass mirror **opt-in** (it currently receives AOI bboxes by default — `src/connectivity/cellular.js:262-286`).

**1.3 Input & XSS hardening**
- Unify the four duplicated escape helpers into one module (`src/util/esc.js`); fix `main.js:2068 htmlEsc` missing `'`. Defensively escape `renderPace` (`main.js:2207-2219`) and `renderSiteList` (`main.js:2940-2945`) even though inputs are currently internal.
- Cap import sizes: 25 MB per file (KML/KMZ/GeoJSON/mission), decompressed-size cap on KMZ (zip-bomb DoS), keep the existing 2,000-row calibration cap.

**1.4 Privacy & supply chain**
- Self-host Sora + Hanken Grotesk (removes Google Fonts IP/referer leak + availability dependency; also completes the offline PWA story). Update CSP accordingly.
- Add `npm audit --audit-level=high` to CI (`deploy.yml`); re-verify the 6 Jul clean audit locally.
- SW: add an origin allowlist to `networkFirst` shell caching (`public/sw.js:~133` area).

**1.5 Domain-neutral sweep**
- UI strings currently include overtly military jargon (EW threat/jamming, SITREP, ATAK EUD, Rebro, "OP Alpha"). Neutralise or make sector-presets ("threat" → "interference source", "SITREP" → "status report") per the domain-neutral constraint. Keep ATAK as a product name where it names the export format.

**Gate G1:** tests+build green; council verdict on history purge; Keith executes repo scrub commands.

## Phase 2 — Documentation truth pass

The docs are the most divergent-from-reality part of the project. Make every committed word true.

**2.1 The M-number collision (the critical one) ⚠️ KEITH via G2**
`roadmap-2026H2.md` defines M27–M50 as a *future backlog*, but the repo has **built** M27 and M35–M47 with entirely different meanings (roadmap M36 = antenna-pattern import; built M36 = ops dashboard; roadmap M39 = super-layer; built M39 = freq-deconfliction; etc. — full table in Appendix B). The numbers are now ambiguous project-wide.
- Council gate G2 chooses the fix: (a) renumber the roadmap backlog to a fresh range (e.g. M60+) and add a "Built vs Backlog" reconciliation table, or (b) formally retire the old backlog numbering and keep only the as-built M-series. Recommendation carried into G2: option (a) — preserve the research backlog, renumber it, add the lookup table to CLAUDE.md.
- Resolve the duplicate `docs/M39-flight-track-overlay.md` vs `docs/M39-freq-deconflict.md` (rename the flight-track one to its new backlog number).
- Mark which backlog items are already satisfied under another number (roadmap M29 Fresnel ≈ built M14; roadmap M30 confidence ≈ built E3b; roadmap M35 = built M35).

**2.2 context.md refresh** — it is ~4 weeks stale (claims M1–M18, M21 "prepared not built"). Rewrite "Status & next steps" to the true M1–M23 + E1 + E2 + M27 + M35–M47 + E3b + E4 state; re-date; fix "Current artifacts", "Open decisions", tooling plan.

**2.3 README.md ⚠️** — currently says **"Map: Leaflet 1.9"** (`README.md:28,30`) when the app runs **MapLibre GL JS**. This is the public front page of the repo and it's wrong. Rewrite: correct stack, current feature list, install/run, licence, attribution (map/tile/data providers per licensing constraint), and a hero image + one screenshot (produced in Phase 4/5). Make it beta-worthy.

**2.4 docs/ hygiene**
- `docs/parked/M46-pace-engine.md` + `dispatch-M46.md` conflict with the built M46 (radio-suggest). Rename with a `-superseded` suffix and a one-line pointer.
- M36–M47 have specs but no dispatches; M11–M18 have neither (commit-only). Either backfill a light dispatch/spec index or add a `docs/INDEX.md` mapping every milestone → spec → dispatch → source files → status. Prefer the index (one file, high value, low effort).
- Spot-check `design-tokens.md` against `styles/tokens.css` for drift; reconcile any mismatched token names/values.

**2.5 Outer-folder hygiene ⚠️ KEITH** — root of `THE GROUNDLINK/` mixes active docs with `DRONE/`, `archive/`, `old docs and concepts/`, and four `.docx` research/handover files. Add a `PROJECT_STRUCTURE.md` explaining each; propose moving research `.docx`s to `docs/research/`. Keith approves any moves.

**Gate G2:** council verdict on renumbering; all docs pass a re-read for truth; Keith approves structure moves.

## Phase 3 — Performance & code health

**3.1 `main.js` decomposition** — 4,225 lines, 8× the next file. `/ultraplan` + `/insights` a split into cohesive modules (init, map wiring, panel controllers, render helpers) **without behaviour change**. This is a 6+ file change → propose the plan and get ⚠️ KEITH sign-off before executing. Land it in small, test-green increments.

**3.2 Bundle** — geotiff + codec chunks are bundled twice (main thread + workers, ~500 kB duplicated, both in SW precache). Dedupe via a shared chunk / worker import strategy. Stop shipping 6.2 MB of sourcemaps to Pages (`build.sourcemap: false` for the deploy build, or a hidden-sourcemap upload). Target: cut deployed dist meaningfully (report before/after).

**3.3 Robustness** — add user-visible error surfacing for network failures (cellular/Overpass, Photon geocoder currently fail silently to console — UX audit HIGH). A single toast/notification primitive (Phase 4 builds the visual; wire the plumbing here). Cancellable workers if cheap; otherwise note for a later milestone.

**3.4 Tooling** — plan the vite 6 → 8 major bump (two behind); attempt behind a branch, gate on green tests + build + manual browser smoke. If risky, defer with a note — don't block beta on it.

**Gate G3:** tests+build green; before/after size + load metrics; `main.js` split reviewed.

## Phase 4 — UI/UX polish (beta gloss)

Baseline is strong (UX audit graded A−, no blockers). This phase closes the named gaps and lifts the finish. Drive it with **UI UX Pro Max**; explore visual directions with **Stitch** and component patterns with **21st.dev** — all **inside the token system**, all porting to vanilla JS, none importing frameworks.

**4.1 Named UX gaps (from audit)**
- User-visible **error toasts** for network failures (pairs with 3.3) — HIGH.
- `title`/`aria-label` on every icon-only button — MED.
- "No results" state in the ⌘K palette search — MED.
- `viewport-fit=cover` + safe-area insets for notch phones — LOW.
- Verify focus trap + Escape in every dialog, the palette, and focus mode; confirm `prefers-reduced-motion` honoured everywhere new.

**4.2 Coherence pass** — run UI UX Pro Max over every panel/dialog/empty-state for consistent spacing, capitalisation (sentence case), disabled states, loading indicators, and tabular figures on all numerics. Fix inconsistencies; do not restyle what already passes.

**4.3 Optional visual refresh ⚠️ KEITH via G4** — if (and only if) Keith wants more than polish, use Stitch to generate 2–3 refresh directions *within* teal/azure/amber + Sora/Hanken, review with Council (G4), and apply the winner. Default is **polish, not redesign** — the operational aesthetic is an asset; don't trade it for novelty.

**Gate G4:** UX audit re-run clean; council verdict if a refresh was attempted; browser-verified on desktop + mobile widths.

## Phase 5 — Beta packaging & release prep

**5.1 Assets** — with **Nano Banana 2**: a README hero and 1–2 app screenshots (real UI, not mockups), a refreshed PWA icon set (192/512 + maskable) and the empty-state illustration — all design-law compliant, zero AI-tells. Wire into `manifest.webmanifest` and README.

**5.2 Versioning** — bump `package.json` `0.1.0` → `0.9.0-beta`; surface the version + build stamp in the UI (there's already a build-stamped SW cache to read from). Write `CHANGELOG.md` covering M1→beta.

**5.3 Release checklist** — `docs/BETA-CHECKLIST.md`: license file present, attribution complete, CSP verified in a deployed preview, PWA installable + offline-smoke passed, no console errors, Lighthouse ≥ target, 381+ tests green, OPSEC re-swept (no coordinates/secrets/names), all ⚠️ KEITH items resolved.

**5.4 Handover** — the exact Keith-runs commands: branch merges in order, `npm run deploy`, git tag `v0.9.0-beta`, and (if G1/G2 chose history rewrite) the reviewed `filter-repo` + force-push runbook.

**5.5 Custom domain — `app.groundlink.org`** (decision 23 Jul 2026: the planner is linked from the existing `groundlink.org` marketing site, hosted separately on GoDaddy Website Builder; apex stays there, the app gets a subdomain). `public/CNAME` (→ `app.groundlink.org`) is already in the repo. Ordered runbook for Keith — **DNS first to avoid downtime**:
1. GoDaddy DNS for `groundlink.org`: add a **CNAME** record, host `app`, value `johncheesy.github.io`. (Apex `groundlink.org` untouched — stays on the Website Builder.)
2. Once DNS resolves, commit + deploy `public/CNAME`, then in GitHub → repo Settings → Pages set Custom domain `app.groundlink.org` and tick **Enforce HTTPS** (wait for the cert to provision).
3. Verify: `https://app.groundlink.org` serves the app over HTTPS; the old `johncheesy.github.io/...` URL redirects.
4. On the GoDaddy site add a "Launch planner" button → `https://app.groundlink.org` (opens in a new tab, `rel="noopener"`).
Note: `base: './'` (relative) in `vite.config.js` already works at a domain root, so no base change is needed. Prefer `planner.` over `app.`? One-line change in `public/CNAME` + the DNS host.

**Gate G5:** every checklist box ticked or explicitly waived with a reason.

## Phase 6 — Final verification (independent)

Spawn a **fresh subagent** (not the one that did the work) to verify against this dispatch:
- Re-run `npm test` + `npm run build`; confirm counts and clean build.
- Grep the repo for the removed files, hardcoded secrets, coordinate patterns, personal email, `#hex` in components, and military jargon in UI strings — confirm zero.
- Fetch the deployed preview; verify CSP origins, referrer meta, frame-buster, self-hosted fonts, no console errors.
- Re-read CLAUDE.md / context.md / README.md / roadmap for any remaining false claim.
- Produce a **go / no-go** verdict with residual risks. Council-this the verdict if no-go.

---

## §5 — Decisions requiring a Council gate

- **G1 — git history:** purge the cheatsheet + scrub author email from history (force-push, invasive) vs delete-going-forward (simpler, leaves history). Weigh OPSEC exposure vs rewrite risk on a public repo.
- **G2 — M-numbering:** renumber the roadmap backlog + reconciliation table vs retire old numbering. Weigh research-traceability vs simplicity.
- **G3 — main.js split scope:** how far to decompose for beta vs defer. Weigh maintainability vs regression risk near release.
- **G4 — visual refresh:** polish-only vs a Stitch-driven refresh. Weigh finish vs the risk of diluting the operational aesthetic.

## §6 — Phase report format

Each phase ends with: **what changed** (files + one-line why), **gate status** (tests N/N, build ok, dist size), **evidence** (before/after for perf/size/audit), **⚠️ KEITH items** (exact commands, awaiting), **residual risks**, **next phase**. Keep it tight.

---

## Appendix A — Audit findings (6 Jul 2026)

Four parallel read-only audits (build/test, UI/UX, security/OPSEC, docs).

**Build & tests:** ✅ 381/381 tests pass (36 files), build clean in 3.4 s, `npm audit` 0 vulns, only 7 direct deps. Warnings: maplibre vendor chunk 1.05 MB (expected); geotiff bundled twice (~500 kB dup); 6.2 MB sourcemaps ship to Pages; vite 2 majors behind. `main.js` = 4,225 lines. Zero TODO/FIXME in src.

**UI/UX:** graded **A− (95/100), no beta blockers.** Strengths: token discipline (0 hardcoded theme colours in JS), 78 aria instances, full dark theme, English throughout, good empty/first-run state, zero console spam. Gaps: silent network-failure handling (HIGH), icon buttons missing `title` (MED), palette lacks "no results" (MED), notch safe-area (LOW).

**Security & OPSEC:** clean XSS posture (consistent escaping, exemplary mission-file validation), CloudRF key sessionStorage-only, solid SW cache policy. Blockers: `cheatsheet-cyber-jscu.html` tracked in public repo (HIGH, OPSEC), author email in history (MED), wildcard `connect-src/img-src https:` (MED). Quick wins: referrer meta, frame-buster, self-host fonts, opt-in mail.ru mirror, import size caps, unify escape helper, military-jargon sweep.

**Docs:** CLAUDE.md accurate; **context.md ~4 weeks stale**; **README says Leaflet not MapLibre**; **M-number collision** roadmap-vs-built (critical); parked M46 conflicts with built M46; M36–M47 lack dispatches; outer folder messy.

## Appendix B — M-number collision map

| # | roadmap-2026H2 backlog meaning | Built meaning (CLAUDE.md) |
|---|---|---|
| M27 | Delta-Bullington diffraction | Field calibration (RSSI CSV, bias) |
| M35 | Mast-height wizard | Mast-height wizard *(same — OK)* |
| M36 | Antenna-pattern import | Ops dashboard |
| M39 | Super-layer + best-site slider | Frequency deconfliction |
| M40 | Local run-archive + multi-export | Frequency-plan export |
| M41 | TAK-native data package | Network topology diagram |
| M42 | Starlink/LEO sky-obstruction | Drone altitude optimizer |
| M43 | Light spectrum deconfliction | Coverage gap report |
| M44 | Drone/BVLOS relay planning | Satcom rain-fade UI |
| M45 | LoRa/Meshtastic profile | Link-quality topology edges |
| M46 | Universal PACE engine | Smart radio-to-node suggestion |
| M47 | ICS-205 autogenerator | Mission readiness score |

Approx-satisfied-elsewhere: roadmap M29 (Fresnel) ≈ built M14; roadmap M30 (confidence overlay) ≈ built E3b badge; roadmap M34 (path-profile PNG) ≈ built M14. Resolve all in Phase 2.1.

