import { describe, it, expect, vi } from 'vitest';
import { createObjectRegistry, KIND_LABEL, RF_KINDS } from './objects.js';

// All coordinates in these tests are synthetic (0–2° off Null Island) — OPSEC.
const LL = [0.5, 0.5];

function reg() {
  const events = [];
  const registry = createObjectRegistry({ emit: (detail) => events.push(detail) });
  return { registry, events };
}

describe('object registry — add / get', () => {
  it('registers an entry and returns it from all() and get()', () => {
    const { registry } = reg();
    registry.register({ id: 'm1', kind: 'mast', name: 'North mast', lngLat: LL });
    expect(registry.get('m1')).toMatchObject({ id: 'm1', kind: 'mast', name: 'North mast' });
    expect(registry.all()).toHaveLength(1);
  });

  it('rejects unknown kinds', () => {
    const { registry } = reg();
    expect(() => registry.register({ id: 'x', kind: 'spaceship', lngLat: LL })).toThrow(/kind/);
  });

  it('upserts on re-register with the same id (refresh() rebuild pattern)', () => {
    const { registry } = reg();
    registry.register({ id: 'm1', kind: 'mast', name: 'A', lngLat: LL });
    registry.register({ id: 'm1', kind: 'mast', name: 'A', lngLat: [1, 1] });
    expect(registry.all()).toHaveLength(1);
    expect(registry.get('m1').lngLat).toEqual([1, 1]);
  });

  it('emits an add event with {type, id}', () => {
    const { registry, events } = reg();
    registry.register({ id: 'm1', kind: 'mast', lngLat: LL });
    expect(events).toContainEqual(expect.objectContaining({ type: 'add', id: 'm1' }));
  });

  it('byKind() filters', () => {
    const { registry } = reg();
    registry.register({ id: 'm1', kind: 'mast', lngLat: LL });
    registry.register({ id: 'w1', kind: 'waypoint', lngLat: LL });
    expect(registry.byKind('mast')).toHaveLength(1);
    expect(registry.byKind('waypoint')[0].id).toBe('w1');
  });
});

describe('object registry — default names', () => {
  it('sequences masts as letters: Mast A, Mast B, …', () => {
    const { registry } = reg();
    registry.register({ id: 'm1', kind: 'mast', lngLat: LL });
    registry.register({ id: 'm2', kind: 'mast', lngLat: LL });
    expect(registry.get('m1').name).toBe('Mast A');
    expect(registry.get('m2').name).toBe('Mast B');
  });

  it('continues past Z (…, Mast Z, Mast AA)', () => {
    const { registry } = reg();
    for (let i = 0; i < 27; i++) registry.register({ id: `m${i}`, kind: 'mast', lngLat: LL });
    expect(registry.get('m25').name).toBe('Mast Z');
    expect(registry.get('m26').name).toBe('Mast AA');
  });

  it('sequences markers and drones numerically: Marker 1, Drone 1', () => {
    const { registry } = reg();
    registry.register({ id: 'p1', kind: 'marker', lngLat: LL });
    registry.register({ id: 'p2', kind: 'marker', lngLat: LL });
    registry.register({ id: 'd1', kind: 'drone', lngLat: LL });
    expect(registry.get('p1').name).toBe('Marker 1');
    expect(registry.get('p2').name).toBe('Marker 2');
    expect(registry.get('d1').name).toBe('Drone 1');
  });

  it('keeps an explicit name and pushes a generated one back via apply.rename', () => {
    const { registry } = reg();
    const rename = vi.fn();
    registry.register({ id: 'a', kind: 'mast', name: 'Hilltop', lngLat: LL });
    registry.register({ id: 'b', kind: 'mast', lngLat: LL, apply: { rename } });
    expect(registry.get('a').name).toBe('Hilltop');
    // Generated default is synced into the owning domain model (export round-trip).
    expect(rename).toHaveBeenCalledWith('Mast A');
  });

  it('does not re-assign a default on upsert re-register', () => {
    const { registry } = reg();
    registry.register({ id: 'a', kind: 'mast', lngLat: LL });
    const first = registry.get('a').name;
    registry.register({ id: 'a', kind: 'mast', name: first, lngLat: LL });
    expect(registry.get('a').name).toBe(first); // still Mast A, not Mast B
  });
});

