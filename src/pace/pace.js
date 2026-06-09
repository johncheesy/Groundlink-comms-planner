/**
 * M6 — PACE & comms-structure consolidation (pure, rule-based, explainable).
 *
 * Takes the M5 radio-mix output (each band already carries a first-pass PACE
 * tag) plus the mission's sites / coverage / airborne assets, and resolves it
 * into a clean four-tier PACE plan — Primary, Alternate, Contingency, Emergency
 * — with one recommendation per tier, a comms-structure summary, and an honest
 * list of any tiers it could not fill. No AI, no opaque scoring: every leg is
 * placed by a stated rule and carries a one-line rationale. This is the object
 * the report builder (`report.js`) renders.
 *
 * Pure + DOM-free so it is unit-testable and importable anywhere.
 *
 * ── Input (all optional; sensible fallbacks) ────────────────────────────────
 *   {
 *     mix:   { bands:[{ band, rank, pace, why, separateModule }], inputs },  // recommendMix()
 *     sites: { fixed:[{name,lat,lng}], recommended:[{label,lat,lng,elevM,…}] },
 *     coverage: { coveredFrac, terrain, clutter } | null,
 *     drone: { relay:boolean, altitudeM:number|null },
 *     params: { freqMHz, powerW, txHeightM, rxHeightM, useTerrain },
 *     mission: { hasAoi, aoiType, aoiAreaKm2, routeLengthKm, points },
 *     build, generatedAt,
 *   }
 *
 * ── Output ──────────────────────────────────────────────────────────────────
 *   {
 *     legs: [ { tier, band, asset, role, why, status }, …4 ],   // P, A, C, E order
 *     overlays: [ { band, why } ],          // non-tier additions (e.g. LoRa telemetry)
 *     structure: { fixedSites, recommendedSites, totalSites, talkInHeightM, topology, note },
 *     summary: string,
 *     gaps: ['Alternate', …],               // tiers with status 'gap'
 *     context: { … echoed for the report … },
 *   }
 *
 * leg.status: 'ok'       terrestrial line-of-sight band the coverage raster models
 *             'separate' a real leg not rastered this milestone (HF NVIS)
 *             'asset'    an assured / airborne asset (satcom, UAS relay) — no raster
 *             'gap'      no candidate available for this tier
 *
 * Doctrine note: an airborne (UAS) relay fills the Alternate leg — it is an
 * elevated alternate path for the Primary band — matching the app's existing
 * status-bar convention ("Airborne = Alternate").
 */

export const PACE_TIERS = ['Primary', 'Alternate', 'Contingency', 'Emergency'];
const TERRESTRIAL = new Set(['VHF', 'UHF']); // line-of-sight voice bands the raster models

/** Infer a PACE band name from a frequency range [loMHz, hiMHz] or null. */
function inferBandFromFreq(freqRange) {
  if (!freqRange || !Number.isFinite(freqRange[0])) return null;
  const lo = freqRange[0];
  if (lo < 30) return 'HF NVIS';
  if (lo < 88) return 'VHF';
  if (lo < 1000) return 'UHF';
  return null; // L/S band and above → not handled by the raster model
}

