# M40 — Frequency Plan Export

> **Status: shipped — Jun 2026.**

## What it does

Adds an **Export freq plan** button inside the Comms Plan section (below the PACE output). Clicking it generates a print-ready A4 landscape HTML document listing every radio in the arsenal with:

- Callsign / Node
- Role (handheld / manpack / base / repeater / etc.)
- Radio model
- Band (HF / VHF / UHF / L-band / SHF+)
- Frequency (MHz) with monospace tabular styling
- Frequency range (MHz)
- Power (W)
- Rx sensitivity (dBm)
- PACE tier (colour-coded: teal=P, azure=A, amber=C, red=E)
- Notes

Opens in a new tab via blob URL; Ctrl+P → PDF workflow. Same pattern as `brief.js` (M37).

## Files

| File | Role |
|---|---|
| `src/export/freq-plan.js` | `generateFreqPlan()`, `openFreqPlan()` |
| `index.html` | `<button id="freqPlanBtn">` inside paceResults div |
| `src/main.js` | Static import + click handler (lazy re-import inside handler for split clarity) |

## Key decisions

- **PACE tier detection** — matches radio's default frequency band against `paceLegs[].band`; falls back to `—` if no PACE plan exists.
- **Band detection** — simple threshold: HF < 30 MHz, VHF < 300, UHF < 1000, L-band < 3000, SHF+.
- **No framework** — pure HTML string with inline CSS; `@page { size: A4 landscape }`.
- Blob URL revoked after 90 s; popup blocker fallback triggers an `<a download>` click.

## API

```js
import { generateFreqPlan, openFreqPlan } from './export/freq-plan.js';

const html = generateFreqPlan({ arsenal, paceLegs, missionName, buildVersion });
openFreqPlan(html); // new tab or download fallback
```
