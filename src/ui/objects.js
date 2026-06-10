/**
 * M19 §0 — shared object registry: one inventory of every user-placed map
 * object (masts/repeaters, demand markers, waypoints, the drone), driving the
 * right object panel, the per-object context menu and drag-to-move.
 *
 * Pure + DOM-free (unit-testable); the only DOM touch is the default emitter,
 * which dispatches `objects:changed` CustomEvents on `document` when one
 * exists. Domain state stays in the owning modules — the registry is inventory
 * + event bus only. Two mutation surfaces keep that boundary clean:
 *
 *   UI-driven   move/rename/remove/update — call the entry's `apply` callbacks
 *               so the owning module updates its own model + marker, then emit.
 *   Domain sync sync/unregister — the owning module already changed (e.g. its
 *               own drag handler ran); just mirror the inventory, then emit.
 *
 * Entry shape:
 *   { id, kind, name, lngLat: [lng, lat], settings: {…}, locked: false,
 *     owner, marker, apply: { move?, rename?, remove?, settings? } }
 *
 * kind: 'tx' | 'mast' | 'repeater' | 'marker' | 'waypoint' | 'drone'
 * owner: free-form module tag ('mission' | 'recommend' | 'drone' | 'waypoints')
 *        — main.js routes recompute per owner (recommend self-recomputes).
 */

export const KINDS = ['tx', 'mast', 'repeater', 'marker', 'waypoint', 'drone'];

export const KIND_LABEL = {
  tx: 'Transmitter',
  mast: 'Mast',
  repeater: 'Repeater',
  marker: 'Marker',
  waypoint: 'Waypoint',
  drone: 'Drone',
};

/** Kinds whose move/settings changes affect the RF picture (recompute). */
export const RF_KINDS = ['tx', 'mast', 'repeater', 'drone'];

// Default-name sequencing: masts/repeaters letter, the rest numbered.
const NAME_STYLE = { mast: 'letters', repeater: 'letters' };

/** 0 → A, 25 → Z, 26 → AA … (spreadsheet column style). */
function letterSeq(n) {
  let s = '';
  n += 1;
  while (n > 0) {
    n -= 1;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

const defaultEmit =
  typeof document !== 'undefined'
    ? (detail) => document.dispatchEvent(new CustomEvent('objects:changed', { detail }))
    : () => {};

export function createObjectRegistry({ emit = defaultEmit } = {}) {
  const entries = new Map(); // id -> entry
  const nameSeq = {}; // kind -> count of generated names

  const fire = (type, id) => emit({ type, id });

  function defaultName(kind) {
    const n = nameSeq[kind] ?? 0;
    nameSeq[kind] = n + 1;
    const label = KIND_LABEL[kind] || kind;
    return NAME_STYLE[kind] === 'letters' ? `${label} ${letterSeq(n)}` : `${label} ${n + 1}`;
  }

  /** Upsert an entry (modules re-register on their refresh() rebuilds). */
  function register(e) {
    if (!KINDS.includes(e.kind)) throw new Error(`Unknown object kind: ${e.kind}`);
    const prev = entries.get(e.id);
    // `name: undefined` must not clobber a kept name on upsert.
    const clean = Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined));
    const entry = {
      settings: {},
      locked: false,
      owner: '',
      marker: null,
      apply: {},
      ...prev,
      ...clean,
    };
    if (!entry.name) {
      entry.name = defaultName(entry.kind);
      // Push the generated default back into the domain model so it shows up
      // in exports (KML/GeoJSON round-trip keeps the name).
      entry.apply.rename?.(entry.name);
    }
    entries.set(entry.id, entry);
    fire(prev ? 'update' : 'add', entry.id);
    return entry;
  }

  /** Domain-driven removal (module cleared its own object). */
  function unregister(id) {
    if (entries.delete(id)) fire('remove', id);
  }

  /** Domain-driven patch — mirror only, never calls apply (no callback loop). */
  function sync(id, patch) {
    const e = entries.get(id);
    if (!e) return;
    if (patch.settings) e.settings = { ...e.settings, ...patch.settings };
    const { settings, ...rest } = patch;
    Object.assign(e, rest);
    const type = patch.lngLat ? 'move'
      : patch.name != null ? 'rename'
      : settings ? 'settings'
      : 'update';
    fire(type, id);
  }

  // ── UI-driven mutations (context menu, drag drop, object list) ──────────
  function move(id, lngLat) {
    const e = entries.get(id);
    if (!e || e.locked) return false;
    e.apply.move?.(lngLat);
    e.lngLat = lngLat;
    fire('move', id);
    return true;
  }

  function rename(id, name) {
    const e = entries.get(id);
    if (!e) return false;
    const v = String(name ?? '').trim();
    if (!v) return false;
    e.apply.rename?.(v);
    e.name = v;
    fire('rename', id);
    return true;
  }

  function remove(id) {
    const e = entries.get(id);
    if (!e) return false;
    entries.delete(id); // drop first — apply.remove may trigger a re-refresh
    e.apply.remove?.();
    entries.delete(id); // a refresh() during apply.remove must not resurrect it
    fire('remove', id);
    return true;
  }

  /** UI-driven settings/property patch (e.g. drone altitude). */
  function update(id, patch) {
    const e = entries.get(id);
    if (!e) return false;
    if (patch.settings) {
      e.settings = { ...e.settings, ...patch.settings };
      e.apply.settings?.(e.settings);
    }
    const { settings, ...rest } = patch;
    Object.assign(e, rest);
    fire('settings', id);
    return true;
  }

  function setLocked(id, locked) {
    const e = entries.get(id);
    if (!e) return;
    e.locked = Boolean(locked);
    e.marker?.setDraggable?.(!e.locked);
    fire('update', id);
  }

  return {
    register,
    unregister,
    sync,
    move,
    rename,
    remove,
    update,
    setLocked,
    defaultName,
    get: (id) => entries.get(id),
    all: () => [...entries.values()],
    byKind: (kind) => [...entries.values()].filter((e) => e.kind === kind),
    /** Find the entry owning a marker DOM element (context-menu hit test). */
    byElement(el) {
      for (const e of entries.values()) {
        const node = e.marker?.getElement?.();
        if (node && (node === el || node.contains(el))) return e;
      }
      return undefined;
    },
  };
}
