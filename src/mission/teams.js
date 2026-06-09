/**
 * Teams / operators model (M13) — per-team comms planning.
 *
 * A team is a unit that shares a radio, a battery budget and (optionally) a
 * computed coverage footprint:
 *
 *   { id, name, color, members, radioId, powerWh, coverageStats }
 *
 *   color         — a CSS colour token reference (var(--…)), distinct per team
 *   members       — head-count sharing the bearer (feeds DMR capacity)
 *   radioId       — id of the chosen arsenal radio (or '' for none)
 *   powerWh       — battery budget in watt-hours
 *   coverageStats — null until a coverage run, then { coveredFracAoi, … }
 *
 * Pure + DOM-free so it is unit-testable. Observers subscribe()/unsubscribe()
 * to be notified (with the current team list) whenever anything changes.
 */

// Six distinct feature colours, all design-token references so they track the
// active theme. Assigned round-robin as teams are added.
export const TEAM_COLORS = [
  'var(--feat-site)',  // teal
  'var(--feat-track)', // azure
  'var(--feat-event)', // amber
  'var(--bad)',        // rose
  'var(--accent)',     // deep teal
  'var(--accent2)',    // azure
];

export function createTeamsManager() {
  const teams = [];
  const subscribers = new Set();
  let seq = 0;
  const nextId = () => `t${++seq}`;

  /** Snapshot copy so callers can't mutate internal state. */
  const snapshot = () => teams.map((t) => ({ ...t }));
  const emit = () => {
    const list = snapshot();
    for (const fn of subscribers) {
      try { fn(list); } catch { /* a bad subscriber must not break the rest */ }
    }
  };

  function addTeam(partial = {}) {
    const team = {
      id: nextId(),
      name: partial.name?.trim() || `Team ${teams.length + 1}`,
      color: partial.color || TEAM_COLORS[teams.length % TEAM_COLORS.length],
      members: Number.isFinite(Number(partial.members)) ? Math.max(1, Math.floor(Number(partial.members))) : 4,
      radioId: partial.radioId || '',
      powerWh: Number.isFinite(Number(partial.powerWh)) ? Math.max(0, Number(partial.powerWh)) : 0,
      coverageStats: null,
    };
    teams.push(team);
    emit();
    return team;
  }

  function updateTeam(id, patch = {}) {
    const t = teams.find((x) => x.id === id);
    if (!t) return null;
    if ('name' in patch) t.name = String(patch.name).trim() || t.name;
    if ('color' in patch) t.color = patch.color || t.color;
    if ('members' in patch) {
      const n = Number(patch.members);
      if (Number.isFinite(n)) t.members = Math.max(1, Math.floor(n));
    }
    if ('radioId' in patch) t.radioId = patch.radioId || '';
    if ('powerWh' in patch) {
      const n = Number(patch.powerWh);
      if (Number.isFinite(n)) t.powerWh = Math.max(0, n);
    }
    if ('coverageStats' in patch) t.coverageStats = patch.coverageStats || null;
    emit();
    return { ...t };
  }

  function removeTeam(id) {
    const i = teams.findIndex((x) => x.id === id);
    if (i === -1) return;
    teams.splice(i, 1);
    emit();
  }

  function getTeams() {
    return snapshot();
  }

  function subscribe(fn) {
    if (typeof fn === 'function') subscribers.add(fn);
    return () => subscribers.delete(fn);
  }
  function unsubscribe(fn) {
    subscribers.delete(fn);
  }

  return { addTeam, updateTeam, removeTeam, getTeams, subscribe, unsubscribe };
}
