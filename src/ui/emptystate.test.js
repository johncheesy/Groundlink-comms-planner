import { describe, it, expect } from 'vitest';
import { isEmptyMission } from './emptystate.js';

describe('isEmptyMission — truth table', () => {
  it('fresh session (no AOI, no objects, nothing imported) is empty', () => {
    expect(isEmptyMission({ aoiSet: false, objectCount: 0, importCount: 0 })).toBe(true);
  });
  it('defaults are empty (no state gathered yet)', () => {
    expect(isEmptyMission()).toBe(true);
    expect(isEmptyMission({})).toBe(true);
  });
  it('an AOI alone ends the empty state', () => {
    expect(isEmptyMission({ aoiSet: true, objectCount: 0, importCount: 0 })).toBe(false);
  });
  it('any placed object ends the empty state', () => {
    expect(isEmptyMission({ aoiSet: false, objectCount: 1, importCount: 0 })).toBe(false);
  });
  it('imported overlay data ends the empty state', () => {
    expect(isEmptyMission({ aoiSet: false, objectCount: 0, importCount: 3 })).toBe(false);
  });
  it('a stocked radio arsenal alone does NOT end the empty state (map is still blank)', () => {
    expect(isEmptyMission({ aoiSet: false, objectCount: 0, importCount: 0, arsenalCount: 4 })).toBe(true);
  });
});