export function buildPace(input = {}) {
  const mix = input.mix && Array.isArray(input.mix.bands) ? input.mix : { bands: [], inputs: {} };
  const bands = mix.bands.slice();
  const fixed = input.sites?.fixed ?? [];
  const recommended = input.sites?.recommended ?? [];
  const totalSites = fixed.length + recommended.length;
  const droneRelay = !!input.drone?.relay;
  const droneAlt = Number.isFinite(input.drone?.altitudeM) ? input.drone.altitudeM : null;
  const talkInHeightM = num(input.params?.rxHeightM, 1.5);

  // ── EW threat + cellular PACE options ──────────────────────────────────
  const ewThreat = input.ewThreat ?? 'medium'; // none / low / medium / high
  const cellForPace = input.cellForPace ?? 'none'; // none / alternate / contingency

  // ── Named coverage structures → contribute extra band candidates ────────
  const structs = Array.isArray(input.structures) ? input.structures : [];
  for (const [i, s] of structs.entries()) {
    const r = s.infra || s.field;
    if (!r?.freqRangeMHz) continue;
    const band = inferBandFromFreq(r.freqRangeMHz);
    if (!band) continue;
    if (bands.find((b) => b.band === band)) continue; // already in mix
    bands.push({
      band,
      rank: 10 + i,
      pace: PACE_TIERS[i] || 'Contingency',
      why: `${s.name || `Structure ${i + 1}`} — ${r.label}`,
      separateModule: false,
      fromStructure: true,
    });
  }

  const byBand = (name) => bands.find((b) => b.band === name) || null;
  const terrestrial = bands.filter((b) => TERRESTRIAL.has(b.band)).sort((a, b) => a.rank - b.rank);
  const hf = byBand('HF NVIS');
  const satcom = byBand('Satcom');
  const lora = byBand('LoRa');

  const used = new Set();
  const legs = [];

  const terrLeg = (tier, b) => {
    used.add(b.band);
    return { tier, band: b.band, asset: null, role: terrestrialRole(b.band, totalSites), why: b.why, status: 'ok' };
  };

  // ── Primary: best-ranked terrestrial line-of-sight band ────────────────
  legs[0] = terrestrial[0]
    ? terrLeg('Primary', terrestrial[0])
    : gapLeg('Primary', 'No terrestrial line-of-sight band fits — run the radio mix, or add a VHF/UHF set.');

  // ── Alternate: 2nd terrestrial band → airborne relay → gap ─────────────
  const terr2 = terrestrial.find((b) => !used.has(b.band));
  if (terr2) legs[1] = terrLeg('Alternate', terr2);
  else if (droneRelay) { legs[1] = airborneLeg('Alternate', droneAlt); used.add('__air'); }
  else legs[1] = gapLeg('Alternate', 'No second terrestrial band or airborne relay — add a UHF set, or place a drone relay for an Alternate path.');

  // ── Contingency: HF NVIS → airborne relay → 3rd terrestrial → gap ──────
  if (hf) { legs[2] = { tier: 'Contingency', band: 'HF NVIS', asset: null, role: 'HF NVIS — beyond line-of-sight (separate module)', why: hf.why, status: 'separate' }; used.add('HF NVIS'); }
  else if (droneRelay && !used.has('__air')) { legs[2] = airborneLeg('Contingency', droneAlt); used.add('__air'); }
  else {
    const terr3 = terrestrial.find((b) => !used.has(b.band));
    legs[2] = terr3
      ? terrLeg('Contingency', terr3)
      : gapLeg('Contingency', 'No beyond-LOS leg — an HF NVIS asset or a drone relay would fill the Contingency tier.');
  }

  // ── Emergency: satcom (always present in the mix) → gap ────────────────
  legs[3] = satcom
    ? { tier: 'Emergency', band: 'Satcom', asset: 'satcom', role: 'Satcom — assured, terrain-independent leg', why: satcom.why, status: 'asset' }
    : gapLeg('Emergency', 'No assured Emergency leg — a satcom asset is strongly recommended.');

  // ── Cellular PACE injection (EW-threat aware) ───────────────────────────
  const overlays = [];

  if (cellForPace !== 'none') {
    const tierIdx = cellForPace === 'alternate' ? 1 : 2; // Alternate=1, Contingency=2
    const tierName = PACE_TIERS[tierIdx];
    const cellRole = ewThreat === 'high'
      ? 'Encrypted private/tactical LTE only — exclude commercial cellular for sensitive traffic'
      : ewThreat === 'medium'
        ? 'Commercial LTE — monitor for jamming/exploitation'
        : 'Commercial LTE — voice/data (low EW environment)';
    const cellWhy = ewThreat === 'high'
      ? `High EW threat: commercial cellular excluded; encrypted private/tactical LTE only. ELINT/jamming risk is high — use as last resort ${tierName} path.`
      : `Cellular ${tierName.toLowerCase()} path — ${cellRole}. EW threat: ${ewThreat}.`;
    const cellLeg = {
      tier: tierName,
      band: ewThreat === 'high' ? 'Cellular (private LTE)' : 'Cellular (LTE/4G)',
      asset: null,
      role: cellRole,
      why: cellWhy,
      status: 'asset',
    };
    if (legs[tierIdx]?.status === 'gap') {
      legs[tierIdx] = cellLeg;
    } else {
      overlays.push({ band: cellLeg.band, why: cellWhy });
    }
  }

  // Under high EW threat: always flag cellular risk even if excluded from PACE
  if (ewThreat === 'high' && cellForPace === 'none') {
    overlays.push({
      band: 'Cellular — ELINT/jamming risk',
      why: 'High EW threat: all cellular use carries exploitation and jamming risk. Exclude from PACE unless using an RAP-encrypted terminal.',
    });
  }

  if (lora) overlays.push({ band: 'LoRa', why: lora.why });

  const structure = {
    fixedSites: fixed.length,
    recommendedSites: recommended.length,
    totalSites,
    talkInHeightM,
    topology: topologyFor(totalSites),
    note: structureNote(totalSites, fixed.length, recommended.length, talkInHeightM),
  };

  const gaps = legs.filter((l) => l.status === 'gap').map((l) => l.tier);
  const summary = buildSummary(legs, structure, input.coverage, overlays);

  return {
    legs,
    overlays,
    structure,
    summary,
    gaps,
    bom: Array.isArray(input.bom) ? input.bom : [],
    context: {
      mix,
      params: input.params ?? {},
      coverage: input.coverage ?? null,
      mission: input.mission ?? null,
      drone: { relay: droneRelay, altitudeM: droneAlt },
      sites: { fixed, recommended },
      build: input.build ?? null,
      generatedAt: input.generatedAt ?? null,
    },
  };
}

