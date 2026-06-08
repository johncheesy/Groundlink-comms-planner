/**
 * M7 — Node-role assignment (pure, rule-based, explainable).
 *
 * Given the user's radio *arsenal* (the radios they actually carry) and the
 * mission/terrain context, pick the best-fit radio for each operational node
 * role — who carries it and how it's deployed:
 *
 *   Operator (manpack) · Mobile command post (vehicle) · HQ (static) ·
 *   Rebro/repeater (mobile) · Rebro/repeater (static)
 *
 * No AI: each pick is the top of a transparent score, with a one-line reason and
 * the next two alternatives. Pure + DOM-free → unit-testable and reusable (the
 * assignment can feed the M6 PACE plan later).
 *
 * Arsenal entries are normalised radio objects (see radios/model.js):
 *   { label, role, freqRangeMHz, defaultFreqMHz, powerW, rxSensDbm, … }
 *
 * Context (all optional): { urbanFrac, reachKm, ruggednessM }.
 */

export const NODE_ROLES = [
  { key: 'operator',     label: 'Operator (manpack)',         mobility: 'foot',    power: 'battery', heightM: 1.8, prefer: ['handheld', 'manpack', 'manet'], txMaxW: 10 },
  { key: 'mobile-cp',    label: 'Mobile command post (veh.)', mobility: 'vehicle', power: 'vehicle', heightM: 3,   prefer: ['mobile', 'manpack', 'base'],    txMaxW: 50 },
  { key: 'hq',           label: 'HQ (static)',                mobility: 'static',  power: 'mains',   heightM: 12,  prefer: ['base', 'repeater', 'mobile'],   txMaxW: 100 },
  { key: 'rebro-mobile', label: 'Rebro / repeater (mobile)',  mobility: 'vehicle', power: 'vehicle', heightM: 4,   prefer: ['repeater', 'mobile', 'base'],   txMaxW: 50 },
  { key: 'rebro-static', label: 'Rebro / repeater (static)',  mobility: 'static',  power: 'mains',   heightM: 25,  prefer: ['repeater', 'base'],             txMaxW: 100 },
];

/** Assign the best arsenal radio to each node role. */
export function assignRoles(arsenal = [], context = {}) {
  const radios = (arsenal || []).filter(Boolean);
  return NODE_ROLES.map((role) => {
    if (!radios.length) {
      return {
        key: role.key, label: role.label, radio: null, heightM: role.heightM,
        why: 'No radios in the arsenal yet — add the radios you carry to assign roles.',
        alternatives: [], score: 0,
      };
    }
    const ranked = radios
      .map((r) => ({ r, score: scoreForRole(r, role, context) }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    return {
      key: role.key,
      label: role.label,
      radio: best.r,
      heightM: role.heightM,
      why: reason(best.r, role, context),
      alternatives: ranked.slice(1, 3).map((x) => x.r.label),
      score: best.score,
    };
  });
}

/** Transparent fit score of a radio for a node role. Higher = better fit. */
export function scoreForRole(r, role, ctx = {}) {
  let s = 0;

  // 1. Equipment-class fit — the dominant term.
  const pref = role.prefer.indexOf(r.role);
  if (pref === 0) s += 40;
  else if (pref === 1) s += 26;
  else if (pref === 2) s += 16;
  else s += 4; // eligible but not the natural class for this platform

  // 2. HF / satcom / LoRa are PACE assets / overlays, not a platform's main
  //    line-of-sight voice radio — deprioritise for the node bearer.
  if (r.role === 'hf' || r.role === 'satcom') s -= 30;
  else if (r.role === 'lora') s -= 18;

  // 3. Power vs the platform's realistic budget.
  const p = num(r.powerW, 5);
  if (p > role.txMaxW * 1.5) s -= 14; // implausibly hot for the platform
  if (role.power === 'battery') {
    if (p <= 8) s += 6; // modest draw suits a manpack
    else if (p > 12) s -= 6; // heavy on batteries
  } else {
    s += Math.min(12, p / 5); // mains / vehicle rewards reach
  }

  // 4. Mission tie-breakers (light): band vs terrain / built-up share.
  const band = bandOf(r);
  if (num(ctx.urbanFrac) >= 0.25 && band === 'UHF') s += 6;
  if (num(ctx.reachKm) > 30 && band === 'VHF') s += 6;
  if (num(ctx.ruggednessM) >= 120 && (role.key === 'rebro-static' || role.key === 'hq')) s += 4;

  return Math.round(s);
}

function reason(r, role, ctx) {
  const band = bandOf(r);
  const bits = [`${band} ${role.prefer.includes(r.role) ? r.role : `(${r.role})`}`, `${num(r.powerW, 5)} W`];
  if (role.power !== 'battery' && num(r.powerW) >= 25) bits.push('high power suits a fixed/vehicle node');
  if (role.power === 'battery' && num(r.powerW) <= 8) bits.push('low draw suits a manpack');
  if (num(ctx.urbanFrac) >= 0.25 && band === 'UHF') bits.push('UHF favoured in built-up terrain');
  if (num(ctx.reachKm) > 30 && band === 'VHF') bits.push('VHF favoured for the longer reach');
  return `${r.label} — ${bits.join('; ')}.`;
}

function bandOf(r) {
  if (r.role === 'hf') return 'HF';
  if (r.role === 'lora') return 'LoRa';
  if (r.role === 'satcom') return 'Satcom';
  const f = num(r.defaultFreqMHz) || (num(r.freqRangeMHz?.[0]) + num(r.freqRangeMHz?.[1])) / 2 || 150;
  if (f < 30) return 'HF';
  if (f < 300) return 'VHF';
  if (f < 1000) return 'UHF';
  return 'SHF';
}

const num = (v, f = 0) => (Number.isFinite(Number(v)) ? Number(v) : f);