describe('object registry — UI-driven move / rename / remove', () => {
  it('move() updates lngLat, calls apply.move and emits a move event', () => {
    const { registry, events } = reg();
    const move = vi.fn();
    registry.register({ id: 'm1', kind: 'mast', lngLat: LL, apply: { move } });
    const ok = registry.move('m1', [1.25, 1.5]);
    expect(ok).toBe(true);
    expect(move).toHaveBeenCalledWith([1.25, 1.5]);
    expect(registry.get('m1').lngLat).toEqual([1.25, 1.5]);
    expect(events).toContainEqual(expect.objectContaining({ type: 'move', id: 'm1' }));
  });

  it('move() on a locked object is rejected (no apply call, no event)', () => {
    const { registry, events } = reg();
    const move = vi.fn();
    registry.register({ id: 'm1', kind: 'mast', lngLat: LL, locked: true, apply: { move } });
    const before = events.length;
    expect(registry.move('m1', [1, 1])).toBe(false);
    expect(move).not.toHaveBeenCalled();
    expect(registry.get('m1').lngLat).toEqual(LL);
    expect(events.length).toBe(before);
  });

  it('setLocked(false) unlocks and allows the move', () => {
    const { registry } = reg();
    registry.register({ id: 'm1', kind: 'mast', lngLat: LL, locked: true });
    registry.setLocked('m1', false);
    expect(registry.move('m1', [1, 1])).toBe(true);
  });

  it('rename() trims, calls apply.rename and emits', () => {
    const { registry, events } = reg();
    const rename = vi.fn();
    registry.register({ id: 'm1', kind: 'mast', name: 'X', lngLat: LL, apply: { rename } });
    registry.rename('m1', '  Ridge repeater  ');
    expect(registry.get('m1').name).toBe('Ridge repeater');
    expect(rename).toHaveBeenCalledWith('Ridge repeater');
    expect(events).toContainEqual(expect.objectContaining({ type: 'rename', id: 'm1' }));
  });

  it('remove() calls apply.remove, drops the entry and emits', () => {
    const { registry, events } = reg();
    const remove = vi.fn();
    registry.register({ id: 'm1', kind: 'mast', lngLat: LL, apply: { remove } });
    registry.remove('m1');
    expect(remove).toHaveBeenCalled();
    expect(registry.get('m1')).toBeUndefined();
    expect(events).toContainEqual(expect.objectContaining({ type: 'remove', id: 'm1' }));
  });

  it('update() patches settings and emits a settings event', () => {
    const { registry, events } = reg();
    registry.register({ id: 'd1', kind: 'drone', lngLat: LL, settings: { altM: 120 } });
    registry.update('d1', { settings: { altM: 80 } });
    expect(registry.get('d1').settings.altM).toBe(80);
    expect(events).toContainEqual(expect.objectContaining({ type: 'settings', id: 'd1' }));
  });
});

describe('object registry — domain-driven sync', () => {
  it('sync() updates inventory without calling apply callbacks', () => {
    const { registry, events } = reg();
    const move = vi.fn();
    registry.register({ id: 'm1', kind: 'mast', lngLat: LL, apply: { move } });
    registry.sync('m1', { lngLat: [1, 1] });
    expect(move).not.toHaveBeenCalled();
    expect(registry.get('m1').lngLat).toEqual([1, 1]);
    expect(events).toContainEqual(expect.objectContaining({ type: 'move', id: 'm1' }));
  });

  it('unregister() drops the entry without calling apply.remove', () => {
    const { registry } = reg();
    const remove = vi.fn();
    registry.register({ id: 'm1', kind: 'mast', lngLat: LL, apply: { remove } });
    registry.unregister('m1');
    expect(remove).not.toHaveBeenCalled();
    expect(registry.get('m1')).toBeUndefined();
  });
});

describe('object registry — constants', () => {
  it('exposes a label for every kind and the RF-relevant set', () => {
    for (const k of ['tx', 'mast', 'repeater', 'marker', 'waypoint', 'drone']) {
      expect(KIND_LABEL[k]).toBeTruthy();
    }
    expect(RF_KINDS).toContain('mast');
    expect(RF_KINDS).toContain('drone');
    expect(RF_KINDS).not.toContain('waypoint');
    expect(RF_KINDS).not.toContain('marker');
  });
});
