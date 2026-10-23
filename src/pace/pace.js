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
 *     arsenal: [radio, …],   // the radios carried; names real kit per leg
 *     links: number,         // radio links between sites
 *     build, generatedAt,
 *   }
 *
 * ── Output ──────────────────────────────────────────────────────────────────
 *   {
 *     legs: [ { tier, band, asset, role, why, status, radios, freqMHz }, …4 ],   // P, A, C, E order
 *     overlays: [ { band, why } ],          // non-tier additions (LoRa telemetry, cellular notes)
 *     structure: { fixedSites, recommendedSites, totalSites, talkInHeightM, topology, backhaul, links, note },
 *     summary: string,
 *     gaps: ['Alternate', …],               // tiers with status 'gap'
 *     toAcquire: [ { tier, band } ],        // tiers with status 'recommend'
 *     context: { … echoed for the report … },
 *   }
 *
 * leg.status: 'ok'       terrestrial line-of-sight band the coverage raster models
 *             'separate' a real leg not rastered this milestone (HF NVIS)
 *             'asset'    an assured / airborne asset (satcom, UAS relay) — no raster
 *             'recommend' the band fits but no carried radio covers it (buy or
 *                        borrow); only when an arsenal is given
 *             'gap'      no candidate available for this tier
 *
 * With an arsenal, carried bands lead and each leg lists the carried radios.
 * The Alternate may be a talk-around leg on the Primary band (base / vehicle
 * sets working simplex) when no second band is carried.
 *
 * Doctrine note: an airborne (UAS) relay fills the Alternate leg — it is an
 * elevated alternate path for the Primary band — matching the app's existing
 * status-bar convention ("Airborne = Alternate").
 */

export const PACE_TIERS = ['Primary', 'Alternate', 'Contingency', 'Emergency'];
const TERRESTRIAL = new Set(['VHF', 'UHF']); // line-of-sight voice bands the raster models

/**
 * PACE band of a radio: its role first (HF, satcom and LoRa sets are named by
 * role), then its default frequency. VHF is 30–300 MHz and UHF 300–1000 MHz;
 * anything above is microwave point-to-point backhaul — a data backbone, not a
 * voice PACE leg.
 */
export function radioBand(r) {
  if (!r) return null;
  if (r.role === 'satcom') return 'Satcom';
  if (r.role === 'lora') return 'LoRa';
  const f = Number(r.defaultFreqMHz ?? r.freqRangeMHz?.[0]);
  if (r.role === 'hf' || (Number.isFinite(f) && f < 30)) return 'HF NVIS';
  if (!Number.isFinite(f)) return null;
  if (f < 300) return 'VHF';
  if (f < 1000) return 'UHF';
  return 'Backhaul';
}

