/**
 * M8 — Power & endurance model (pure, unit-tested).
 *
 * Budget power over a mission: how long a node's batteries last given how much
 * it transmits (duty cycle, or a timings plan), how many batteries + spares to
 * carry, the recharge interval, a solar/charge budget for static sites, drone
 * endurance, and a network bill-of-materials the M6 report consumes (plan.bom).
 *
 * Two coexisting models (see docs/M8-power-endurance.md):
 *   • Operator / handheld / manpack — DC current by state (§1): endurance =
 *     capacityAh / weightedCurrentA.
 *   • Fixed site / relay — RF power × duty (§2b): energyWh = txPowerW × hours ×
 *     duty, then a battery bank or a solar budget.
 *
 * Design principle (the M5 ethos): every number is an indicative, editable
 * default, never locked. The value is the model + the workflow.
 *
 * Pure + DOM-free. Imports only the sibling pure ATAK module for BOM roll-up.
 */

import { atakConsumedMah, powerbankRecommendation } from './atak.js';

// Industry convention radios are battery-rated at: 5 % TX, 5 % RX, 90 % standby.
export const DUTY_5_5_90 = { tx: 0.05, rx: 0.05, standby: 0.9 };

/**
 * Indicative DC-draw defaults by radio class (spec §4 — "typical datasheet").
 * Every value is editable in the UI; these are starting points, not guarantees.
 * Keyed by the arsenal radio `role`. Battery-supplied classes carry txA/rxA/
 * standbyA + a battery; mains/vehicle classes are powered externally.
 */
export const POWER_PROFILES = {
  handheld: { className: 'Handheld (5 W)',        supply: 'battery', txA: 1.6,  rxA: 0.35, standbyA: 0.08,  battery: { capacityAh: 2.6, voltageV: 7.4 } },
  manet:    { className: 'Handheld MANET',        supply: 'battery', txA: 1.8,  rxA: 0.5,  standbyA: 0.12,  battery: { capacityAh: 2.6, voltageV: 7.4 } },
  manpack:  { className: 'Manpack (10–20 W)',     supply: 'battery', txA: 4.0,  rxA: 0.5,  standbyA: 0.10,  battery: { capacityAh: 5.2, voltageV: 7.4 } },
  hf:       { className: 'HF manpack',            supply: 'battery', txA: 5.0,  rxA: 0.7,  standbyA: 0.15,  battery: { capacityAh: 5.2, voltageV: 7.4 } },
  satcom:   { className: 'Satcom terminal',       supply: 'battery', txA: 1.0,  rxA: 0.4,  standbyA: 0.10,  battery: { capacityAh: 2.6, voltageV: 7.4 } },
  lora:     { className: 'LoRa tracker',          supply: 'battery', txA: 0.12, rxA: 0.05, standbyA: 0.005, battery: { capacityAh: 2.6, voltageV: 3.7 } },
  mobile:   { className: 'Vehicle/mobile (25 W)', supply: 'vehicle' },
  base:     { className: 'Base / repeater',       supply: 'mains' },
  repeater: { className: 'Base / repeater',       supply: 'mains' },
};

/** Default DC profile for a radio role (falls back to the 5 W handheld). */
export function profileForRadioRole(role) {
  return POWER_PROFILES[role] || POWER_PROFILES.handheld;
}

// ── §1 Operator endurance (DC current by state) ─────────────────────────────

/**
 * Endurance + battery count for a handheld/manpack from its DC current draw.
 * @param {{txA:number, rxA:number, standbyA:number, battery:{capacityAh:number, voltageV?:number}}} device
 * @param {number} missionHours
 * @param {{tx:number, rx:number, standby:number}} duty   default 5-5-90
 * @param {number} sparePolicy  spare batteries added on top of mission cover (default 1)
 */
export function operatorEndurance(device = {}, missionHours = 0, duty = DUTY_5_5_90, sparePolicy = 1) {
  const txA = num(device.txA, 0);
  const rxA = num(device.rxA, 0);
  const standbyA = num(device.standbyA, 0);
  const capacityAh = num(device.battery?.capacityAh, 0);

  const d = normaliseDuty(duty);
  const weightedCurrentA = d.tx * txA + d.rx * rxA + d.standby * standbyA;
  const enduranceHours = weightedCurrentA > 0 ? capacityAh / weightedCurrentA : Infinity;

  const batteries = Number.isFinite(enduranceHours) && enduranceHours > 0
    ? Math.max(1, Math.ceil(num(missionHours, 0) / enduranceHours))
    : 1;
  const spare = Math.max(0, Math.round(sparePolicy));
  const batteriesWithSpare = batteries + spare;

  return {
    weightedCurrentA,
    enduranceHours,
    batteries,
    spare,
    batteriesWithSpare,
    rechargeIntervalH: enduranceHours,
  };
}

// ── Timings plan → effective duty cycle ─────────────────────────────────────

