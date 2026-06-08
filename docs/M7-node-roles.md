# M7 — Radio arsenal & node-role assignment (authoritative spec)

Declare the radios you actually carry (the **arsenal**), then let the app pick
the best-fit radio for each operational **node role** — who carries it and how
it's deployed. Rule-based and explainable; reuses the M5 radio model. Read
alongside `CLAUDE.md`, `docs/M5-radio-import.md`, `../roadmap-next.md`.

## Node roles

| Role | Mobility | Power | Default height | Preferred class |
|------|----------|-------|----------------|-----------------|
| Operator (manpack) | foot | battery | 1.8 m | handheld · manpack · manet |
| Mobile command post (veh.) | vehicle | vehicle | 3 m | mobile · manpack · base |
| HQ (static) | static | mains | 12 m | base · repeater · mobile |
| Rebro / repeater (mobile) | vehicle | vehicle | 4 m | repeater · mobile · base |
| Rebro / repeater (static) | static | mains | 25 m | repeater · base |

## 1. Engine — `src/radios/roles.js` (pure, unit-tested)

- `NODE_ROLES` — the five roles above (key, mobility, power, height, preferred
  equipment classes, realistic tx-power ceiling).
- `assignRoles(arsenal, context) -> [{ key, label, radio, heightM, why,
  alternatives, score }]` — one row per role, the best arsenal radio per role,
  a one-line rationale and the next two alternatives. Empty arsenal → blank rows
  with guidance.
- `scoreForRole(radio, role, context)` — transparent score: equipment-class fit
  dominates; HF/satcom/LoRa deprioritised as a node bearer (they are PACE assets
  / overlays); power weighed against the platform budget (mains/vehicle rewards
  reach, battery penalises heavy draw); mission band tie-breakers (UHF in
  built-up terrain, VHF for longer reach). `context` (all optional):
  `{ urbanFrac, reachKm, ruggednessM }`.

## 2. Arsenal — `src/radios/radios.js`

The radio set now also persists an **arsenal** (`gl.radioset.v1` →
`{ userRadios, arsenal, activeInfraId, activeFieldId }`). Multi-add: each picker
row has a checkbox; **Add ticked** adds every selected radio to the arsenal (the
"add several at once" ask). The arsenal renders as a removable list. Exposes
`getArsenal()` + `onArsenalChange` so the roles view stays live.

## 3. UI — "Node roles" section + wiring (`index.html`, `src/main.js`)

A section after Radios: **Assign roles from arsenal** → one row per node role
(role · picked radio + deploy height · rationale + alternatives). `main.js`
gathers a light mission context (reach from AOI/route/site spread) and calls
`assignRoles(radios.getArsenal(), …)`; re-renders automatically when the arsenal
changes.

## Later (not in v1)

- Manual per-role override dropdown (auto-pick is the v1 ask).
- Feed the role assignment into the M6 PACE plan (per-role bearer).
- Per-role power/endurance once M8 lands.

## Acceptance

1. Tick three radios → **Add ticked** → all three appear in the arsenal and
   survive reload (hosted origin).
2. **Assign roles** → Operator gets a handheld, Mobile CP a vehicle/mobile set,
   HQ/Rebro a base/repeater; HF/satcom never picked as a node bearer when LOS
   gear exists.
3. Empty arsenal → every role shows "add the radios you carry" guidance.
4. `src/radios/roles.test.js` covers class fit, the HF/satcom guard, gaps,
   power weighting and the rationale text.