/** A leg that is really covered by kit (not a gap, not a buy recommendation). */
export const legFilled = (l) => !!l && l.status !== 'gap' && l.status !== 'recommend';

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

  // ── The radios actually carried (arsenal), grouped by PACE band ─────────
  // With kit on hand the plan names real radios, and a band the mix suggests
  // but nobody carries becomes a buy recommendation instead of a filled leg.
  // Without any kit the plan stays a band-level recommendation (as before).
  const arsenal = Array.isArray(input.arsenal) ? input.arsenal.filter(Boolean) : [];
  const haveKit = arsenal.length > 0;
  const carried = new Map();
  for (const r of arsenal) {
    const band = radioBand(r);
    if (!band) continue;
    if (!carried.has(band)) carried.set(band, []);
    carried.get(band).push(r);
  }
  const labelsOf = (band) => (carried.get(band) ?? []).map((r) => r.label).filter(Boolean);
  const freqOf = (band) => {
    const r = (carried.get(band) ?? [])[0];
    return Number.isFinite(r?.defaultFreqMHz) ? r.defaultFreqMHz : null;
  };

  // ── Named coverage structures → contribute extra band candidates ────────
  const structs = Array.isArray(input.structures) ? input.structures : [];
  for (const [i, s] of structs.entries()) {
    const r = s.infra || s.field;
    const band = radioBand(r);
    if (!band || band === 'Backhaul') continue;
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
  // A carried band the mix did not suggest is still a real option.
  for (const band of carried.keys()) {
    if (band === 'Backhaul' || bands.find((b) => b.band === band)) continue;
    bands.push({ band, rank: 50, pace: null, why: `Carried: ${labelsOf(band).join(', ')}`, separateModule: band === 'HF NVIS' });
  }

  const byBand = (name) => bands.find((b) => b.band === name) || null;
  const isCarried = (band) => carried.has(band);
  // Carried terrestrial bands lead; the mix rank orders within each group.
  const terrestrial = bands
    .filter((b) => TERRESTRIAL.has(b.band))
    .sort((a, b) => (haveKit ? Number(isCarried(b.band)) - Number(isCarried(a.band)) : 0) || a.rank - b.rank);
  const hf = byBand('HF NVIS');
  const satcom = byBand('Satcom');
  const lora = byBand('LoRa');

  const used = new Set();
  const legs = [];

  /** A leg on `band`: filled by carried radios, or a buy recommendation when kit exists but not this band. */
  const bandLeg = (tier, b, role, filledStatus) => {
    const own = isCarried(b.band);
    const status = !haveKit || own ? filledStatus : 'recommend';
    return {
      tier,
      band: b.band,
      asset: b.band === 'Satcom' ? 'satcom' : null,
      role,
      why: b.why,
      status,
      radios: labelsOf(b.band),
      freqMHz: freqOf(b.band),
    };
  };
  const terrLeg = (tier, b) => {
    used.add(b.band);
    return bandLeg(tier, b, terrestrialRole(b.band, totalSites), 'ok');
  };

  // ── Primary: best-ranked terrestrial line-of-sight band ────────────────
  legs[0] = terrestrial[0]
    ? terrLeg('Primary', terrestrial[0])
    : gapLeg('Primary', 'No terrestrial line-of-sight band fits — run the radio mix, or add a VHF/UHF set.');
  if (legs[0].status === 'ok' && Number.isFinite(input.params?.freqMHz) && !legs[0].freqMHz) {
    legs[0].freqMHz = input.params.freqMHz;
  }

  // ── Alternate: 2nd carried band → talk-around → airborne relay → 2nd band (recommend) → gap
  const terr2 = terrestrial.find((b) => !used.has(b.band));
  const primaryBand = legs[0].status === 'ok' ? legs[0].band : null;
  const direct = primaryBand ? (carried.get(primaryBand) ?? []).filter((r) => r.role === 'base' || r.role === 'mobile') : [];
  if (terr2 && (!haveKit || isCarried(terr2.band))) legs[1] = terrLeg('Alternate', terr2);
  else if (direct.length) legs[1] = talkAroundLeg(primaryBand, direct, freqOf(primaryBand));
  else if (droneRelay) { legs[1] = airborneLeg('Alternate', droneAlt); used.add('__air'); }
  else if (terr2) legs[1] = terrLeg('Alternate', terr2);
  else legs[1] = gapLeg('Alternate', 'No second terrestrial band or airborne relay — add a UHF set, or place a drone relay for an Alternate path.');

  // ── Contingency: HF NVIS → airborne relay → 3rd terrestrial → gap ──────
  const hfLeg = () => {
    const leg = bandLeg('Contingency', hf, 'HF NVIS — beyond line-of-sight (separate module)', 'separate');
    used.add('HF NVIS');
    return leg;
  };
  if (hf && (!haveKit || isCarried('HF NVIS'))) legs[2] = hfLeg();
  else if (droneRelay && !used.has('__air')) { legs[2] = airborneLeg('Contingency', droneAlt); used.add('__air'); }
  else if (hf) legs[2] = hfLeg();
  else {
    const terr3 = terrestrial.find((b) => !used.has(b.band));
    legs[2] = terr3
      ? terrLeg('Contingency', terr3)
      : gapLeg('Contingency', 'No beyond-LOS leg — an HF NVIS asset or a drone relay would fill the Contingency tier.');
  }

  // ── Emergency: satcom (always suggested by the mix) → gap ──────────────
  legs[3] = satcom
    ? bandLeg('Emergency', satcom, 'Satcom — assured, terrain-independent leg', 'asset')
    : gapLeg('Emergency', 'No assured Emergency leg — a satcom asset is strongly recommended.');

  // ── Cellular PACE injection (EW-threat aware) ───────────────────────────
  const overlays = [];

  if (cellForPace !== 'none') {
    const tierIdx = cellForPace === 'alternate' ? 1 : 2; // Alternate=1, Contingency=2
    const tierName = PACE_TIERS[tierIdx];
    const cellRole = ewThreat === 'high'
      ? 'Encrypted private/tactical LTE only — exclude commercial cellular for sensitive traffic'
      : ewThreat === 'medium'
        ? 'Commercial LTE — monitor for interference and interception'
        : 'Commercial LTE — voice/data (low EW environment)';
    const cellWhy = ewThreat === 'high'
      ? `High interference threat: commercial cellular excluded; encrypted private LTE only. Interception and interference risk is high — last-resort ${tierName} path.`
      : `Cellular ${tierName.toLowerCase()} path — ${cellRole}. Interference threat: ${ewThreat}.`;
    const cellLeg = {
      tier: tierName,
      band: ewThreat === 'high' ? 'Cellular (private LTE)' : 'Cellular (LTE/4G)',
      asset: null,
      role: cellRole,
      why: cellWhy,
      status: 'asset',
      radios: [],
      freqMHz: null,
    };
    // The planner chose cellular for this tier: it beats a gap or a purchase.
    if (!legFilled(legs[tierIdx])) {
      legs[tierIdx] = cellLeg;
    } else {
      overlays.push({ band: cellLeg.band, why: cellWhy });
    }
  }

  // Under high EW threat: always flag cellular risk even if excluded from PACE
  if (ewThreat === 'high' && cellForPace === 'none') {
    overlays.push({
      band: 'Cellular — interception/interference risk',
      why: 'High interference threat: all cellular use carries interception and interference risk. Exclude from PACE unless the terminal is end-to-end encrypted.',
    });
  }

  if (lora) overlays.push({ band: 'LoRa', why: lora.why });

  const backhaul = labelsOf('Backhaul');
  const structure = {
    fixedSites: fixed.length,
    recommendedSites: recommended.length,
    totalSites,
    talkInHeightM,
    topology: topologyFor(totalSites),
    backhaul,
    links: Number.isFinite(input.links) ? input.links : 0,
    note: structureNote(totalSites, fixed.length, recommended.length, talkInHeightM, backhaul, input.links),
  };

  const gaps = legs.filter((l) => l.status === 'gap').map((l) => l.tier);
  const toAcquire = legs.filter((l) => l.status === 'recommend').map((l) => ({ tier: l.tier, band: l.band }));
  const summary = buildSummary(legs, structure, input.coverage, overlays, toAcquire);

  return {
    legs,
    overlays,
    structure,
    summary,
    gaps,
    toAcquire,
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

/**
 * Alternate on the Primary band without the repeaters: base and vehicle sets
 * talk simplex to each other and to handhelds nearby (talk-around). Shorter
 * reach, but it survives a repeater or backbone failure.
 */
function talkAroundLeg(band, direct, freqMHz) {
  return {
    tier: 'Alternate',
    band,
    asset: null,
    role: `${band} direct (talk-around) — simplex between base, vehicles and handhelds, no repeater`,
    why: 'Survives a repeater or backbone failure; reach limited to line-of-sight between users.',
    status: 'ok',
    radios: direct.map((r) => r.label).filter(Boolean),
    freqMHz,
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
    radios: [],
    freqMHz: null,
  };
}

function gapLeg(tier, why) {
  return { tier, band: null, asset: null, role: '— not filled —', why, status: 'gap', radios: [], freqMHz: null };
}

function topologyFor(n) {
  if (n <= 0) return 'standalone';
  if (n === 1) return 'single-hub';
  return 'relay-network';
}

function structureNote(total, fixed, rec, talkIn, backhaul = [], links = 0) {
  const tail = [];
  if (links > 0) tail.push(`${links} radio link${links === 1 ? '' : 's'} between sites`);
  if (backhaul.length) tail.push(`backhaul: ${backhaul.join(', ')} (data, not a voice leg)`);
  const extra = tail.length ? ` ${cap(tail.join('; '))}.` : '';
  if (total <= 0) {
    return `Standalone net — no fixed or recommended mast yet; talk-in modelled at ${talkIn} m. Place a site or run site recommendation to anchor the network.${extra}`;
  }
  const parts = [total === 1 ? 'Single hub' : `${total}-site relay network`];
  if (fixed) parts.push(`${fixed} fixed`);
  if (rec) parts.push(`${rec} recommended`);
  return `${parts.join(' · ')}; talk-in (handheld → mast) modelled at ${talkIn} m as the binding link.${extra}`;
}

function buildSummary(legs, structure, coverage, overlays, toAcquire = []) {
  const name = (l) => (l.status === 'gap' ? '—' : `${l.band || l.asset}${l.status === 'recommend' ? ' (not carried)' : ''}`);
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
  if (overlays.length) bits.push(`Also: ${overlays.map((o) => o.band).join(', ')}.`);
  const gaps = legs.filter((l) => l.status === 'gap').map((l) => l.tier);
  if (gaps.length) bits.push(`Unfilled: ${gaps.join(', ')}.`);
  if (toAcquire.length) {
    bits.push(`Not in your equipment: ${toAcquire.map((t) => `${t.band} (${t.tier})`).join(', ')} — acquire, or fill the tier another way.`);
  }
  bits.push('Planning-grade, not survey-grade.');
  return bits.join(' ');
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const num = (v, f) => (Number.isFinite(Number(v)) ? Number(v) : f);
