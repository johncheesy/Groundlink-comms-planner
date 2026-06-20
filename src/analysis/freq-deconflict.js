/**
 * M39 — Frequency deconfliction.
 *
 * Pure function: takes the active radio arsenal and returns a list of
 * conflicts (co-channel, adjacent-channel, out-of-range, protected-band).
 *
 * No external data sources — ITU/ETSI band table is embedded.
 * All frequencies in MHz. Spacing thresholds follow ETSI TS 102 789 and
 * ITU-R recommendations for P25/DMR/TETRA land-mobile nets.
 */

// ── Known protected / restricted allocations ──────────────────────────────
// Entries with `note` are warnings (may be licensed); entries with `block`
// are hard conflicts (internationally protected / safety-of-life).
const PROTECTED_BANDS = [
  // Aviation
  { lo:  108.0, hi: 136.0, label: 'Aviation VHF (ILS/VOR/ATC)', block: true },
  // Marine distress / calling
  { lo:  156.3, hi: 156.325, label: 'Marine VHF Ch16 (distress calling)', block: true },
  { lo:  156.8, hi: 156.825, label: 'Marine VHF Ch16 guard (distress)', block: true },
  { lo:  156.525, hi: 156.55, label: 'Marine VHF DSC Ch70 (safety)', block: true },
  // PMR446 (EU licence-free) — not a hard block, but warn if pro gear uses it
  { lo:  446.0, hi: 446.2,  label: 'PMR446 (EU licence-free band)', note: 'Type-approved PMR446 portables only — licensed equipment may not operate here without explicit authorisation' },
  // MURS (US licence-free)
  { lo:  151.82, hi: 151.83, label: 'MURS (US)', note: 'US licence-free — not for licensed land-mobile' },
  { lo:  151.88, hi: 151.89, label: 'MURS (US)', note: 'US licence-free — not for licensed land-mobile' },
  { lo:  151.94, hi: 151.95, label: 'MURS (US)', note: 'US licence-free — not for licensed land-mobile' },
  { lo:  154.57, hi: 154.58, label: 'MURS (US)', note: 'US licence-free' },
  { lo:  154.60, hi: 154.61, label: 'MURS (US)', note: 'US licence-free' },
  // UHF emergency services (EU) — 380-400 MHz TETRA public safety
  { lo:  380.0, hi: 400.0,  label: 'TETRA Public Safety (EU)', note: 'Typically allocated to blue-light services — verify local plan before use' },
  // GPS / GNSS
  { lo: 1575.42 - 0.1, hi: 1575.42 + 0.1, label: 'GPS L1 (1575.42 MHz)', block: true },
  { lo: 1227.60 - 0.1, hi: 1227.60 + 0.1, label: 'GPS L2 (1227.60 MHz)', block: true },
  // Iridium (approximate L-band uplink)
  { lo: 1616.0, hi: 1626.5, label: 'Iridium L-band (satcom)', note: 'Do not transmit in this band from the ground near Iridium terminals' },
  // Inmarsat L-band
  { lo: 1525.0, hi: 1559.0, label: 'Inmarsat L-band (GEO downlink)', note: 'Satellite downlink — ground TX interference risk' },
];

// ── Typical channel spacing by band ──────────────────────────────────────
// ETSI EN 300 086 (VHF/UHF analogue), ETSI TS 102 789 (DMR), ITU-R M.1077 (P25)
function minSpacingKhz(freqMHz) {
  if (freqMHz < 30)    return 3;     // HF — very wide variation; 3 kHz as floor
  if (freqMHz < 300)   return 12.5;  // VHF NFM / DMR
  if (freqMHz < 1000)  return 12.5;  // UHF NFM / DMR
  return 125;                         // L/S-band — wide channels
}

// ── Conflict types ─────────────────────────────────────────────────────────
// Severity: 'error' | 'warn'

/**
 * @typedef {object} ConflictResult
 * @property {'error'|'warn'} severity
 * @property {'co-channel'|'adjacent'|'out-of-range'|'protected'} type
 * @property {string} message
 * @property {string[]} radioIds   — IDs of the radios involved
 * @property {string[]} radioLabels
 */

/**
 * Analyse the active radio arsenal for frequency conflicts.
 *
 * @param {Array<{id,label,defaultFreqMHz,freqRangeMHz,role}>} arsenal
 *   Active radios from radios.getArsenal()
 * @returns {ConflictResult[]}
 */
export function deconflict(arsenal) {
  const results = [];
  const radios = arsenal.filter(
    (r) => r.defaultFreqMHz && r.role !== 'satcom' && r.role !== 'hf',
  );

  // 1. Out-of-range check — radio tuned outside its declared band
  for (const r of radios) {
    if (!r.freqRangeMHz) continue;
    const [lo, hi] = r.freqRangeMHz;
    const f = r.defaultFreqMHz;
    if (f < lo || f > hi) {
      results.push({
        severity: 'error',
        type: 'out-of-range',
        message: `${r.label}: ${f} MHz is outside the declared range ${lo}–${hi} MHz`,
        radioIds: [r.id],
        radioLabels: [r.label],
      });
    }
  }

  // 2. Protected / restricted band check
  for (const r of radios) {
    const f = r.defaultFreqMHz;
    for (const band of PROTECTED_BANDS) {
      if (f >= band.lo && f <= band.hi) {
        const severity = band.block ? 'error' : 'warn';
        const extra = band.note ? ` — ${band.note}` : '';
        results.push({
          severity,
          type: 'protected',
          message: `${r.label} (${f} MHz) falls in ${band.label}${extra}`,
          radioIds: [r.id],
          radioLabels: [r.label],
        });
      }
    }
  }

  // 3. Co-channel and adjacent-channel conflicts between pairs
  for (let i = 0; i < radios.length; i++) {
    for (let j = i + 1; j < radios.length; j++) {
      const a = radios[i], b = radios[j];
      const fa = a.defaultFreqMHz, fb = b.defaultFreqMHz;
      const deltaKhz = Math.abs(fa - fb) * 1000;
      const spacing = minSpacingKhz(Math.min(fa, fb));

      if (deltaKhz < 0.5) {
        // Co-channel
        results.push({
          severity: 'error',
          type: 'co-channel',
          message: `Co-channel conflict: ${a.label} and ${b.label} both on ${fa} MHz`,
          radioIds: [a.id, b.id],
          radioLabels: [a.label, b.label],
        });
      } else if (deltaKhz < spacing) {
        // Adjacent channel
        results.push({
          severity: 'warn',
          type: 'adjacent',
          message: `Adjacent channel: ${a.label} (${fa} MHz) and ${b.label} (${fb} MHz) are ${deltaKhz.toFixed(1)} kHz apart — minimum recommended is ${spacing} kHz`,
          radioIds: [a.id, b.id],
          radioLabels: [a.label, b.label],
        });
      }
    }
  }

  // Sort: errors first, then warnings
  return results.sort((a, b) =>
    (a.severity === 'error' ? 0 : 1) - (b.severity === 'error' ? 0 : 1),
  );
}

/** Quick summary: { errors, warnings, ok } */
export function deconflictSummary(conflicts) {
  const errors   = conflicts.filter((c) => c.severity === 'error').length;
  const warnings = conflicts.filter((c) => c.severity === 'warn').length;
  return { errors, warnings, ok: errors === 0 && warnings === 0 };
}
