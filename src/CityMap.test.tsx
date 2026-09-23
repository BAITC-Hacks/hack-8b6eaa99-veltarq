// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CityMap from './CityMap';
import type { PlanItem } from './modelData';

const sdk = vi.hoisted(() => ({
  load: vi.fn(),
  districts: vi.fn(),
  scenarios: vi.fn(),
}));

vi.mock('@2gis/mapgl', () => ({ load: sdk.load }));
vi.mock('./mapOverlays', () => ({
  createDistrictOverlays: sdk.districts,
  createScenarioOverlays: sdk.scenarios,
}));

type MapEvent = { type?: string; score?: number; responseStatus?: number };
type MapListener = (event: MapEvent) => void;
const lifecycle: string[] = [];

class FakeMap {
  static instances: FakeMap[] = [];
  readonly id = FakeMap.instances.length;
  readonly listeners = new Map<string, Set<MapListener>>();
  readonly on = vi.fn((event: string, listener: MapListener) => {
    const listeners = this.listeners.get(event) ?? new Set<MapListener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  });
  readonly off = vi.fn((event: string, listener: MapListener) => {
    this.listeners.get(event)?.delete(listener);
  });
  readonly fitBounds = vi.fn();
  readonly getZoom = vi.fn(() => 11);
  readonly setZoom = vi.fn();
  readonly setCenter = vi.fn();
  readonly setControlsLayoutPadding = vi.fn();
  readonly showTraffic = vi.fn();
  readonly hideTraffic = vi.fn();
  readonly destroy = vi.fn(() => lifecycle.push(`map:${this.id}`));

  constructor(readonly container: HTMLElement, readonly options: Record<string, unknown>) {
    FakeMap.instances.push(this);
  }

  emit(event: string, payload: MapEvent = {}) {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }

  listenerCount() {
    return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0);
  }
}

class FakeHtmlMarker {
  static instances: FakeHtmlMarker[] = [];
  readonly destroy = vi.fn(() => this.options.html.remove());

  constructor(readonly map: FakeMap, readonly options: { html: HTMLElement; coordinates: number[] }) {
    FakeHtmlMarker.instances.push(this);
    map.container.append(options.html);
  }
}

const api = { Map: FakeMap, HtmlMarker: FakeHtmlMarker, isSupported: vi.fn(() => true) };
const cityBounds = { southWest: [71.27, 51.065], northEast: [71.56, 51.22] };

function overlayGroup(kind: string, map: FakeMap) {
  let disposed = false;
  return {
    destroy: vi.fn(() => {
      // Real overlay groups are idempotent, including during React effect cleanup.
      if (disposed) return;
      disposed = true;
      lifecycle.push(`${kind}:${map.id}`);
    }),
  };
}

function mount(props: Partial<ComponentProps<typeof CityMap>> = {}) {
  const baseProps: ComponentProps<typeof CityMap> = {
    mode: 'before', selectedId: null, onSelect: vi.fn(), resetVersion: 0, ...props,
  };
  return { ...render(<CityMap {...baseProps} />), props: baseProps };
}

async function finishSdkLoad() {
  await act(async () => { await Promise.resolve(); });
  return FakeMap.instances.at(-1)!;
}

function ready(map: FakeMap) {
  act(() => {
    map.emit('styleload');
    map.emit('idle');
  });
}

