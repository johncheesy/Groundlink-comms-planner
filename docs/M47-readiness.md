# M47 — Mission Readiness Score

> **Status: shipped — Jun 2026.**

## What it does

Aggregates six intelligence dimensions into a single 0–100 mission readiness score,
shown in two places:
1. **Toolbar**: compact badge beside the intel chip (`74` coloured by tier)
2. **Ops dashboard**: SVG arc gauge + per-dimension bar chart

## Dimensions

| Dim | Source | Scoring |
|---|---|---|
| Coverage | M2 `coveredFracAoi` | 0–100% of AOI covered |
| PACE plan | M6 `legs.filled/total` | 0–100% tiers filled |
| Freq deconflict | M39 conflicts | 100 − errors×25 − warns×10 |
| Link quality | M45 `marginDb` average | avg margin / 20 dB × 100 |
| Power endurance | min endurance / mission hours | (wired when power module exposes summary) |
| Satcom | M38 best GEO status | ok=100, warn=60, marginal=30 |

Uncomputed dimensions show `—` and are **not penalised** — score is the average of computed dims only.

## Thresholds

| Score | Tier | Colour |
|---|---|---|
| ≥ 75 | High — Ready | Teal |
| 40–74 | Mid — Partial | Amber |
| < 40 | Low — Not ready | Red |

## Files

| File | Role |
|---|---|
| `src/analysis/readiness.js` | `computeReadiness()`, `dim*()` helpers, `READINESS_DIMS` |
| `src/ui/dash-ops.js` | `buildReadinessGauge()`, `renderReadiness()`, injected into render as section 0 |
| `index.html` | `<div id="intelScoreBadge">` in toolbar |
| `src/main.js` | `updateReadinessBadge()`, `updateOpsDashReadiness()`, triggered on coverage done / PACE build / arsenal change / AOI change |
| `styles/components.css` | `.readiness-*`, `.intel-score-badge`, `.intel-score--high/mid/low` |

## Update triggers

- Coverage run completes (`state === 'done'`)
- PACE plan built (`buildPaceBtn` click)
- Arsenal changes (`onArsenalChange`)
- AOI / satcom panel updates
