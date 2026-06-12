# M26 — Auto-cost BOM from priced inventory

> **Status: built — 12 Jun 2026** (roadmap `../../roadmap-2026H2.md` → M26).

The M8 mission BOM becomes a **costed quote from the user's own prices** —
the named differentiator: LINKPlanner's auto-BOM is the bar, and no free tool
costs a plan from *your* inventory. Indicative-and-editable throughout; no
pricing APIs, nothing fetched, no currency conversion (one user-chosen
currency, labelled €).

## How it works

- **Prices live where the items live.** Arsenal radios get an optional
  **Price** field in the radio editor (persisted with the arsenal in
  `gl.radioset.v1`, same try/catch localStorage policy). The M8 power
  consumables (batteries / solar / powerbanks) take per-item prices typed
  directly into the BOM table; those are session-scoped like the rest of the
  power form.
- **`src/power/cost.js`** (pure, TDD): `costedBom({ nodes, powerLines,
  priceMap })` — radio rows aggregate the M7 node-role assignment per radio
  (HQ + Rebro on the same set → one line, qty 2, roles in the spec column);
  power rows reuse the M8 `networkBom` quantities. Unpriced rows stay visible
  with a "—" and are **counted, never guessed**: the grand total is labelled
  a lower bound whenever anything is unpriced. `bomToCsv` serializes the
  quote (RFC 4180 escaping, empty cells for unpriced, total row + caveat).
- **UI**: the Power section's BOM table gains Unit € / Total € columns, the
  per-line price inputs, the grand-total row and an **Export BOM (CSV)**
  button (generated locally, Blob download). Re-costing happens on `change`
  so typing never loses focus.
- **Report (M6)**: `plan.bom` now carries the costed rows; the report's
  Power & endurance section shows the price columns + total automatically
  when any price is present (HTML/Word/Excel exports inherit it).

## Honesty & limits

- Quantities are planning-grade: one node per role (M7); team-level
  multiplication (N operators) pairs with M13 teams later.
- The total is a **lower bound** while any line is unpriced, and the table
  says so. Prices are the user's figures — indicative, no list-price source.

## Tests

`src/power/cost.test.js` — price parsing (negatives/garbage → unpriced),
role aggregation and qty × price, null-price visibility + lower-bound
counting, power-line price-map application, cent rounding, CSV escaping/
format. UI flow verified in the browser on the deployed build.