describe('CityMap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubEnv('VITE_2GIS_KEY', 'test-browser-key');
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    FakeMap.instances = [];
    FakeHtmlMarker.instances = [];
    lifecycle.length = 0;
    api.isSupported.mockReturnValue(true);
    sdk.load.mockImplementation(() => Promise.resolve(api));
    sdk.districts.mockImplementation((_api: unknown, map: FakeMap) => overlayGroup('districts', map));
    sdk.scenarios.mockImplementation((_api: unknown, map: FakeMap) => overlayGroup('scenarios', map));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shows the missing-key instruction without requesting the SDK', () => {
    vi.stubEnv('VITE_2GIS_KEY', '   ');
    mount();

    expect(screen.getByRole('alert').textContent).toContain('Ключ 2ГИС не настроен');
    expect(screen.getByRole('alert').textContent).toContain('VITE_2GIS_KEY');
    expect(sdk.load).not.toHaveBeenCalled();
    expect(FakeMap.instances).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows a retryable map error if loading the SDK fails', async () => {
    sdk.load.mockRejectedValueOnce(new Error('network failure'));
    mount();
    await finishSdkLoad();

    expect(screen.getByRole('alert').textContent).toContain('Не удалось загрузить карту 2ГИС');
    expect(screen.getByRole('button', { name: 'Повторить загрузку' })).toBeTruthy();
    expect(FakeMap.instances).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('handles an invalid tile key and cleans up old overlays/listeners before retrying', async () => {
    mount({ mode: 'after' });
    const map = await finishSdkLoad();
    ready(map);
    expect(sdk.districts).toHaveBeenCalledOnce();
    expect(sdk.scenarios).toHaveBeenCalledOnce();

    act(() => map.emit('error', { type: 'invalidtilekey' }));
    expect(screen.getByRole('alert').textContent).toContain('2ГИС отклонил ключ');
    expect(lifecycle).toContain('districts:0');
    expect(lifecycle).toContain('scenarios:0');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }));
    const replacement = await finishSdkLoad();

    expect(sdk.load).toHaveBeenCalledTimes(2);
    expect(map.destroy).toHaveBeenCalledOnce();
    expect(map.listenerCount()).toBe(0);
    expect(lifecycle.indexOf('districts:0')).toBeLessThan(lifecycle.indexOf('map:0'));
    expect(lifecycle.indexOf('scenarios:0')).toBeLessThan(lifecycle.indexOf('map:0'));
    expect(replacement).not.toBe(map);
    ready(replacement);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(sdk.districts).toHaveBeenCalledTimes(2);
    expect(sdk.scenarios).toHaveBeenCalledTimes(2);
  });

  it.each(['before', 'after'] as const)('keeps controls and overlays usable after a tile 503 in %s', async (mode) => {
    const onSelect = vi.fn();
    mount({ mode, onSelect });
    const map = await finishSdkLoad();
    ready(map);
    const districts = sdk.districts.mock.results[0].value;
    const scenarios = sdk.scenarios.mock.results[0]?.value;

    act(() => map.emit('error', { type: 'rasterTileLoadError', responseStatus: 503 }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Повторить загрузку' })).toBeNull();
    expect(districts.destroy).not.toHaveBeenCalled();
    if (scenarios) expect(scenarios.destroy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Приблизить' }));
    expect(map.setZoom).toHaveBeenCalledWith(12);
    act(() => sdk.districts.mock.calls[0][3]('Есиль'));
    expect(onSelect).toHaveBeenCalledWith('Есиль');

    act(() => map.emit('idle'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(sdk.districts).toHaveBeenCalledOnce();
    if (mode === 'after') expect(sdk.scenarios).toHaveBeenCalledOnce();
    else {
      act(() => map.emit('trafficscore', { score: 4 }));
      expect(screen.queryByText(/оценка 2ГИС/)).toBeNull();
      expect(map.hideTraffic).not.toHaveBeenCalled();
    }
    expect(FakeMap.instances).toHaveLength(1);
    expect(map.destroy).not.toHaveBeenCalled();
  });

  it('finishes loading after a tile 503 without requiring a manual retry', async () => {
    mount();
    const map = await finishSdkLoad();
    act(() => map.emit('error', { type: 'rasterTileLoadError', responseStatus: 503 }));
    expect(screen.queryByRole('alert')).toBeNull();

    ready(map);

    expect(screen.queryByText('Загружаем карту 2ГИС…')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(sdk.districts).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Отдалить' }));
    expect(map.setZoom).toHaveBeenCalledWith(10);
    expect(sdk.load).toHaveBeenCalledOnce();
  });

  it.each([
    ['error', 'invalidtilekey', '2ГИС отклонил ключ'],
    ['error', 'webglcontextlost', 'Соединение с графическим модулем потеряно'],
    ['error', 'styleloaderror', 'Не удалось загрузить карту 2ГИС'],
    ['styleloaderror', 'styleloaderror', 'Не удалось загрузить карту 2ГИС'],
  ])('retains a fatal %s/%s error after a later idle', async (event, type, message) => {
    mount();
    const map = await finishSdkLoad();
    ready(map);
    act(() => map.emit(event, { type }));
    act(() => map.emit('idle'));

    expect(screen.getByRole('alert').textContent).toContain(message);
    expect((screen.getByRole('button', { name: 'Приблизить' }) as HTMLButtonElement).disabled).toBe(true);
    expect(sdk.districts.mock.results[0].value.destroy).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Повторить загрузку' })).toBeTruthy();
  });

  it('does not create a map if the component unmounts before the SDK resolves', async () => {
    let resolve!: (value: typeof api) => void;
    sdk.load.mockImplementationOnce(() => new Promise<typeof api>((done) => { resolve = done; }));
    const { unmount } = mount();
    unmount();
    await act(async () => { resolve(api); await Promise.resolve(); });

    expect(FakeMap.instances).toHaveLength(0);
    expect(sdk.districts).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fits an already selected district only after the style and first idle are ready', async () => {
    mount({ selectedId: 'Есиль' });
    const map = await finishSdkLoad();
    expect(map.options).toMatchObject({ key: 'test-browser-key', trafficOn: true });
    expect(map.fitBounds).toHaveBeenCalledOnce();
    expect((screen.getByRole('button', { name: 'Приблизить' }) as HTMLButtonElement).disabled).toBe(true);

    act(() => map.emit('idle'));
    expect(map.fitBounds).toHaveBeenCalledOnce();
    expect(sdk.districts).not.toHaveBeenCalled();
    ready(map);

    expect(map.fitBounds).toHaveBeenLastCalledWith(
      { southWest: [71.368, 51.086], northEast: [71.473, 51.169] },
      expect.objectContaining({ maxZoom: 12.4, animation: { duration: 600 } }),
    );
    expect(sdk.districts).toHaveBeenCalledWith(api, map, 'Есиль', expect.any(Function));
    expect((screen.getByRole('button', { name: 'Приблизить' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('fits the whole city again when resetVersion changes with no selected district', async () => {
    const { rerender, props } = mount();
    const map = await finishSdkLoad();
    ready(map);
    map.fitBounds.mockClear();

    rerender(<CityMap {...props} resetVersion={1} />);

    expect(map.fitBounds).toHaveBeenCalledOnce();
    expect(map.fitBounds).toHaveBeenCalledWith(
      cityBounds, expect.objectContaining({ animation: { duration: 600 } }),
    );
    expect(FakeMap.instances).toHaveLength(1);
  });

  it('keeps attribution above the responsive district dock and releases its resize listener', async () => {
    const { container, rerender, props, unmount } = mount();
    container.classList.add('atlas-shell');
    container.style.setProperty('--dock-height', '144px');
    const map = await finishSdkLoad();
    expect(map.options.controlsLayoutPadding).toEqual({ bottom: 148, right: 8 });
    ready(map);
    expect(map.setControlsLayoutPadding).toHaveBeenLastCalledWith({ bottom: 148, right: 8 });

    container.style.setProperty('--dock-height', '128px');
    fireEvent(window, new Event('resize'));
    expect(map.setControlsLayoutPadding).toHaveBeenLastCalledWith({ bottom: 132, right: 8 });

    container.style.setProperty('--dock-height', '0px');
    rerender(<CityMap {...props} districtsOpen={false} />);
    expect(map.setControlsLayoutPadding).toHaveBeenLastCalledWith({ bottom: 4, right: 8 });

    container.style.setProperty('--dock-height', '128px');
    rerender(<CityMap {...props} districtsOpen />);
    expect(map.setControlsLayoutPadding).toHaveBeenLastCalledWith({ bottom: 132, right: 8 });
    expect(FakeMap.instances).toHaveLength(1);

    unmount();
    map.setControlsLayoutPadding.mockClear();
    fireEvent(window, new Event('resize'));
    expect(map.setControlsLayoutPadding).not.toHaveBeenCalled();
  });

  it('keeps live traffic in Before without a score panel and hides it in After', async () => {
    const { rerender, props } = mount();
    const map = await finishSdkLoad();
    ready(map);
    act(() => map.emit('trafficscore', { score: 7 }));
    expect(screen.queryByText(/оценка 2ГИС/)).toBeNull();
    expect(screen.queryByRole('switch', { name: /Пробки/ })).toBeNull();
    expect(map.showTraffic).toHaveBeenCalledOnce();

    rerender(<CityMap {...props} mode="after" />);

    expect(map.hideTraffic).toHaveBeenCalledOnce();
    expect(map.listeners.get('trafficscore')?.size).toBe(0);
    expect(screen.queryByText(/оценка 2ГИС/)).toBeNull();
    expect(sdk.scenarios).toHaveBeenCalledOnce();

    rerender(<CityMap {...props} mode="before" />);
    expect(map.showTraffic).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Ожидаем оценку 2ГИС…')).toBeNull();
    expect(lifecycle).toContain('scenarios:0');
  });

  it('keeps roads visible without showing an unavailable-score panel', async () => {
    const { container } = mount();
    const map = await finishSdkLoad();
    ready(map);
    act(() => vi.advanceTimersByTime(15_000));
    expect(container.querySelector('.traffic-panel')).toBeNull();
    expect(screen.queryByText('Оценка загруженности недоступна')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(map.options.trafficOn).toBe(true);
    expect(map.showTraffic).toHaveBeenCalledOnce();
    expect(map.hideTraffic).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Приблизить' }));
    expect(map.setZoom).toHaveBeenCalledWith(12);
  });

  it.each([null, 'Сарыарка'] as const)('preserves the camera when switching both modes with selected district %s', async (selectedId) => {
    const plan: PlanItem[] = [{ measureId: 'M4', districtId: 'Сарыарка' }];
    const { rerender, props } = mount({ selectedId, plan });
    const map = await finishSdkLoad();
    ready(map);
    // Simulate a user-adjusted viewport before switching modes.
    map.setCenter([71.43, 51.16]);
    fireEvent.click(screen.getByRole('button', { name: 'Приблизить' }));
    map.fitBounds.mockClear();
    map.setCenter.mockClear();
    map.setZoom.mockClear();

    rerender(<CityMap {...props} mode="after" />);
    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.setCenter).not.toHaveBeenCalled();
    expect(map.setZoom).not.toHaveBeenCalled();
    expect(sdk.scenarios).toHaveBeenLastCalledWith(api, map, plan, expect.any(Function));

    rerender(<CityMap {...props} mode="before" />);
    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.setCenter).not.toHaveBeenCalled();
    expect(map.setZoom).not.toHaveBeenCalled();
    expect(FakeMap.instances).toHaveLength(1);
    expect(map.destroy).not.toHaveBeenCalled();
  });

  it('does not draw scenario objects in Before, including after editing the plan', async () => {
    const plan: PlanItem[] = [{ measureId: 'M4', districtId: 'Сарыарка' }];
    const { rerender, props } = mount({ plan });
    const map = await finishSdkLoad();
    ready(map);
    expect(sdk.scenarios).not.toHaveBeenCalled();

    const changed: PlanItem[] = [...plan, { measureId: 'M12', districtId: null }];
    rerender(<CityMap {...props} plan={changed} />);
    expect(sdk.scenarios).not.toHaveBeenCalled();
    expect(FakeHtmlMarker.instances).toHaveLength(0);
    expect(map.hideTraffic).not.toHaveBeenCalled();

    rerender(<CityMap {...props} plan={changed} mode="after" />);
    expect(sdk.scenarios).toHaveBeenCalledOnce();
    expect(sdk.scenarios).toHaveBeenLastCalledWith(api, map, changed, expect.any(Function));
  });

  it('replaces scenario overlays with the exact current plan when adding, retargeting and removing measures', async () => {
    const plan: PlanItem[] = [{ measureId: 'M4', districtId: 'Сарыарка' }];
    const { rerender, props } = mount({ mode: 'after', plan });
    const map = await finishSdkLoad();
    ready(map);
    expect(sdk.scenarios).toHaveBeenLastCalledWith(api, map, plan, expect.any(Function));
    expect(sdk.scenarios.mock.calls[0][2]).toBe(plan);
    let previousGroup = sdk.scenarios.mock.results.at(-1)!.value;
    map.fitBounds.mockClear();

    const changes: PlanItem[][] = [
      [...plan, { measureId: 'M12', districtId: null }],
      [{ measureId: 'M4', districtId: 'Нура' }, { measureId: 'M12', districtId: null }],
      [{ measureId: 'M12', districtId: null }],
      [],
    ];
    for (const changed of changes) {
      rerender(<CityMap {...props} plan={changed} />);
      expect(previousGroup.destroy).toHaveBeenCalledOnce();
      expect(sdk.scenarios).toHaveBeenLastCalledWith(api, map, changed, expect.any(Function));
      expect(sdk.scenarios.mock.calls.at(-1)![2]).toBe(changed);
      previousGroup = sdk.scenarios.mock.results.at(-1)!.value;
    }
    expect(sdk.scenarios).toHaveBeenCalledTimes(5);
    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.setCenter).not.toHaveBeenCalled();
    expect(map.setZoom).not.toHaveBeenCalled();
    expect(FakeMap.instances).toHaveLength(1);
  });

  it('destroys scenario overlays and an open project popup when returning to Before', async () => {
    const plan: PlanItem[] = [{ measureId: 'M4', districtId: 'Сарыарка' }];
    const { rerender, props } = mount({ mode: 'after', plan });
    const map = await finishSdkLoad();
    ready(map);
    const scenarios = sdk.scenarios.mock.results[0].value;
    const openProject = sdk.scenarios.mock.calls[0][3] as (name: string, coordinates: number[]) => void;
    act(() => openProject('M4 · Парк · Сарыарка', [71.378, 51.178]));
    expect(screen.getByText('M4 · Парк · Сарыарка')).toBeTruthy();
    const popup = FakeHtmlMarker.instances[0];
    expect(popup.options.coordinates).toEqual([71.378, 51.178]);

    rerender(<CityMap {...props} mode="before" />);
    expect(scenarios.destroy).toHaveBeenCalledOnce();
    expect(popup.destroy).toHaveBeenCalledOnce();
    expect(screen.queryByText('M4 · Парк · Сарыарка')).toBeNull();
    expect(sdk.scenarios).toHaveBeenCalledOnce();

    rerender(<CityMap {...props} mode="after" />);
    expect(sdk.scenarios).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('M4 · Парк · Сарыарка')).toBeNull();
    expect(FakeHtmlMarker.instances).toHaveLength(1);
  });

  it('keeps traffic enabled without a panel when retrying the map in Before', async () => {
    mount();
    const map = await finishSdkLoad();
    ready(map);

    act(() => map.emit('error', { type: 'invalidtilekey' }));
    fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }));
    const replacement = await finishSdkLoad();
    ready(replacement);

    expect(replacement.options.trafficOn).toBe(true);
    expect(replacement.showTraffic).toHaveBeenCalledOnce();
    expect(replacement.hideTraffic).not.toHaveBeenCalled();
    expect(screen.queryByRole('switch', { name: /Пробки/ })).toBeNull();
  });

  it('bounds zoom controls to the configured zoom range', async () => {
    mount();
    const map = await finishSdkLoad();
    ready(map);

    map.getZoom.mockReturnValue(16);
    fireEvent.click(screen.getByRole('button', { name: 'Приблизить' }));
    expect(map.setZoom).toHaveBeenLastCalledWith(16);
    map.getZoom.mockReturnValue(8.5);
    fireEvent.click(screen.getByRole('button', { name: 'Отдалить' }));
    expect(map.setZoom).toHaveBeenLastCalledWith(8.5);
  });

  it('times out a map that never becomes ready and ignores a late SDK response', async () => {
    let resolve!: (value: typeof api) => void;
    sdk.load.mockImplementationOnce(() => new Promise<typeof api>((done) => { resolve = done; }));
    mount();

    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getByRole('alert').textContent).toContain('Карта не загрузилась вовремя');
    await act(async () => { resolve(api); await Promise.resolve(); });
    expect(FakeMap.instances).toHaveLength(0);
  });

  it('releases overlays before destroying a ready map and removes all listeners on unmount', async () => {
    const { unmount } = mount({ mode: 'after' });
    const map = await finishSdkLoad();
    ready(map);

    unmount();

    expect(lifecycle).toEqual(['districts:0', 'scenarios:0', 'map:0']);
    expect(map.destroy).toHaveBeenCalledOnce();
    expect(map.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
