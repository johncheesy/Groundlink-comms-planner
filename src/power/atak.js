/**
 * M8 — ATAK end-user device (EUD) power + powerbank recommendation (pure).
 *
 * An Android EUD running ATAK (screen + GPS + the ATAK service + a radio link)
 * draws an indicative ~600 mA @ 3.85 V. Over a mission that consumes a known
 * mAh; the question a planner asks is "what powerbank do I carry?".
 *
 * Every number here is an indicative, editable default (the M5 ethos) — the
 * value is the model + the workflow, not a claimed-precise figure.
 *
 * Pure + DOM-free so it is unit-testable and importable anywhere.
 * See docs/M8-power-endurance.md §2.
 */

// Common powerbank rated capacities (mAh). Editable / extendable by the caller.
export const STANDARD_POWERBANK_MAH = [5000, 10000, 20000, 26800];

/**
 * mAh consumed by the EUD over a mission.
 * @param {number} drawMa   indicative running draw in mA (default 600)
 * @param {number} hours    mission hours
 * @returns {number} consumed mAh
 */
export function atakConsumedMah(drawMa = 600, hours = 0) {
  return num(drawMa, 600) * num(hours, 0);
}

/**
 * Recommend a powerbank to cover the EUD over the mission.
 *
 * The device's own battery is the first reserve; the powerbank covers the
 * deficit beyond it, scaled up by a deration (a 3.7 V cell delivered at 5 V
 * through a lossy converter yields ≈ 65 % of its rated mAh):
 *
 *   recommendedRatedMah = max(0, consumed − deviceBattery) / usableFrac
 *
 * If the device battery already covers the mission the deficit is 0 and no
 * powerbank is strictly required — reported honestly. `fullOffBank*` gives the
 * size to run entirely off the bank (keeping the device battery as reserve),
 * which is what the UI surfaces as the practical "carry this" suggestion.
 *
 * @param {number} consumedMah   mAh the EUD will consume (atakConsumedMah)
 * @param {number} deviceMah     device battery capacity (default 5000)
 * @param {number} usableFrac    rated→usable deration (default 0.65)
 * @param {number[]} sizes       standard rated sizes to choose from
 */
export function powerbankRecommendation(
  consumedMah,
  deviceMah = 5000,
  usableFrac = 0.65,
  sizes = STANDARD_POWERBANK_MAH,
) {
  const consumed = num(consumedMah, 0);
  const device = num(deviceMah, 0);
  const usable = num(usableFrac, 0.65);

  // Spec model — external capacity needed beyond the device's own battery.
  const deficitMah = Math.max(0, consumed - device);
  const recommendedRatedMah = deficitMah > 0 ? Math.ceil(deficitMah / usable) : 0;
  const standardSizeMah = pickSize(recommendedRatedMah, sizes);
  const count = standardSizeMah > 0 ? Math.ceil(recommendedRatedMah / standardSizeMah) : 0;

  // Practical "run it all off the bank, keep the device battery as reserve".
  const fullOffBankRatedMah = consumed > 0 ? Math.ceil(consumed / usable) : 0;
  const fullOffBankSizeMah = pickSize(fullOffBankRatedMah, sizes);
  const fullOffBankCount = fullOffBankSizeMah > 0 ? Math.ceil(fullOffBankRatedMah / fullOffBankSizeMah) : 0;

  const note = deficitMah > 0
    ? `Device battery (${device} mAh) covers part of the mission; the powerbank covers the ${deficitMah} mAh deficit at ${Math.round(usable * 100)}% usable.`
    : `Device battery (${device} mAh) covers the ${consumed} mAh mission on its own. Carry a ${fullOffBankSizeMah} mAh bank (×${fullOffBankCount}) to keep it topped / as reserve.`;

  return {
    consumedMah: consumed,
    deviceMah: device,
    usableFrac: usable,
    deficitMah,
    recommendedRatedMah,
    standardSizeMah,
    count,
    fullOffBankRatedMah,
    fullOffBankSizeMah,
    fullOffBankCount,
    note,
  };
}

// Smallest standard size ≥ need; if it exceeds the largest, return the largest
// (the caller multiplies by `count`). Returns 0 when nothing is needed.
function pickSize(needMah, sizes) {
  if (!(needMah > 0)) return 0;
  return sizes.find((s) => s >= needMah) ?? sizes[sizes.length - 1];
}

const num = (v, f) => (Number.isFinite(Number(v)) ? Number(v) : f);
