/**
 * Shared HTML escape helper.
 *
 * Escapes & < > " ' so user-supplied strings are safe to insert into innerHTML.
 * Use this everywhere a string goes into .innerHTML or a template literal that
 * ends up as innerHTML — never roll a local copy.
 *
 * @param {*} s  value to escape (coerced to string; null/undefined → '')
 * @returns {string}  HTML-safe string
 */
const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => MAP[c]);
}