function terrestrialRole(band, totalSites) {
  if (band === 'VHF') {
    return totalSites
      ? 'VHF — repeater talk-in over the relay network'
      : 'VHF — simplex / direct (no fixed repeater yet)';
  }
  if (band === 'UHF') return 'UHF — built-up / short-path, better structure penetration';
  return band;
}

function airborneLeg(tier, altM) {
  const at = Number.isFinite(altM) ? ` @ ${Math.round(altM)} m` : '';
  return {
    tier,
    band: 'UAS relay',
    asset: 'airborne',
    role: `Airborne relay${at} — elevated repeater extends line-of-sight`,
    why: `UAS airborne relay${at}: lifts the repeater above terrain shadow for an elevated ${tier} path; endurance / payload limited — see the drone module.`,
    status: 'asset',
  };
}

function gapLeg(tier, why) {
  return { tier, band: null, asset: null, role: '— not filled —', why, status: 'gap' };
}

function topologyFor(n) {
  if (n <= 0) return 'standalone';
  if (n === 1) return 'single-hub';
  return 'relay-network';
}

function structureNote(total, fixed, rec, talkIn) {
  if (total <= 0) {
    return `Standalone net — no fixed or recommended mast yet; talk-in modelled at ${talkIn} m. Place a site or run site recommendation to anchor the network.`;
  }
  const parts = [total === 1 ? 'Single hub' : `${total}-site relay network`];
  if (fixed) parts.push(`${fixed} fixed`);
  if (rec) parts.push(`${rec} recommended`);
  return `${parts.join(' · ')}; talk-in (handheld → mast) modelled at ${talkIn} m as the binding link.`;
}

function buildSummary(legs, structure, coverage, overlays) {
  const name = (l) => (l.status === 'gap' ? '—' : l.band || l.asset);
  const bits = [
    `Primary ${name(legs[0])}${structure.totalSites ? ` over a ${structure.topology}` : ''}, ` +
      `Alternate ${name(legs[1])}, Contingency ${name(legs[2])}, Emergency ${name(legs[3])}.`,
  ];
  if (coverage && Number.isFinite(coverage.coveredFrac)) {
    bits.push(
      `Last coverage run reached ${Math.round(coverage.coveredFrac * 100)}% of demand` +
        `${coverage.terrain ? ' (terrain-aware)' : ' (flat estimate)'}.`,
    );
  }
  if (overlays.length) bits.push(`Telemetry overlay: ${overlays.map((o) => o.band).join(', ')}.`);
  const gaps = legs.filter((l) => l.status === 'gap').map((l) => l.tier);
  if (gaps.length) bits.push(`Unfilled: ${gaps.join(', ')}.`);
  bits.push('Planning-grade, not survey-grade.');
  return bits.join(' ');
}

const num = (v, f) => (Number.isFinite(Number(v)) ? Number(v) : f);
