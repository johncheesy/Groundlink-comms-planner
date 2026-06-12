/**
 * Auto-cost BOM (M26) — pure computation, no DOM, no pricing APIs.
 *
 * Turns the planned kit into a costed quote from USER-ENTERED prices only
 * (the "priced inventory" of the roadmap): arsenal radios carry an optional
 * `price` (entered in the radio editor, persisted with the arsenal), and the
 * M8 power-consumable lines (batteries / solar / powerbanks) take per-item
 * prices typed straight into the BOM table. Indicative-and-editable ethos:
 * unpriced rows stay visible and are counted, never guessed.
 *
 * Quantities: radio rows come from the M7 node-role assignment (one node per
 * role; roles sharing a radio aggregate into one line). Power rows reuse the
 * M8 networkBom quantities unchanged.
 */

const round2 = (n) => Math.round(n * 100) / 100;

/** Parse a user-entered price: number ≥ 0, else null (= unpriced). */
export function parsePrice(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Build the costed BOM.
 *
 * @param {object} o
 * @param {Array}  [o.nodes]      assignRoles() rows ({ label, radio } used)
 * @param {Array}  [o.powerLines] networkBom() lines ({ item, qty, unitSpec, rationale })
 * @param {Object} [o.priceMap]   user prices for power lines, keyed by line.item
 * @returns {{ rows: Array, totalKnown: number, unpricedCount: number, pricedCount: number }}
 *   row: { kind:'radio'|'power', item, qty, unitSpec, rationale?, unitPrice|null, total|null }
 */
export function costedBom({ nodes = [], powerLines = [], priceMap = {} } = {}) {
  const rows = [];

  // Radios: aggregate role-nodes per radio (HQ + Rebro on the same set → qty 2).
  const byRadio = new Map();
  for (const n of nodes) {
    if (!n?.radio) continue;
    const key = n.radio.id ?? n.radio.label;
    const e = byRadio.get(key) ?? { radio: n.radio, qty: 0, roles: [] };
    e.qty += 1;
    e.roles.push(n.label);
    byRadio.set(key, e);
  }
  for (const { radio, qty, roles } of byRadio.values()) {
    const unitPrice = parsePrice(radio.price);
    rows.push({
      kind: 'radio',
      item: radio.label,
      qty,
      unitSpec: roles.join(' · '),
      rationale: 'Node-role assignment (M7)',
      unitPrice,
      total: unitPrice == null ? null : round2(unitPrice * qty),
    });
  }

  // Power consumables: the M8 lines, priced from the user's per-item map.
  for (const l of powerLines) {
    const unitPrice = parsePrice(priceMap[l.item]);
    rows.push({
      kind: 'power',
      item: l.item,
      qty: l.qty,
      unitSpec: l.unitSpec,
      rationale: l.rationale,
      unitPrice,
      total: unitPrice == null ? null : round2(unitPrice * l.qty),
    });
  }

  const totalKnown = round2(rows.reduce((s, r) => s + (r.total ?? 0), 0));
  const unpricedCount = rows.filter((r) => r.unitPrice == null).length;
  return { rows, totalKnown, unpricedCount, pricedCount: rows.length - unpricedCount };
}

/** CSV field escaping (RFC 4180): quote when needed, double inner quotes. */
const csvField = (v) => {
  const s = String(v ?? '');
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Serialize the costed BOM as CSV (item, qty, unit_spec, unit_price, total +
 * a grand-total row; unpriced cells stay empty, never zero).
 */
export function bomToCsv(costed, { currency = 'EUR' } = {}) {
  const lines = [
    ['item', 'qty', 'unit_spec', `unit_price_${currency.toLowerCase()}`, `total_${currency.toLowerCase()}`].join(','),
  ];
  for (const r of costed.rows) {
    lines.push([
      csvField(r.item),
      r.qty,
      csvField(r.unitSpec ?? ''),
      r.unitPrice ?? '',
      r.total ?? '',
    ].join(','));
  }
  lines.push(['TOTAL (priced items)', '', '', '', costed.totalKnown].join(','));
  if (costed.unpricedCount) {
    lines.push([csvField(`${costed.unpricedCount} item(s) unpriced — total is a lower bound`), '', '', '', ''].join(','));
  }
  return lines.join('\r\n');
}
