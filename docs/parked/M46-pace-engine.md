# M46 — Domain profiles & standard comms-plan cards (PACE / ICS-205 / MOSS)

Feature from the 12 Jun 2026 research (`../../GroundLink_feature-onderzoek.docx`,
`../../roadmap-2026H2.md` → M46). The research's cross-cutting finding: **PACE is
universal** (SAR, mining, humanitarian, defence, expedition all express it) and
**printable, standards-shaped outputs are as valuable as the maps** — they are
how each domain documents and signs off a plan. M6 already ships a rule-based
PACE engine and a report; M46 **builds on it**, adding (A) lightweight domain
profiles that relabel/parameterise the existing plan, and (B) standard output
cards: an **ICS-205** (SAR), a **MOSS telecoms checklist** (humanitarian), and a
one-page **PACE card** usable by any domain.

**Why.** GroundLink is domain-neutral by design, but each audience documents
comms in its own standard form. Generating those forms from the plan the app
already builds — instead of the user re-typing into FEMA/UN templates — is a
concrete, defensible differentiator and turns the tool into the system of record.

No colour/token changes (cards reuse the M6 report styles + existing tier
badges). Free/no-key, client-side, no new deps — the cards are HTML→print/`.doc`
exactly like the M6 report, and the profiles are static lookup tables.

---

## Decisions to lock before build

1. **Reuse, don't fork, the PACE engine.** `src/pace/pace.js` (`buildPace`) and
   `src/pace/report.js` stay the single source of truth. M46 adds a **profile
   layer** that adjusts labels/defaults and a **card layer** that renders the
   same `plan` object into standard forms. No re-ranking, no second engine.
2. **Domain-neutral default stays.** The default profile is **"Generic"** with
   today's wording (no jargon, no insignia — the OPSEC/neutrality rule). Profiles
   are opt-in and only change vocabulary + which cards are offered, never the
   physics or the map.
3. **Cards are data-faithful, never inventive.** A card only renders fields the
   plan/registry actually contains; missing fields render as blanks to fill by
   hand (matching how these forms are used in the field), never fabricated. No
   AI text.
4. **Standards fidelity.** ICS-205 follows the FEMA v3.1 field layout; the MOSS
   card follows the ETC telecoms-annex checklist items. Cite both in
   `docs/decisions/` so the layout is auditable.

---

## A. Domain profiles (`src/pace/profiles.js`, pure)

A small static table — no behaviour engine, just vocabulary + offered cards:

```js
export const PROFILES = {
  generic:     { label:'Generic',        tierWords:['Primary','Alternate','Contingency','Emergency'], cards:['pace'] },
  sar:         { label:'Search & Rescue', cards:['pace','ics205'],  notes:'simplex-first; temp repeater when terrain demands' },
  humanitarian:{ label:'Humanitarian',    cards:['pace','moss'],    notes:'VHF net + HF/NVIS; radio-room + convoy discipline' },
  defence:     { label:'Defence/EW',      cards:['pace'],           notes:'EMCON-aware; min-power (see M49)' },
  mining:      { label:'Mining',          cards:['pace'],           notes:'surface LMR; survivable backup (MF/TTE) as Contingency/Emergency' },
  expedition:  { label:'Expedition',      cards:['pace'],           notes:'HF/NVIS + satcom; check-in schedule' },
};
```

- Selecting a profile sets the offered cards and any tier-label nuance; it does
  **not** alter `buildPace` logic. The `notes` surface as a one-line hint in the
  plan panel, not in the map or exports (keeps artifacts neutral).
- Profile choice is part of mission state (M21 mission file) so a saved plan
  reopens in the same profile.

## B. Card renderers (`src/pace/cards.js`, pure HTML builders)

Each takes `(plan, mission, profile)` and returns a print-ready HTML fragment,
exported through the **existing M6 routes** (PDF-via-print, `.doc`, and the
standalone-`.html` pop-up fallback). No new export plumbing.

- **PACE card** (`pace`) — one page: the four legs (tier badge · bearer · role ·
  why), the comms structure line, talk-in height, op date/time, and the standing
  caveats. The universal default card.
- **ICS-205** (`ics205`) — FEMA v3.1 layout: incident name, op period, the
  channel/assignment rows (channel name, function, RX/TX freq, RX/TX tone,
  mode A/D, remarks) populated from the arsenal + plan, prepared-by/date.
  Channels with no assignment render as blank rows to complete on scene.
- **MOSS telecoms checklist** (`moss`) — the ETC telecoms-annex items as a
  checklist: radio room established, call-sign list, radio-check schedule, VHF
  net coverage of the AO, HF/sat fallback, vehicle/handheld fleet — each ticked
  from what the plan/coverage provides, blanks where the planner must confirm.

## C. UI

- In the M6 "Comms plan" panel: a **Profile** selector (Generic default) above
  the existing PACE legs; selecting it updates the offered cards in the export
  block. The export block gains the profile's cards alongside the existing
  PDF/Word/Excel report checkboxes (e.g. SAR shows "ICS-205"; humanitarian shows
  "MOSS checklist"). ⌘K gains "Export ICS-205" / "Export PACE card" when
  available.
- Cards open via the same print/download flow as the M6 report; the OPSEC footer
  (built locally, not uploaded) is on every card.

---

## Tests (vitest, pure logic)

- `profiles.test.js` — profile table integrity (each offered card has a
  renderer); selecting a profile changes offered cards but not `buildPace`
  output (assert identical `plan` across profiles for the same input).
- `cards.test.js` — given a known `plan` + arsenal, the ICS-205 fragment
  contains the expected channel rows in the FEMA field order and leaves
  unassigned channels blank (no fabricated freqs); the MOSS card ticks only the
  items the plan supports and leaves the rest unchecked; the PACE card shows
  four tiers and the structure line; every card carries the OPSEC footer; no
  card emits coordinates beyond what the plan already contains.

DOM/print verified manually in the browser (standing rule): switch profiles,
export each card to PDF and `.doc`, confirm the layouts and the blanks.

## Constraints & non-goals

- Built on M6 — no second PACE engine, no re-ranking; cards reuse M6 export
  routes and report styles. No new dependencies, no network, no token.
- **Domain-neutral default preserved**; profiles only change vocabulary + offered
  cards, never the map or the physics; artifacts stay free of insignia/jargon.
- No colour/token changes; both themes; keyboard + ARIA; OPSEC footer on every
  card; no fabricated field values.
- Out of scope: EMCON/min-power (M49), route check-in scheduling (pairs with the
  expedition profile later), true OOXML export (the M6 decision record owns
  that), spectrum deconfliction (M43).

## Acceptance checklist

- [ ] Profile selector defaults to Generic; switching profiles changes offered
      cards but leaves the PACE `plan` and the map unchanged.
- [ ] SAR profile exports a FEMA-v3.1 ICS-205 populated from arsenal + plan,
      blanks where unassigned.
- [ ] Humanitarian profile exports a MOSS telecoms checklist ticked from the
      plan/coverage.
- [ ] The universal PACE card exports for any profile; OPSEC footer on every card.
- [ ] Profile choice persists in the M21 mission file.
- [ ] `npm test` green; `npm run build` clean; both themes; standards layouts
      recorded in `docs/decisions/`.
