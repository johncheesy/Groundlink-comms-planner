# Dispatch — GroundLink M46 (domain profiles & standard comms-plan cards)

*Paste this entire file as the task prompt into a new Claude Code session inside
`GROUNDLINK CODE/`. It builds M46, verifies it in the browser, and ships it.*

---

## Context

You are in the **GroundLink Comms Coverage Planner** repo — Vite + vanilla JS
(ES modules) + MapLibre GL JS, deployed to GitHub Pages. Read `CLAUDE.md`
(constraints), then the authoritative spec you implement:

- **`docs/M46-pace-engine.md`** — on top of the existing M6 PACE engine, add
  (A) lightweight **domain profiles** (Generic default + SAR/humanitarian/
  defence/mining/expedition) that only relabel/parameterise and choose which
  cards are offered, and (B) standard printable **cards**: a universal **PACE
  card**, a FEMA-v3.1 **ICS-205** (SAR), and a **MOSS telecoms checklist**
  (humanitarian) — rendered from the same plan and exported via the same routes.

Read `docs/M6-pace-report.md` first — it is the engine and export plumbing you
build on. Survey before coding: `src/pace/pace.js` (`buildPace` — do **not**
fork or re-rank it), `src/pace/report.js` (the PDF-via-print / `.doc` / `.xls`
routes the cards reuse), the M6 "Comms plan" panel in `src/main.js`
(`gatherPaceContext`, `renderPace`), the arsenal source (M5 mix) for ICS-205
channel rows, and the M21 mission file (`src/io/mission.js`) where the chosen
profile must persist.

## Hard constraints (non-negotiable)

- **Build on M6 — one PACE engine.** No second engine, no re-ranking; profiles
  must leave `buildPace`'s `plan` output identical (a test asserts this). Cards
  reuse the M6 export routes and report styles.
- **Domain-neutral default preserved.** Generic profile keeps today's wording;
  profiles only change vocabulary + offered cards, never the map or physics.
  Exported artifacts stay free of insignia/jargon (OPSEC/neutrality rule).
- **Cards are data-faithful** — render only fields the plan/registry contains;
  missing fields are blanks to complete by hand, never fabricated. No AI text.
- **Standards fidelity** — ICS-205 follows FEMA v3.1 field order; MOSS follows
  the ETC telecoms-annex items. Record both layouts in `docs/decisions/`.
- **No new dependencies, no network calls, no token.** Profiles are static
  tables; cards are HTML→print/`.doc`. OPSEC footer on every card; no
  coordinates in tests.
- **No colour/token changes.** Both themes; keyboard + ARIA.
- **Verify in a real browser** (`npm run dev`); `npm test` green and
  `npm run build` clean before any commit to main.

## Pre-flight

```bash
rm -f .git/index.lock            # if present
git status                       # clean tree
git checkout main && git pull
git checkout -b feat/m46-domain-profiles-cards
```

## Step 1 — Tests first (TDD)

- `src/pace/profiles.test.js` — table integrity (every offered card has a
  renderer); selecting any profile leaves `buildPace` output identical for the
  same input.
- `src/pace/cards.test.js` — from a known `plan` + arsenal: ICS-205 fragment has
  the expected channel rows in FEMA field order, unassigned channels blank, no
  fabricated freqs; MOSS card ticks only supported items; PACE card shows four
  tiers + structure line; every card carries the OPSEC footer; no card emits
  coordinates beyond the plan's own.

## Step 2 — Profiles (`src/pace/profiles.js`)

Spec §A. Static `PROFILES` table (label, offered `cards`, one-line `notes`,
tier-word nuance). Generic is the default. Selecting a profile sets offered cards
and a panel hint only — no engine change.

## Step 3 — Cards (`src/pace/cards.js`)

Spec §B. Pure HTML builders `(plan, mission, profile) → fragment`: **PACE card**
(universal one-pager), **ICS-205** (FEMA v3.1 layout from arsenal + plan, blanks
where unassigned), **MOSS telecoms checklist** (ETC items ticked from plan/
coverage). Export through the existing M6 routes (print-PDF, `.doc`, standalone
`.html` fallback) — no new export plumbing.

## Step 4 — UI + persistence

Spec §C. Add a **Profile** selector above the M6 PACE legs (Generic default);
the export block offers the profile's cards alongside the existing PDF/Word/Excel
checkboxes; ⌘K gains the available card exports. Persist the chosen profile in
the M21 mission file so a saved plan reopens in the same profile.

## Step 5 — Verify in the browser (manual checklist)

`npm run dev`, both themes. Switch profiles → offered cards change, map + PACE
legs unchanged. SAR → export ICS-205 (channels populated, blanks correct).
Humanitarian → export MOSS checklist (ticks match coverage). PACE card exports
for any profile. Save mission → reload → same profile. OPSEC footer on every
card.

## Step 6 — Ship

```bash
npm test && npm run build
git add -A && git commit -m "M46: domain profiles + standard comms-plan cards (PACE/ICS-205/MOSS)"
git push -u origin feat/m46-domain-profiles-cards
```

Open the PR; Keith merges and deploys from Claude Code as usual. Update
`CLAUDE.md` (Status; note EMCON/min-power M49 and route check-in as later) and
record the ICS-205 / MOSS layouts in `docs/decisions/`. Roadmap reference:
`../../roadmap-2026H2.md`.
