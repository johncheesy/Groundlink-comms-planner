# M44 — Satcom Fade Margin UI (E4 Surface)

> **Status: shipped — Jun 2026.**

## What it does

Wires the E4 rain-fade engine (ITU-R P.618-14) into the M38 Satcom panel.
For each Ka-band or Ku-band GEO satellite in the table, shows a fade margin badge directly in the row:

- **99% availability**: attenuation exceeded 1% of the time (dB)
- **99.9% availability**: attenuation exceeded 0.1% of the time (dB)

Bands where rain fade is negligible (L, S, C, X) show no badge.

An accuracy footnote is always shown when at least one Ka/Ku satellite is visible:  
`Rain fade indicative ±3 dB · ITU-R P.618-14. Ka = 20 GHz, Ku = 12 GHz.`

## Quality tiers

| Tier | Condition (99% attenuation) | Colour |
|---|---|---|
| ok | < 3 dB | teal border |
| warn | 3–8 dB | amber border |
| bad | > 8 dB | red border |

## Files

| File | Role |
|---|---|
| `src/ui/satcom-panel.js` | `bandToFreqGhz()`, `computeFade()`, `buildFadeMap()` |
| `src/analysis/rain-fade.js` | E4 engine (unchanged) |
| `styles/components.css` | `.satcom-fade`, `.satcom-fade--ok/warn/bad`, `.satcom-fade__label`, `.satcom-fade__vals`, `.satcom-fade-note` |

## Key decisions

- **Frequency assignment**: Ka = 20 GHz (conservative uplink), Ku = 12 GHz.
- **Ka/C hybrid satellites** (e.g. SES-4): flagged as Ka since the band string contains "Ka".
- **Elevation floor**: rain-fade computed at `max(elevation, 5°)` to avoid numerical issues near horizon.
- Accuracy inherits from E4: ±3 dB (simplified rain rate table, ±40% rain rate uncertainty).