/**
 * Turn a few scheduled comms windows + a continuous-on overlay into effective
 * TX / RX / standby fractions over the mission.
 *
 *  - Each window {everyMin, txMin} fires floor(missionMin / everyMin) times,
 *    each contributing txMin of TX.
 *  - The continuous-on overlay (movement / live-direction) holds the radio open
 *    = RX for that span.
 *  - The remainder is standby. TX takes precedence over the continuous RX span
 *    so the three never sum past the mission.
 *
 * @param {{missionHours:number, windows:Array<{everyMin:number, txMin:number}>, continuousOnHours:number}} plan
 * @returns {{tx:number, rx:number, standby:number, missionMin:number, txMin:number, rxMin:number, standbyMin:number}}
 */
export function timingsToDuty(plan = {}) {
  const missionMin = num(plan.missionHours, 0) * 60;
  if (missionMin <= 0) return { ...DUTY_5_5_90, missionMin: 0, txMin: 0, rxMin: 0, standbyMin: 0 };

  const windows = Array.isArray(plan.windows) ? plan.windows : [];
  let txMin = 0;
  for (const w of windows) {
    const every = num(w.everyMin, 0);
    const tx = num(w.txMin, 0);
    if (every > 0 && tx > 0) txMin += Math.floor(missionMin / every) * tx;
  }
  txMin = Math.min(txMin, missionMin);

  const continuousMin = Math.max(0, num(plan.continuousOnHours, 0) * 60);
  const rxMin = Math.min(continuousMin, missionMin - txMin);
  const standbyMin = Math.max(0, missionMin - txMin - rxMin);

  return {
    tx: txMin / missionMin,
    rx: rxMin / missionMin,
    standby: standbyMin / missionMin,
    missionMin,
    txMin,
    rxMin,
    standbyMin,
  };
}

// ── §2b Fixed site energy · solar · drone ───────────────────────────────────

/**
 * Site RF energy budget + battery bank sizing.
 * Uses radio.txPowerW; falls back to deriving W from eirpDbm (−2.15 dBi → dBm).
 * @returns {{drawW:number, energyWh:number, batteryAh12V:number, batteryAh24V:number}}
 */
export function siteEnergyWh(radio = {}, missionHours = 0, dutyCycle = 0.3) {
  const drawW = txPowerW(radio);
  const energyWh = drawW * num(missionHours, 0) * num(dutyCycle, 0.3);
  return {
    drawW,
    energyWh,
    batteryAh12V: energyWh / 12,
    batteryAh24V: energyWh / 24,
  };
}

/**
 * Solar panel size to replace a daily/period energy budget.
 * Peak-sun hours by |lat|: <30° → 5.5 h, 30–50° → 4.0 h, >50° → 3.0 h.
 * Rounds up to a standard panel size.
 * @returns {{panelW:number, panelW_rounded:number, peakSunHours:number}}
 */
export function solarPanelW(energyWh, lat = 0, efficiency = 0.85) {
  const peakSunHours = peakSunFor(lat);
  const eff = num(efficiency, 0.85);
  const panelW = peakSunHours > 0 && eff > 0 ? num(energyWh, 0) / (peakSunHours * eff) : 0;
  return { panelW, panelW_rounded: roundPanel(panelW), peakSunHours };
}

/**
 * Drone (airborne relay) endurance + batteries to sustain a mission.
 * @param {number} batteryWh   pack energy
 * @param {number} avgDrawW    average system draw in flight/hover (default 150 W)
 * @param {number} reserveFrac landing reserve held back (default 0.2)
 * @param {number} missionHours hours the relay must be sustained (default 72)
 * @returns {{enduranceMin:number, enduranceHours:number, batteriesNeeded:number}}
 */
export function droneEnduranceMin(batteryWh, avgDrawW = 150, reserveFrac = 0.2, missionHours = 72) {
  const usableWh = num(batteryWh, 0) * (1 - num(reserveFrac, 0.2));
  const draw = num(avgDrawW, 150);
  const enduranceHours = draw > 0 ? usableWh / draw : 0;
  const enduranceMin = Math.floor(enduranceHours * 60);
  const batteriesNeeded = enduranceHours > 0
    ? Math.ceil(num(missionHours, 72) / enduranceHours)
    : 0;
  return { enduranceMin, enduranceHours, batteriesNeeded };
}

// ── Network BOM (the M6 report contract → plan.bom) ─────────────────────────

/**
 * Roll site solar, operator batteries, drone batteries and ATAK powerbanks into
 * a single bill of materials. Each line: { item, qty, unitSpec, rationale }.
 *
 * @param {{
 *   sites?: Array<object>,                       // radios for fixed/relay sites (txPowerW / eirpDbm)
 *   operators?: Array<object>,                   // handheld/manpack devices (txA/rxA/standbyA/battery)
 *   drone?: {batteryWh:number, avgDrawW?:number, reserveFrac?:number}|null,
 *   ataks?: Array<{drawMa?:number, deviceMah?:number, usableFrac?:number}>,
 *   missionHours?: number,
 *   lat?: number,
 *   duty?: {tx:number,rx:number,standby:number},
 *   siteDutyCycle?: number,
 * }} input
 * @returns {Array<{item:string, qty:number, unitSpec:string, rationale:string}>}
 */
