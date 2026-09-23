// @vitest-environment jsdom

import { StrictMode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanItem } from './modelData';
import { PLAN_STORAGE_KEY, useSavedPlan } from './useSavedPlan';

const partialPlan: PlanItem[] = [{ measureId: 'M7', districtId: 'Нура' }];

describe('useSavedPlan', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('loads a versioned plan without a first-render write, including in StrictMode', () => {
    const raw = JSON.stringify({ version: 1, plan: partialPlan });
    window.localStorage.setItem(PLAN_STORAGE_KEY, raw);
    const save = vi.spyOn(Storage.prototype, 'setItem');
    const { result, rerender } = renderHook(() => useSavedPlan(), { wrapper: StrictMode });

    expect(result.current.plan).toEqual(partialPlan);
    expect(result.current.storageStatus).toBe('saved');
    expect(result.current.storageMessage).toBeNull();
    rerender();
    expect(save).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(PLAN_STORAGE_KEY)).toBe(raw);
  });

  it('saves only the version and plan, and reloads an incomplete plan after unmount', () => {
    const { result, unmount } = renderHook(() => useSavedPlan());
    expect(result.current.plan).toEqual([]);
    act(() => result.current.setPlan(partialPlan));

    expect(result.current.storageStatus).toBe('saved');
    expect(JSON.parse(window.localStorage.getItem(PLAN_STORAGE_KEY)!)).toEqual({ version: 1, plan: partialPlan });
    unmount();

    const reloaded = renderHook(() => useSavedPlan());
    expect(reloaded.result.current.plan).toEqual(partialPlan);
  });

  it('supports functional updates, removal and clearing the plan', () => {
    const { result } = renderHook(() => useSavedPlan());
    act(() => {
      result.current.setPlan((previous) => [...previous, { measureId: 'M7', districtId: 'Нура' }]);
      result.current.setPlan((previous) => [...previous, { measureId: 'M12', districtId: null }]);
    });
    expect(result.current.plan).toHaveLength(2);

    act(() => result.current.setPlan((previous) => previous.filter((item) => item.measureId !== 'M7')));
    expect(JSON.parse(window.localStorage.getItem(PLAN_STORAGE_KEY)!).plan).toEqual([{ measureId: 'M12', districtId: null }]);
    act(() => result.current.setPlan([]));
    expect(JSON.parse(window.localStorage.getItem(PLAN_STORAGE_KEY)!).plan).toEqual([]);
  });

  it.each([
    ['invalid JSON', '{broken'],
    ['wrong version', JSON.stringify({ version: 2, plan: partialPlan })],
    ['missing version', JSON.stringify({ plan: partialPlan })],
    ['missing plan', JSON.stringify({ version: 1 })],
    ['null payload', 'null'],
    ['unknown measure', JSON.stringify({ version: 1, plan: [{ measureId: 'M99', districtId: null }] })],
    ['unknown district', JSON.stringify({ version: 1, plan: [{ measureId: 'M7', districtId: 'Unknown' }] })],
    ['wrong target type', JSON.stringify({ version: 1, plan: [{ measureId: 'M7', districtId: 4 }] })],
    ['omitted target', JSON.stringify({ version: 1, plan: [{ measureId: 'M7' }] })],
    ['null entry', JSON.stringify({ version: 1, plan: [null] })],
  ])('preserves %s data until an explicit user edit', (_label, raw) => {
    window.localStorage.setItem(PLAN_STORAGE_KEY, raw);
    const save = vi.spyOn(Storage.prototype, 'setItem');
    const { result, rerender } = renderHook(() => useSavedPlan(), { wrapper: StrictMode });

    expect(result.current.plan).toEqual([]);
    expect(result.current.storageStatus).toBe('invalid-data');
    expect(result.current.storageMessage).toBeTruthy();
    rerender();
    expect(save).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(PLAN_STORAGE_KEY)).toBe(raw);

    act(() => result.current.setPlan(partialPlan));
    expect(result.current.storageStatus).toBe('saved');
    expect(result.current.storageMessage).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(PLAN_STORAGE_KEY)!).plan).toEqual(partialPlan);
  });

  it('retains business-rule errors so the UI can show them and the user can repair them', () => {
    // Duplicates, six measures, excessive cost/direction count, incompatible measures,
    // absent district targets and a city measure with a district are not schema errors.
    const invalidPlan: PlanItem[] = [
      { measureId: 'M1', districtId: null },
      { measureId: 'M1', districtId: 'Нура' },
      { measureId: 'M2', districtId: 'Есиль' },
      { measureId: 'M3', districtId: 'Нура' },
      { measureId: 'M7', districtId: 'Нура' },
      { measureId: 'M4', districtId: 'Нура' },
    ];
    window.localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify({ version: 1, plan: invalidPlan }));
    const { result, unmount } = renderHook(() => useSavedPlan());
    expect(result.current.plan).toEqual(invalidPlan);
    expect(result.current.storageStatus).toBe('saved');
    act(() => result.current.setPlan((previous) => [...previous]));
    unmount();
    expect(renderHook(() => useSavedPlan()).result.current.plan).toEqual(invalidPlan);
  });

  it('keeps calculation input usable when the localStorage getter is blocked', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
    const { result } = renderHook(() => useSavedPlan());
    expect(result.current.storageStatus).toBe('unavailable');
    expect(result.current.storageMessage).toBeTruthy();
    act(() => result.current.setPlan(partialPlan));
    expect(result.current.plan).toEqual(partialPlan);
    expect(result.current.storageStatus).toBe('unavailable');
  });

  it('handles read errors without attempting to overwrite the stored plan on mount', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Read failed'); });
    const save = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = renderHook(() => useSavedPlan());
    expect(result.current.storageStatus).toBe('unavailable');
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps the edited plan on quota errors and recovers on a subsequent edit', () => {
    const save = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    const { result } = renderHook(() => useSavedPlan());
    act(() => result.current.setPlan(partialPlan));
    expect(result.current.plan).toEqual(partialPlan);
    expect(result.current.storageStatus).toBe('unavailable');
    expect(result.current.storageMessage).toBeTruthy();

    save.mockRestore();
    act(() => result.current.setPlan((previous) => [...previous]));
    expect(result.current.storageStatus).toBe('saved');
    expect(result.current.storageMessage).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(PLAN_STORAGE_KEY)!).plan).toEqual(partialPlan);
  });
});
