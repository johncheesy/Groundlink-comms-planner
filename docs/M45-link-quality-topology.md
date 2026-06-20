# M45 — Link Quality on Topology (M14 × M41)

> **Status: shipped — Jun 2026.**

## What it does

Colours each edge in the M41 topology SVG by the link-budget margin computed from
the assigned radios' RF parameters and the AOI's operational reach distance (worst-case span).

**Edge quality tiers:**

| Tier | Margin | Colour |
|---|---|---|
| Good | > 10 dB | Teal (solid) |
| Marginal | 3–10 dB | Amber (solid) |
| Poor | < 3 dB | Red (dashed) |
| Uncomputed | — | Grey (dashed) |

On hover, each edge shows a tooltip: `HQ → Rebro | 14.2 dB margin | FSPL`

A quality key legend appears below the SVG.  
A "run coverage to compute margins" note appears when no margins are computed yet.

## Link budget model

FSPL (Free-Space Path Loss) at the AOI's `reachKm` span. Uses:
- Weaker radio's TX power (worst-case)
- Lower TX frequency of the two endpoint radios
- Stricter RX sensitivity of the two radios
- No terrain or clutter — indicative planning margin only

Margins are recomputed after each coverage run (when `reachKm` from the AOI is known).

## Files

| File | Role |
|---|---|
| `src/ui/topology.js` | `marginToQuality()`, `getLinkMargins` option, edge quality classes, tooltip wiring, quality key |
| `src/main.js` | `computeLinkMargins()`, `lastLinkMargins` state variable, update trigger on coverage done |
| `src/coverage/model.js` | `fsplDb()`, `receivedDbm()` (existing, now also imported in main.js) |
| `styles/components.css` | `.topo-edge--quality-good/warn/poor/unknown`, `.topo-quality-key`, `.topo-edge-tip`, `.topo-unplaced-note` |

## Data contract

`getLinkMargins()` returns `{ 'hq:rebro-static': { marginDb: 14.2, model: 'FSPL' }, … }`.  
The topology panel reads this via the getter and applies quality classes per edge key.