export function networkBom(input = {}) {
  const missionHours = num(input.missionHours, 0);
  const lat = num(input.lat, 0);
  const lines = [];

  // Operator batteries (§1)
  const operators = Array.isArray(input.operators) ? input.operators : [];
  if (operators.length) {
    let total = 0;
    for (const op of operators) {
      const e = operatorEndurance(op, missionHours, input.duty ?? DUTY_5_5_90);
      total += e.batteriesWithSpare;
    }
    const first = operators[0];
    const cap = first.battery?.capacityAh;
    const volt = first.battery?.voltageV;
    lines.push({
      item: 'Handheld/manpack batteries',
      qty: total,
      unitSpec: cap ? `${cap} Ah${volt ? ` @ ${volt} V` : ''}` : 'per radio',
      rationale: `${operators.length} operator node(s) over ${missionHours} h incl. one spare each.`,
    });
  }

  // Static site solar (§2b)
  const sites = Array.isArray(input.sites) ? input.sites : [];
  if (sites.length) {
    let maxPanel = 0;
    let maxEnergy = 0;
    for (const s of sites) {
      const energy = siteEnergyWh(s, missionHours, num(input.siteDutyCycle, 0.3));
      const solar = solarPanelW(energy.energyWh, lat);
      if (solar.panelW_rounded > maxPanel) maxPanel = solar.panelW_rounded;
      if (energy.energyWh > maxEnergy) maxEnergy = energy.energyWh;
    }
    lines.push({
      item: 'Solar panel (static site)',
      qty: sites.length,
      unitSpec: `${maxPanel} W`,
      rationale: `Off-grid charge budget for ${sites.length} static site(s); largest is ${Math.round(maxEnergy)} Wh/period at lat ${lat}°.`,
    });
  }

  // Drone batteries (§2b)
  if (input.drone && Number.isFinite(Number(input.drone.batteryWh))) {
    const d = droneEnduranceMin(
      input.drone.batteryWh,
      input.drone.avgDrawW ?? 150,
      input.drone.reserveFrac ?? 0.2,
      missionHours || 72,
    );
    lines.push({
      item: 'Drone relay batteries',
      qty: d.batteriesNeeded,
      unitSpec: `${input.drone.batteryWh} Wh`,
      rationale: `${d.enduranceMin} min per pack; sustains the airborne relay over ${missionHours || 72} h.`,
    });
  }

  // ATAK powerbanks (§2)
  const ataks = Array.isArray(input.ataks) ? input.ataks : [];
  if (ataks.length) {
    let totalPacks = 0;
    let size = 0;
    for (const a of ataks) {
      const consumed = atakConsumedMah(a.drawMa ?? 600, missionHours);
      const rec = powerbankRecommendation(consumed, a.deviceMah ?? 5000, a.usableFrac ?? 0.65);
      totalPacks += rec.fullOffBankCount;
      if (rec.fullOffBankSizeMah > size) size = rec.fullOffBankSizeMah;
    }
    lines.push({
      item: 'ATAK EUD powerbanks',
      qty: totalPacks,
      unitSpec: `${size} mAh`,
      rationale: `Keeps ${ataks.length} ATAK device(s) powered over ${missionHours} h (65% usable deration).`,
    });
  }

  return lines;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function txPowerW(radio) {
  if (Number.isFinite(Number(radio?.txPowerW))) return Number(radio.txPowerW);
  if (Number.isFinite(Number(radio?.powerW))) return Number(radio.powerW);
  if (Number.isFinite(Number(radio?.eirpDbm))) {
    const dbm = Number(radio.eirpDbm) - 2.15; // strip a nominal 2.15 dBi antenna gain
    return Math.pow(10, dbm / 10) / 1000;
  }
  return 5; // indicative default
}

function peakSunFor(lat) {
  const a = Math.abs(num(lat, 0));
  if (a < 30) return 5.5;
  if (a <= 50) return 4.0;
  return 3.0;
}

const PANEL_SIZES = [20, 50, 100, 200, 400];
function roundPanel(w) {
  if (!(w > 0)) return 0;
  return PANEL_SIZES.find((s) => s >= w) ?? Math.ceil(w / 100) * 100;
}

function normaliseDuty(duty) {
  const tx = num(duty?.tx, DUTY_5_5_90.tx);
  const rx = num(duty?.rx, DUTY_5_5_90.rx);
  const standby = num(duty?.standby, DUTY_5_5_90.standby);
  return { tx, rx, standby };
}

const num = (v, f) => (Number.isFinite(Number(v)) ? Number(v) : f);
