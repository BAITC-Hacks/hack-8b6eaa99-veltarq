// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Map as MapGL } from '@2gis/mapgl/types';
import { SCORE_STALE_MS, SCORE_WAIT_MS, useTraffic } from './useTraffic';

type ScoreListener = (event: { score?: unknown }) => void;

class TrafficMap {
  listeners = new Set<ScoreListener>();
  showTraffic = vi.fn();
  hideTraffic = vi.fn();
  on = vi.fn((_event: string, listener: ScoreListener) => this.listeners.add(listener));
  off = vi.fn((_event: string, listener: ScoreListener) => this.listeners.delete(listener));

  emit(event: { score?: unknown }) {
    for (const listener of this.listeners) listener(event);
  }

  asMap() {
    return this as unknown as MapGL;
  }
}

describe('useTraffic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-23T10:00:00Z'));
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('starts loading, enables traffic, and records the local receipt time of a valid score', () => {
    const map = new TrafficMap();
    const { result } = renderHook(() => useTraffic(map.asMap(), true, false, 0));

    expect(result.current).toEqual({ status: 'loading' });
    expect(map.showTraffic).toHaveBeenCalledOnce();
    expect(map.listeners.size).toBe(1);

    act(() => map.emit({ score: 7 }));

    expect(result.current).toEqual({ status: 'ready', score: 7, receivedAt: Date.now() });
    // The initial wait timeout cannot overwrite a score already received.
    act(() => vi.advanceTimersByTime(SCORE_WAIT_MS));
    expect(result.current.status).toBe('ready');
  });

  it.each([
    ['missing', {}],
    ['undefined', { score: undefined }],
    ['null', { score: null }],
    ['zero sentinel', { score: 0 }],
    ['negative', { score: -1 }],
    ['NaN', { score: Number.NaN }],
    ['infinity', { score: Number.POSITIVE_INFINITY }],
    ['fraction', { score: 2.5 }],
    ['out of range', { score: 11 }],
    ['string', { score: '5' }],
  ] as const)('treats a %s score as unavailable without retaining a previous score', (_label, event) => {
    const map = new TrafficMap();
    const { result } = renderHook(() => useTraffic(map.asMap(), true, false, 0));
    act(() => map.emit({ score: 5 }));

    act(() => map.emit(event));

    expect(result.current).toEqual({ status: 'unavailable' });
    expect(result.current).not.toHaveProperty('score');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([1, 10])('accepts valid boundary score %s', (score) => {
    const map = new TrafficMap();
    const { result } = renderHook(() => useTraffic(map.asMap(), true, false, 0));
    act(() => map.emit({ score }));
    expect(result.current).toEqual({ status: 'ready', score, receivedAt: Date.now() });
  });

  it('reports no score after the wait timeout and recovers when a later score arrives', () => {
    const map = new TrafficMap();
    const { result } = renderHook(() => useTraffic(map.asMap(), true, false, 0));

    act(() => vi.advanceTimersByTime(SCORE_WAIT_MS - 1));
    expect(result.current.status).toBe('loading');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toEqual({ status: 'unavailable' });

    act(() => map.emit({ score: 4 }));
    expect(result.current).toEqual({ status: 'ready', score: 4, receivedAt: Date.now() });
  });

  it('hides traffic when disabled or in After mode and requires a fresh event after enabling', () => {
    const map = new TrafficMap();
    const { result, rerender } = renderHook(
      ({ trafficEnabled, after }) => useTraffic(map.asMap(), trafficEnabled && !after, false, 0),
      { initialProps: { trafficEnabled: true, after: false } },
    );
    const oldListener = [...map.listeners][0]!;
    act(() => map.emit({ score: 8 }));

    rerender({ trafficEnabled: false, after: false });
    expect(result.current).toEqual({ status: 'off' });
    expect(map.hideTraffic).toHaveBeenCalledOnce();
    expect(map.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    act(() => oldListener({ score: 8 }));
    expect(result.current).toEqual({ status: 'off' });
    rerender({ trafficEnabled: true, after: false });
    expect(result.current).toEqual({ status: 'loading' });
    expect(map.showTraffic).toHaveBeenCalledTimes(2);
    act(() => oldListener({ score: 8 }));
    expect(result.current).toEqual({ status: 'loading' });
    act(() => map.emit({ score: 3 }));
    expect(result.current).toMatchObject({ status: 'ready', score: 3 });

    rerender({ trafficEnabled: true, after: true });
    expect(result.current).toEqual({ status: 'off' });
    expect(map.hideTraffic).toHaveBeenCalledTimes(2);
    rerender({ trafficEnabled: true, after: false });
    expect(result.current).toEqual({ status: 'loading' });
    expect(map.showTraffic).toHaveBeenCalledTimes(3);
  });

  it('reports offline errors, ignores offline scores, and refreshes traffic on reconnection', () => {
    const online = vi.spyOn(navigator, 'onLine', 'get');
    const map = new TrafficMap();
    const { result } = renderHook(() => useTraffic(map.asMap(), true, false, 0));
    act(() => map.emit({ score: 6 }));

    online.mockReturnValue(false);
    act(() => window.dispatchEvent(new Event('offline')));
    expect(result.current).toMatchObject({ status: 'error' });
    expect(result.current).not.toHaveProperty('score');
    expect(vi.getTimerCount()).toBe(0);
    act(() => map.emit({ score: 2 }));
    expect(result.current.status).toBe('error');

    online.mockReturnValue(true);
    act(() => window.dispatchEvent(new Event('online')));
    expect(result.current).toEqual({ status: 'loading' });
    expect(map.hideTraffic).toHaveBeenCalledOnce();
    expect(map.showTraffic).toHaveBeenCalledTimes(2);
    act(() => map.emit({ score: 2 }));
    expect(result.current).toMatchObject({ status: 'ready', score: 2 });
  });

  it('reports an error immediately when mounted offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const map = new TrafficMap();
    const { result } = renderHook(() => useTraffic(map.asMap(), true, false, 0));

    expect(result.current).toMatchObject({ status: 'error' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('expires a score after five minutes and restarts freshness on each new score', () => {
    const map = new TrafficMap();
    const { result } = renderHook(() => useTraffic(map.asMap(), true, false, 0));
    act(() => map.emit({ score: 9 }));
    act(() => vi.advanceTimersByTime(SCORE_STALE_MS - 1));
    expect(result.current.status).toBe('ready');

    act(() => map.emit({ score: 4 }));
    const receivedAt = Date.now();
    act(() => vi.advanceTimersByTime(SCORE_STALE_MS - 1));
    expect(result.current).toEqual({ status: 'ready', score: 4, receivedAt });
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toEqual({ status: 'stale' });
    expect(result.current).not.toHaveProperty('score');

    act(() => map.emit({ score: 5 }));
    expect(result.current).toMatchObject({ status: 'ready', score: 5 });
  });

  it('waits for the map and exposes map failures without retaining a traffic score', () => {
    const map = new TrafficMap();
    const { result, rerender } = renderHook(
      ({ currentMap, failed }: { currentMap: MapGL | null; failed: boolean }) =>
        useTraffic(currentMap, true, failed, 0),
      { initialProps: { currentMap: null as MapGL | null, failed: false } },
    );
    expect(result.current).toEqual({ status: 'loading' });

    rerender({ currentMap: null, failed: true });
    expect(result.current).toMatchObject({ status: 'error' });
    rerender({ currentMap: map.asMap(), failed: false });
    act(() => map.emit({ score: 7 }));
    rerender({ currentMap: map.asMap(), failed: true });
    expect(result.current).toMatchObject({ status: 'error' });
    expect(result.current).not.toHaveProperty('score');
    expect(map.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refreshes the layer on retry and waits for a new score', () => {
    const map = new TrafficMap();
    const { result, rerender } = renderHook(
      ({ retry }) => useTraffic(map.asMap(), true, false, retry),
      { initialProps: { retry: 0 } },
    );
    act(() => map.emit({ score: 6 }));

    rerender({ retry: 1 });

    expect(result.current).toEqual({ status: 'loading' });
    expect(map.hideTraffic).toHaveBeenCalledOnce();
    expect(map.showTraffic).toHaveBeenCalledTimes(2);
    expect(map.listeners.size).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('removes map/window listeners and pending timers when unmounted', () => {
    const addListener = vi.spyOn(window, 'addEventListener');
    const removeListener = vi.spyOn(window, 'removeEventListener');
    const map = new TrafficMap();
    const { unmount } = renderHook(() => useTraffic(map.asMap(), true, false, 0));
    const scoreListener = [...map.listeners][0]!;
    const offlineListener = addListener.mock.calls.find(([event]) => event === 'offline')![1];
    const onlineListener = addListener.mock.calls.find(([event]) => event === 'online')![1];
    act(() => map.emit({ score: 5 }));

    unmount();

    expect(map.off).toHaveBeenCalledWith('trafficscore', scoreListener);
    expect(map.listeners.size).toBe(0);
    expect(removeListener).toHaveBeenCalledWith('offline', offlineListener);
    expect(removeListener).toHaveBeenCalledWith('online', onlineListener);
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      scoreListener({ score: 7 });
      window.dispatchEvent(new Event('online'));
    });
    expect(map.showTraffic).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
