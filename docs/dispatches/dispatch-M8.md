# Dispatch — GroundLink M8 (power & endurance)

*Paste this entire file as the task prompt into a new Claude Code session inside
`GROUNDLINK CODE/`. It builds M8, verifies it in the browser, and ships it.*

---

## Context

You are in the **GroundLink Comms Coverage Planner** repo — Vite + vanilla JS
(ES modules) + MapLibre GL JS, deployed to GitHub Pages. Read `CLAUDE.md`
(constraints), then the authoritative spec you implement:

- **`docs/M8-power-endurance.md`** — per-node endurance from a duty-cycle/timings
  plan, site energy + solar budget, drone endurance, an **ATAK device mAh +
  powerbank** recommendation, and a **network BOM** the M6 report consumes.

M1–M7 are built. M8 ties to **M7 node roles** (`src/radios/roles.js` — each
node's assigned arsenal radio is its power profile) and feeds the M6 report. M9
(cellular) and M10 (3D) are separate dispatches; do not start them here.

## Hard constraints (non-negotiable)

- **Free / no-key, no new services.** M8 is pure client-side modelling + UI; no
  network calls, no new dependency needed.
- **OPSEC.** No real mission/site coordinates committed; all stays in-browser.
- **No `localStorage`/`sessionStorage` assumptions** in embedded previews.
- **Verify in a real browser** (`npm run dev`) before declaring done;
  `npm run build` clean before any commit to main.
- Every number is an **indicative, editable default** (the M5 ethos) — never
  hard-lock a value.

## Pre-flight — the working tree may carry uncommitted M6/M7 work

```bash
rm -f .git/index.lock            # if present
git status                       # review what's uncommitted
```

If the **M6 + M7 + quick-win + rename** batch is still uncommitted, commit and
merge it first (finished + verified). Then branch off updated `main`:

```bash
git checkout main && git pull
git checkout -b feat/m8-power-endurance
```

---

## Step 1 — Tests first (TDD): `src/power/power.test.js` + `src/power/atak.test.js`

Write these vitest cases before implementing. Preserve the original numbers and
add the operator/ATAK ones:

**power.test.js**
- `siteEnergyWh`: 5 W, 72 h, 30% duty → 108 Wh, 9 Ah @ 12 V, 4.5 Ah @ 24 V.
- `solarPanelW`: 108 Wh, lat 52° (>50° → 3 h sun), eff 0.85 → ~42.4 W → **50 W**.
- `droneEnduranceMin`: 370 Wh, 150 W avg, 20% reserve → **118 min**; **37**
  batteries for 72 h.
- `operatorEndurance`: handheld {txA 1.6, rxA 0.35, standbyA 0.08, 2.6 Ah @ 7.4 V}
  at 5-5-90 → endurance hours; battery count for an 8 h mission incl. one spare.
- `timingsToDuty`: SITREP every 30 min × 2 min TX + 2 h continuous-on over an 8 h
  mission → effective TX/RX/standby fractions.
- `networkBom`: 2 sites + 1 drone + 1 operator + 1 ATAK → BOM array with ≥ 4 line
  items.

**atak.test.js**
- `atakConsumedMah`: 600 mA, 8 h → 4800 mAh.
- `powerbankRecommendation`: 4800 mAh consumed, 5000 mAh device, 0.65 usable →
  recommended rated mAh + a standard size + count.

## Step 2 — Implement `src/power/power.js` + `src/power/atak.js` (pure)

Per `docs/M8-power-endurance.md` §1, §2, §2b. Pure functions only — no DOM, no
imports outside the file. Signatures in the spec:
`operatorEndurance`, `timingsToDuty`, `siteEnergyWh`, `solarPanelW`,
`droneEnduranceMin`, `networkBom` (power.js); `atakConsumedMah`,
`powerbankRecommendation` (atak.js). Ship the indicative defaults table.

## Step 3 — UI: "Power & endurance" panel section

Add a section after "Comms plan" in `index.html` (match the existing section /
card / token conventions — `styles/components.css`, the M6/M7 cards; the older
draft markup in this repo's git history is a starting point, but follow current
conventions). Inputs: mission duration, a small timings plan (every-N-min +
TX-min + a continuous-on toggle), drone battery Wh, battery type. Per node (reuse
the **M7 node-role assignment + arsenal radio**): endurance, batteries + spare,
recharge interval; static nodes → solar budget; the **ATAK powerbank** line; a
mission BOM roll-up table. Wire in `src/main.js`; expose `window.__gl.powerBom`
in DEV.

## Step 4 — Feed the M6 report

`src/pace/pace.js`: accept a `bom` field in the context and attach it as
`plan.bom`. `src/pace/report.js`: when `plan.bom` has entries, add a "Power &
endurance" table — it propagates to PDF/Word/Excel via the shared HTML core.

## Verification (before shipping)

- `npm run dev` → walk the M8 acceptance list (operator endurance + battery
  count; timings plan changes duty; static node solar budget; ATAK powerbank;
  report shows the Power & endurance table).
- `npm run test` → existing + new tests pass.
- `npm run build` → zero errors.

## Commit plan + ship

```
feat(power): endurance, duty/timings, site solar, drone, network BOM + tests
feat(power): ATAK EUD draw + powerbank recommendation + tests
feat(ui): power & endurance panel section (per node + BOM roll-up)
feat(report): power & endurance table in the comms-plan report
```

```bash
git push -u origin feat/m8-power-endurance
gh pr create --fill && gh pr merge --merge --delete-branch
```

GitHub Actions builds + deploys `main` to Pages. Confirm the live site
(https://johncheesy.github.io/Groundlink-comms-planner/) returns 200 and the
build badge updated.

## If a decision is genuinely open

Surface it rather than guessing (e.g. spare-battery policy, whether to persist
power inputs). Prefer the spec's default; note any deviation in the PR.
