# M8 — Power & endurance (battery · duty-cycle · ATAK) (authoritative spec)

Budget power over a mission: how long each node's batteries last given how much
it transmits, how many batteries/spares to carry, recharge intervals, a solar/
charge budget for static sites, and — for the **ATAK end-user device** — the
**powerbank** (mAh) to bring. Promotes `../roadmap-next.md` §2 (a stated
differentiator). Ties to **M7 node roles** (each node's radio → its power
profile) and feeds the M6 report. Pure modelling + a panel UI.

## Design principle

Like M5 radio specs: every number is an **indicative, editable default**, never
locked. The value is the *model and the workflow*, not claimed-precise figures.

## 1. Power model — `src/power/power.js` (pure, unit-tested)

Per radio/device:

```
{ label, role,
  txA, rxA, standbyA,        // DC current draw by state (A)
  battery: { capacityAh, voltageV },  // or Wh
}
```

- **Duty cycle** — TX / RX / standby fractions. Default the industry **5-5-90**
  (the convention radios are battery-rated at), or derive from a *timings plan*.
- **Endurance (h)** = `capacityAh / weightedCurrentA`, where
  `weightedCurrentA = txFrac·txA + rxFrac·rxA + stbyFrac·standbyA`.
- **Mission cover** = `ceil(missionHours / enduranceHours)` batteries; add a spare
  policy (e.g. +1, or round up a safety factor). Report recharge interval =
  enduranceHours.
- **Static nodes** — instead of batteries, a **solar/charge budget**:
  averagePowerW = weightedCurrentA · voltageV; daily Wh = averagePowerW · 24;
  recommend panel Wh/day + battery buffer (with a derating factor).

### Timings plan (drives the effective duty cycle)

- A list of **scheduled comms windows** (e.g. SITREP every 30 min, 2 min TX) plus
  a **continuous-on overlay** for movement / live-direction phases (radio held
  open). Over the mission duration this yields the effective TX/RX/standby split
  → feed the endurance calc. Keep it simple: a few rows {everyMin, txMin} + a
  "continuous during X hours" toggle.

## 2. ATAK EUD + powerbank — `src/power/atak.js` (pure, unit-tested)

- Android EUD draw while running ATAK (screen + GPS + ATAK + radio link), as
  **mA** (indicative default ~**600 mA @ 3.85 V**, editable; plus device battery
  mAh). Over `missionHours` → consumed mAh.
- **Powerbank recommendation**: usable capacity ≈ rated · (cell 3.7 V → 5 V) ·
  efficiency ≈ **rated · 0.65** (document the deration). Recommended rated mAh =
  `(consumed − deviceBattery) / 0.65`, then suggest a standard size + count.

## 2b. Site energy · solar · drone · network BOM — `src/power/power.js`

Fixed sites, the drone relay, and a **bill of materials** the M6 report consumes
(this preserves the original M8 dispatch's scope — keep these signatures + test
numbers):

- `siteEnergyWh(radio, missionHours, dutyCycle = 0.3)` → `{ drawW, energyWh,
  batteryAh12V, batteryAh24V }`. Uses `radio.txPowerW` (M5); fallback derive from
  `eirpDbm` (subtract 2.15 dBi → W). *5 W, 72 h, 30% → 108 Wh, 9 Ah @ 12 V,
  4.5 Ah @ 24 V.*
- `solarPanelW(energyWh, lat, efficiency = 0.85)` → `{ panelW, panelW_rounded }`.
  Peak-sun by |lat|: <30° → 5.5 h, 30–50° → 4.0 h, >50° → 3.0 h. Round up to
  {20, 50, 100, 200, 400} W. *108 Wh, lat 52, 0.85 → ~42 W → 50 W panel.*
- `droneEnduranceMin(batteryWh, avgDrawW = 150, reserveFrac = 0.2)` →
  `{ enduranceMin, batteriesNeeded }`. *370 Wh, 150 W, 20% → 118 min; 37
  batteries / 72 h.*
- `networkBom(sites, radios, drone, missionHours)` → `[{ item, qty, unitSpec,
  rationale }]` — the **M6 report contract** (`plan.bom`). Roll up operator
  batteries (§1), site solar (§2b), drone batteries, and **ATAK powerbanks (§2)**
  into one BOM.

The operator model (§1, DC current by state) and the site model (§2b, RF-power ×
duty) coexist: handhelds/manpacks use §1, fixed sites/relays use §2b.

## 3. UI — "Power & endurance" panel section

- Per node (reuse the **M7 node roles**: Operator/Mobile-CP/HQ/Rebro × the
  arsenal radio assigned): mission duration, timings plan, battery type.
- Output card per node: endurance, batteries + spares, recharge interval; for
  static nodes the solar/charge budget; plus the **ATAK powerbank** line.
- A mission roll-up: total batteries by type, total powerbanks. Optionally feed a
  "power" section into the M6 report.

## 4. Indicative defaults (editable; document the source as "typical datasheet")

| Class | TX A | RX A | Standby A | Battery |
|-------|------|------|-----------|---------|
| Handheld (5 W) | 1.6 | 0.35 | 0.08 | 2600 mAh @ 7.4 V |
| Manpack (10–20 W) | 4.0 | 0.5 | 0.10 | 2× the above / BB-2590 class |
| Vehicle/mobile (25 W) | — | — | — | vehicle-powered (alternator) |
| Base/repeater | — | — | — | mains / genset (use solar budget if off-grid) |
| ATAK EUD | — | — | — | ~600 mA @ 3.85 V · 5000 mAh device |

Powerbank usable ≈ 65 % of rated. Duty default 5-5-90.

## 5. Caveats (surface in-app)

Indicative defaults; real draw varies by model, power level, temperature and
battery age — derate for cold and ageing. Planning aid, not a guarantee.

## Acceptance

1. Assign an Operator a 5 W handheld, 8 h mission, 5-5-90 → endurance, batteries +
   spare, recharge interval shown; editing TX current recomputes.
2. A timings plan (SITREP every 30 min + 2 h continuous-on during an action phase)
   changes the effective duty cycle and the battery count.
3. Static HQ node → solar/charge budget (Wh/day + panel suggestion) instead of
   batteries.
4. ATAK EUD + 8 h → consumed mAh and a recommended powerbank size + count, with
   the 0.65 deration applied.
5. `power.js` and `atak.js` are pure + unit-tested (endurance, battery count,
   timings→duty, powerbank deration, and `siteEnergyWh`/`solarPanelW`/
   `droneEnduranceMin`/`networkBom` against the numbers above).
6. `networkBom` rolls site + operator + drone + ATAK lines into one BOM; the M6
   report (`plan.bom`) shows a Power & endurance table in PDF / Word / Excel.
