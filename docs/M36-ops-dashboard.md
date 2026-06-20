# M36 — Mission Ops Dashboard

> **Status: spec — Jun 2026.** Maven-geïnspireerd: één panel dat alle actieve data-streams fuseert.

---

## Waarom

Maven Smart System comprimeerde de situational awareness van negen losse systemen naar één interface. GroundLink heeft alle data al — RF coverage, cellular best-network, drone relay, PACE-plan, teams — maar het is verspreid over meerdere tabs en panels. Een operator die snel de missie-status wil zien moet nu op vijf plekken kijken.

**M36 voegt één "Ops Dashboard" flyout toe aan de rechter map rail.** Eén klik geeft een live overzicht van de missie-gezondheid: is de coverage acceptabel? Welk netwerk pakt het beste? Is de drone relay nog in de lucht? Zijn alle PACE-tiers gevuld?

Dit is geen nieuw data — het is bestaande data beter getoond.

---

## Scope

**In scope:**
- Nieuwe rail-knop `ops` naast de bestaande basemap/data/view knoppen (M20 rail)
- Flyout panel met vijf live-updating secties
- Alles leest van bestaande app-state; geen nieuwe netwerkrequests

**Buiten scope:**
- Edits vanuit het dashboard (alleen read-only; wijzigingen via de normale panels)
- Alerts/notificaties push (zou M36b zijn)
- Historische vergelijking

---

## A. De vijf secties

### 1. RF Coverage
Leest van: coverage result (`summarizeCoverage()`, `src/analysis/summary.js`)

```
RF Coverage          [teal badge: 87% covered]
▪ 2 dead zones       3.4 km² totaal
▪ Weakest link       −112 dBm
▪ Model              P.1812 · 50% time
▪ Stale?             [amber pill "stale"] of [groen "current"]
```

Toont "not run yet" met een [Run coverage] knop als er nog geen resultaat is.

### 2. Cellular Best-Network
Leest van: `src/connectivity/cellular.js` — het M9/M22 best-network resultaat

```
Cellular             [azure badge: KPN 4G]
▪ Towers in AOI      14 (hoogste: −78 dBm)
▪ Fallback           Vodafone 3G
▪ Dead spots         1 area zonder dekking
```

Toont "layer off" als cellular-laag niet actief is.

### 3. Drone Relay
Leest van: `src/drone/drone.js` — drone state via `onState` callback

```
Drone Relay          [badge: active / off]
▪ Altitude           120 m AGL
▪ Position           52.14°N 4.32°E
▪ Endurance          M8 data: 38 min remaining
▪ Coverage gain      +34% vs ground mast
```

Toont "not placed" als drone niet actief is.

### 4. PACE Plan
Leest van: `src/pace/pace.js` — buildPace() output

```
PACE Plan            [badge: 4/4 tiers filled]
▪ P  VHF 146 MHz     ✓ primary
▪ A  UAS relay       ✓ airborne
▪ C  UHF 433 MHz     ✓ contingency
▪ E  HF NVIS         ✓ emergency
```

Toont gaps in rood als tiers niet gevuld zijn. Link naar M6 rapport.

### 5. Teams & Erlang
Leest van: `src/mission/teams.js` + `src/mission/erlang.js`

```
Teams                [badge: 3 teams · 12 users]
▪ Peak traffic       0.8 Erlang
▪ Grade of service   B.01 (goed)
▪ Frequentie-plan    1 simplex channel voldoet
```

---

## B. Implementatie

### Nieuwe bestanden
- `src/ui/dash-ops.js` — dashboard component (DOM controller)

### Bestaande bestanden aanpassen
- `src/ui/rail.js` — toevoegen: `'ops'` als geldige rail-key
- `src/ui/toolbar.js` — rail-knop `ops` toevoegen (icon: grid/dashboard)
- `src/main.js` — dashboard initialiseren, state doorgeven via `update(state)` call na elke coverage-run, cellular-update, drone-state-change, etc.
- `styles/components.css` — `.dash-ops` panel styling (volgt bestaand `.flyout` patroon)

### Datavlak
Het dashboard heeft geen eigen state. Het ontvangt een `update(snapshot)` call telkens wanneer de app-state verandert:

```js
// In main.js, na elke relevante event:
opsDash.update({
  coverage: lastCoverageResult,      // null als niet gerund
  coverageStale: planState.stale,
  cellular: cellularController.state(),
  drone: droneController.state(),
  pace: lastPaceResult,              // null als niet gerund
  teams: teamsModel.summary(),
  erlang: erlangResult,
});
```

### `src/ui/dash-ops.js`
```js
export function createOpsDashboard(host, { onRunCoverage, onOpenPace, onOpenTeams } = {}) {
  // Rendert de vijf secties op basis van snapshot
  // Elke sectie: header + badge (teal/azure/amber/rose/green) + detail rows
  // Leeg: placeholder met call-to-action
  return {
    update(snapshot) { /* render alle secties */ },
    show() { host.hidden = false; },
    hide() { host.hidden = true; },
  };
}
```

---

## C. Visueel

Volgt het bestaande flyout-patroon (M20 `data-flyout`, `basemap-flyout`):
- Breedte: 280 px (zelfde als andere rail-flyouts)
- Achtergrond: `var(--surface-2)`, border: `var(--border)`
- Sectie-headers: `var(--text-2)` label + badge rechts
- Badge-kleuren per sectie: teal (RF), azure (cellular), amber (drone), teal (PACE), azure (teams)
- Geen losse kleuren hardcoden — alleen CSS custom properties

---

## D. Complexiteit

**3 bestanden nieuw of aangepast van enige omvang** (dash-ops.js, main.js wiring, components.css).
Medium. Geschikt als eerste Maven-feature na installatie van de superpowers skill.
