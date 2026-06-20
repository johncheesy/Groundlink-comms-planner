# M39 — Frequency Deconfliction

> **Status: shipped — Jun 2026.**

## What it does

Automatically checks every radio in the arsenal against interference sources and flags conflicts. Runs live whenever the arsenal changes (no user action required). Shows a summary pill and coloured conflict list in the Comms Plan section, above the PACE output.

**Conflict types detected:**

| Type | Severity | Condition |
|---|---|---|
| `out-of-range` | error | `defaultFreqMHz` outside `freqRangeMHz` |
| `protected` | error | Frequency overlaps a protected band (aviation VHF, marine Ch16, PMR446, MURS, TETRA, GPS L1/L2, Iridium, Inmarsat) |
| `co-channel` | error | Two radios within 0.5 kHz of each other |
| `adjacent` | warn | Two radios within minimum channel spacing (25 kHz VHF, 12.5 kHz UHF, 3 kHz HF) |

## Files

| File | Role |
|---|---|
| `src/analysis/freq-deconflict.js` | `deconflict(arsenal)`, `deconflictSummary(conflicts)`, `PROTECTED_BANDS` |
| `src/ui/deconflict-panel.js` | `createDeconflictPanel(host)` → `{ update(arsenal), clear(), check(arsenal) }` |
| `index.html` | `<div id="deconflictPanel" class="deconflict-wrap">` before paceResults |
| `styles/components.css` | `.deconflict-wrap`, `.deco-summary`, `.deco-badge`, `.deco-list`, `.deco-item--error/warn` |

## Key decisions

- **Live updates** — `onArsenalChange` in main.js calls `decoPanel.update(arsenal)` so conflicts appear in real time as radios are added/edited.
- **Protected bands** — hardcoded table of internationally protected frequencies; errs on the side of warning.
- **Errors before warnings** — conflicts are sorted errors-first in the display list.
- **No blocking** — conflicts are advisory; the user can proceed without resolving them.

## Note on naming

`docs/M39-flight-track-overlay.md` is a future-milestone spec for importing KML/GPX flight tracks. This file documents what was actually built as M39 in the Jun 2026 session.
