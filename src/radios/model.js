/**
 * Radio model (M5) — the editable spec that drives the coverage model.
 *
 *   radio = {
 *     id, label,                    // "Motorola R7 VHF"
 *     role,                         // handheld|mobile|base|repeater|lora|satcom|hf
 *     freqRangeMHz: [lo, hi],
 *     defaultFreqMHz,
 *     powerW,                       // max conducted output
 *     rxSensDbm,                    // receiver sensitivity (12 dB SINAD / spec)
 *     antennaGainDbi,
 *     defaultHeightM,               // 1.5 handheld, 2 mobile, 10+ base/repeater
 *     source,                       // 'library' | 'fcc' | 'manual'
 *     notes, indicative,
 *   }
 *
 * Every field is user-editable; nothing is ever locked. Pure helpers here are
 * unit-tested; the small persistence layer guards sessionStorage (hosted origin
 * only — in-memory fallback in embedded previews, per CLAUDE.md).
 */

/** Sensible per-role defaults for fields a source (FCC grant, sparse entry)
 *  doesn't provide: antenna height, gain, and receiver sensitivity. */
export const ROLE_DEFAULTS = {
  handheld: { defaultHeightM: 1.5, antennaGainDbi: 2.15, rxSensDbm: -116 },
  manpack: { defaultHeightM: 2, antennaGainDbi: 2.15, rxSensDbm: -116 },
  manet: { defaultHeightM: 2, antennaGainDbi: 3, rxSensDbm: -95 },
  mobile: { defaultHeightM: 2, antennaGainDbi: 3, rxSensDbm: -116 },
  base: { defaultHeightM: 10, antennaGainDbi: 6, rxSensDbm: -118 },
  repeater: { defaultHeightM: 15, antennaGainDbi: 6, rxSensDbm: -119 },
  lora: { defaultHeightM: 2, antennaGainDbi: 3, rxSensDbm: -137 },
  satcom: { defaultHeightM: 1.5, antennaGainDbi: 3, rxSensDbm: -120 },
  hf: { defaultHeightM: 5, antennaGainDbi: 0, rxSensDbm: -120 },
};

const FALLBACK_ROLE = 'handheld';

/** Fill missing fields from role defaults; never overwrite a provided value. */
export function normalizeRadio(partial = {}) {
  const role = ROLE_DEFAULTS[partial.role] ? partial.role : FALLBACK_ROLE;
  const d = ROLE_DEFAULTS[role];
  const lo = partial.freqRangeMHz?.[0];
  const hi = partial.freqRangeMHz?.[1];
  const freqRangeMHz = [Number(lo) || 0, Number(hi) || 0];
  const defaultFreqMHz =
    Number(partial.defaultFreqMHz) ||
    (freqRangeMHz[0] && freqRangeMHz[1] ? (freqRangeMHz[0] + freqRangeMHz[1]) / 2 : freqRangeMHz[0] || 150);
  return {
    id: partial.id || `r${Math.abs(hashStr(partial.label || String(defaultFreqMHz)))}`,
    label: partial.label || 'Untitled radio',
    role,
    freqRangeMHz,
    defaultFreqMHz,
    powerW: num(partial.powerW, 5),
    rxSensDbm: num(partial.rxSensDbm, d.rxSensDbm),
    antennaGainDbi: num(partial.antennaGainDbi, d.antennaGainDbi),
    defaultHeightM: num(partial.defaultHeightM, d.defaultHeightM),
    source: partial.source || 'manual',
    notes: partial.notes || '',
    indicative: partial.indicative ?? false,
    // Native battery spec (M8 power budget) — carried through when present.
    ...(Number.isFinite(Number(partial.batteryMah)) ? { batteryMah: Number(partial.batteryMah) } : {}),
    ...(Number.isFinite(Number(partial.batteryV)) ? { batteryV: Number(partial.batteryV) } : {}),
    ...(partial.batteryModel ? { batteryModel: String(partial.batteryModel) } : {}),
  };
}

const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : fallback);

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/**
 * Derive coverage class thresholds (dBm) from a receiver sensitivity, per spec:
 *   marginal = sens + 7, good = sens + 15, excellent = sens + 25, none = sens.
 * Kept editable downstream; these are just the smart defaults.
 */
export function thresholdsFromSens(rxSensDbm) {
  return {
    excellent: Math.round(rxSensDbm + 25),
    good: Math.round(rxSensDbm + 15),
    marginal: Math.round(rxSensDbm + 7),
    none: Math.round(rxSensDbm),
  };
}

/**
 * Talk-in binding link → coverage controls. Tx params come from the
 * infrastructure radio (repeater/base); rx height + sensitivity from the field
 * unit (handheld/mobile). Returns the values the coverage UI consumes.
 */
export function activeSetToCoverage(infra, field) {
  const tx = infra || field;
  const rx = field || infra;
  if (!tx) return null;
  return {
    freqMHz: tx.defaultFreqMHz,
    powerW: tx.powerW,
    txHeightM: tx.defaultHeightM,
    txGainDbi: tx.antennaGainDbi,
    rxHeightM: rx.defaultHeightM,
    rxSensDbm: rx.rxSensDbm,
    thresholds: thresholdsFromSens(rx.rxSensDbm),
    txRole: tx.role,
    // HF and satcom are PACE assets, not terrestrial-LOS bands: HF is a separate
    // later module (NVIS/ALE, not ITM) and satcom has no coverage raster. The
    // FSPL plot does not represent them — the UI warns when one is the active tx.
    rasterMeaningful: tx.role !== 'hf' && tx.role !== 'satcom',
  };
}

/** Coarse band label from a radio's default operating frequency. */
export function bandLabel(freqMHz) {
  if (freqMHz < 30) return 'HF';
  if (freqMHz < 300) return 'VHF';
  if (freqMHz < 1000) return 'UHF';
  if (freqMHz < 3000) return 'L/S-band';
  return 'SHF';
}

// ── Persistence (hosted origin only; in-memory fallback) ──────────────────────

const STORE_KEY = 'gl.radioset.v1';
let memoryStore = null; // in-memory fallback when sessionStorage is unavailable

function storageAvailable() {
  try {
    const k = '__gl_test__';
    sessionStorage.setItem(k, '1');
    sessionStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

/** Load the saved radio set, or null if none / unavailable. */
export function loadRadioSet() {
  if (storageAvailable()) {
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  return memoryStore;
}

/** Persist the radio set. Silently uses memory when storage is unavailable. */
export function saveRadioSet(set) {
  if (storageAvailable()) {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(set));
      return true;
    } catch {
      /* fall through to memory */
    }
  }
  memoryStore = set;
  return false;
}
