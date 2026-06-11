/**
 * M20 §4 — pure ranking model for the ⌘K command palette. The DOM overlay
 * lives in search.js; this module is the testable core: score a query against
 * provider items and produce ordered sections.
 *
 * Scoring tiers: label prefix > label word-start > label subsequence (fuzzy);
 * keyword hits count at half weight so a name hit always outranks them.
 * Sections keep the provider order handed in (Objects · Actions · Go to ·
 * Tabs), items sort by score within a section, max 6 per section, empty
 * sections drop. A query that parses as a coordinate (via the injected
 * parser) short-circuits into a single Go-to item.
 */

export const MAX_PER_SECTION = 6;

const TIER_PREFIX = 100;
const TIER_WORD = 80;
const TIER_FUZZY = 40;

function tierScore(q, text) {
  if (!text) return 0;
  const t = String(text).toLowerCase();
  if (t.startsWith(q)) return TIER_PREFIX;
  if (t.split(/\s+/).some((w) => w.startsWith(q))) return TIER_WORD;
  // subsequence match ("mta" → "MasT Alpha")
  let i = 0;
  for (const ch of t) {
    if (ch === q[i]) i += 1;
    if (i === q.length) return TIER_FUZZY;
  }
  return 0;
}

/** 0 = no match; higher = better. Keywords count at half a label's weight. */
export function matchScore(query, label, keywords = '') {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return 0;
  return Math.max(tierScore(q, label), tierScore(q, keywords) * 0.5);
}

/**
 * providers: [{ key, title, items: [{ label, keywords?, … }] }] in display
 * order. Returns [{ key, title, items }] — filtered, ranked, capped.
 */
export function rankPalette(query, providers, { parseCoordinate } = {}) {
  const q = String(query ?? '').trim();

  if (q && parseCoordinate) {
    const point = parseCoordinate(q);
    if (point) {
      return [{
        key: 'goto',
        title: 'Go to',
        items: [{ type: 'coordinate', label: q, point }],
      }];
    }
  }

  const out = [];
  for (const p of providers) {
    let items;
    if (!q) {
      items = p.items.slice(0, MAX_PER_SECTION);
    } else {
      items = p.items
        .map((item) => ({ item, score: matchScore(q, item.label, item.keywords) }))
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_PER_SECTION)
        .map((s) => s.item);
    }
    if (items.length) out.push({ key: p.key, title: p.title, items });
  }
  return out;
}
