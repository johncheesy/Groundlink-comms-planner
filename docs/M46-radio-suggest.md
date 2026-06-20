# M46 — Smart Radio-to-Node Suggestion List

> **Status: shipped — Jun 2026.**

## What it does

Scores every radio in the arsenal against each operational node role and
presents the top-3 ranked suggestions per role in an accordion section
below the Node Roles panel.

Each suggestion shows:
- A score bar (0–100) colour-coded by score tier (teal ≥ 70, amber ≥ 45, red < 45)
- Radio name and key specs (band, TX power, digital mode)
- An "Apply" button — advisory, marks plan dirty for rebuild

## Scoring (0–100)

| Dimension | Weight | Description |
|---|---|---|
| Range match | 40% | Radio max range / required AOI reach (capped at 1.0) |
| Band suitability | 30% | Position in role's `prefer[]` array: [1.0, 0.6, 0.35, 0.15, 0.05] |
| Power class | 20% | Radio TX / role max TX (capped at 1.0) |
| Digital mode | 10% | DMR/P25/dPMR → 1.0 for command roles; 0.3 for handheld |

## Files

| File | Role |
|---|---|
| `src/analysis/radio-suggest.js` | `scoreRadioForRole()`, `suggestRadios()` |
| `src/ui/radio-suggest-panel.js` | `createRadioSuggestPanel(host, { onApply })` → `{ update(suggestions), clear() }` |
| `index.html` | `<details id="radioSuggestDetails">` inside roles section |
| `src/main.js` | `updateSuggestPanel()`, wired to `onArsenalChange` + `assignRolesBtn` click |
| `styles/components.css` | `.radio-suggest__*` class family |

## Key decisions

- **Advisory only** — suggestions never auto-assign; user clicks Apply.
- **Apply action**: marks plan dirty + shows status message; no undo needed (no map state changed).
- **Scored on arsenal change**: `onArsenalChange` calls `updateSuggestPanel()` for live updates.
- **Max 3 per role**: only top-3 shown; roles with 0-score matches are hidden.
