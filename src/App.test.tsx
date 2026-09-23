// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { PlanItem } from './modelData';
import { PLAN_STORAGE_KEY } from './useSavedPlan';
import { analyzePlan, simulatePlan, verifyCatalog } from './api';
import { serverResult } from './scenarioTestFixtures';
import { BASELINE, calculateEffects } from './model';
import { previewMeasures } from './previewApi';

vi.mock('./api', async (importOriginal) => ({ ...await importOriginal<typeof import('./api')>(), analyzePlan: vi.fn(), simulatePlan: vi.fn(), verifyCatalog: vi.fn() }));
vi.mock('./previewApi', () => ({ previewMeasures: vi.fn() }));
vi.mock('./ScenarioInsights', () => ({ default: () => <div>Объяснение сценария</div> }));

async function calculateAndWait() {
  fireEvent.click(calculateButton());
  await waitFor(() => expect(finalScore()).toBeTruthy());
}

vi.mock('./CityMap', () => ({
  default: ({ mode }: { mode: string }) => <div role="status">Карта 2ГИС недоступна. Режим карты: {mode}.</div>,
}));

function seedPlan(plan: PlanItem[]) {
  window.localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify({ version: 1, plan }));
}

function savedPlan(): PlanItem[] {
  return JSON.parse(window.localStorage.getItem(PLAN_STORAGE_KEY)!).plan;
}

function catalog() {
  return screen.getByRole('region', { name: 'Подобрать меры' });
}

function option(id: string) {
  return within(catalog()).getByRole('article', { name: new RegExp(`^${id} `) });
}

function calculateButton() {
  return screen.getByRole<HTMLButtonElement>('button', { name: 'Рассчитать сценарий' });
}

function openPlan() {
  const toggle = screen.getByRole('button', { name: 'Мой план' });
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
}

function finalScore() {
  return screen.queryByText('ИТОГОВЫЙ SCORE');
}

describe('district and scenario planning without a working map', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(previewMeasures).mockImplementation(async (_plan, districtId) => ({ candidates: [{ measureId: 'M7', districts: [{ districtId, indicators: [{ code: 'S1', before: BASELINE.indicators[districtId].S1, after: BASELINE.indicators[districtId].S1 + 10, delta: 10 }] }] }] }));
    vi.mocked(verifyCatalog).mockResolvedValue(undefined);
    vi.mocked(analyzePlan).mockImplementation(async (plan) => serverResult(plan));
    vi.mocked(simulatePlan).mockImplementation(async (plan) => serverResult(plan));
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('opens all ten dataset indicators from the district list while the map is unavailable', () => {
    render(<App />);
    expect(screen.getByText(/Карта 2ГИС недоступна/)).toBeTruthy();
    expect(screen.getByText('52.55768')).toBeTruthy();
    openPlan();
    expect(calculateButton().disabled).toBe(true);
    expect(finalScore()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^Нура\s*Индекс/ }));
    const card = screen.getByRole('article', { name: 'Нура' });
    const rows = within(within(card).getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(10);
    const baseline = [
      ['T1', '55'], ['T2', '40'], ['E1', '45'], ['E2', '65'], ['S1', '38'],
      ['S2', '35'], ['B1', '55'], ['B2', '50'], ['C1', '60'], ['C2', '50'],
    ];
    rows.forEach((row, index) => {
      expect(within(row).getByRole('rowheader').textContent).toMatch(new RegExp(`^${baseline[index][0]} `));
      expect(within(row).getByRole('cell').textContent).toBe(baseline[index][1]);
    });
    expect(within(card).getByText(/не равен текущему баллу пробок 2ГИС/)).toBeTruthy();
    expect(within(card).getByText(/ГРАНИЦЫ И РАЗМЕЩЕНИЕ ДЕМОНСТРАЦИОННЫЕ/)).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Подобрать меры' })).toBeTruthy();
  });

  it('shows all 14 measures, applies lag in the preview, and adds and removes a district measure', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /^Нура\s*Индекс/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Подобрать меры' }));
    expect(within(catalog()).getAllByRole('article')).toHaveLength(14);
    expect(within(option('M7')).getByText('24 ед.')).toBeTruthy();
    expect(within(option('M7')).getByText('Район: Нура · Лаг 3 кв.')).toBeTruthy();
    // Full S1 +16 becomes +10 at the eight-quarter horizon after the three-quarter lag.
    expect(await within(option('M7')).findByText('S1: 38 → 48 (+10)')).toBeTruthy();

    fireEvent.click(within(option('M7')).getByRole('button', { name: 'Добавить M7' }));
    expect(savedPlan()).toEqual([{ measureId: 'M7', districtId: 'Нура' }]);
    expect(within(catalog()).getByText('Решений: 1 / 5 · Бюджет: 24 / 100')).toBeTruthy();
    expect(within(option('M7')).queryByRole('button', { name: 'Добавить M7' })).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'После — сценарий' }).disabled).toBe(true);

    fireEvent.click(within(option('M7')).getByRole('button', { name: 'Удалить M7' }));
    expect(savedPlan()).toEqual([]);
    expect(within(option('M7')).getByRole('button', { name: 'Добавить M7' })).toBeTruthy();
    expect(within(catalog()).getByText('Решений: 0 / 5 · Бюджет: 0 / 100')).toBeTruthy();
  });

  it('keeps catalog targeting in sync with list selection and its district selector', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /^Нура\s*Индекс/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Подобрать меры' }));
    fireEvent.click(screen.getByRole('button', { name: /^Есиль\s*Индекс/ }));
    expect(within(catalog()).getByRole<HTMLSelectElement>('combobox', { name: 'Целевой район' }).value).toBe('Есиль');
    expect(await within(option('M7')).findByText('S1: 48 → 58 (+10)')).toBeTruthy();

    fireEvent.change(within(catalog()).getByRole('combobox', { name: 'Целевой район' }), { target: { value: 'Алматы' } });
    fireEvent.click(within(option('M7')).getByRole('button', { name: 'Добавить M7' }));
    expect(savedPlan()).toEqual([{ measureId: 'M7', districtId: 'Алматы' }]);
    fireEvent.click(within(catalog()).getByRole('button', { name: 'Закрыть каталог' }));
    expect(screen.getByRole('article', { name: 'Алматы' })).toBeTruthy();
  });

  it('prevents global M1/M3 incompatibility even when the catalog target changes', () => {
    seedPlan([{ measureId: 'M1', districtId: 'Нура' }]);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Каталог мероприятий' }));
    fireEvent.change(within(catalog()).getByRole('combobox', { name: 'Целевой район' }), { target: { value: 'Есиль' } });
    const add = within(option('M3')).getByRole<HTMLButtonElement>('button', { name: 'Добавить M3' });
    expect(add.disabled).toBe(true);
    expect(within(option('M3')).getByText('M1 и M3 несовместимы в одном плане, даже в разных районах.')).toBeTruthy();
    fireEvent.click(add);
    expect(savedPlan()).toHaveLength(1);
  });

  it('allows a local incompatibility pair in different districts and blocks it in the same district', () => {
    seedPlan([{ measureId: 'M4', districtId: 'Нура' }]);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Каталог мероприятий' }));
    expect(within(option('M7')).getByRole<HTMLButtonElement>('button', { name: 'Добавить M7' }).disabled).toBe(true);
    expect(within(option('M7')).getByText('M4 и M7 несовместимы в одном районе.')).toBeTruthy();
    fireEvent.change(within(catalog()).getByRole('combobox', { name: 'Целевой район' }), { target: { value: 'Есиль' } });
    expect(within(option('M7')).getByRole<HTMLButtonElement>('button', { name: 'Добавить M7' }).disabled).toBe(false);
    fireEvent.click(within(option('M7')).getByRole('button', { name: 'Добавить M7' }));
    expect(savedPlan()).toEqual([{ measureId: 'M4', districtId: 'Нура' }, { measureId: 'M7', districtId: 'Есиль' }]);
  });

  it('blocks a third measure of one direction and exposes the reason', () => {
    seedPlan([{ measureId: 'M7', districtId: 'Нура' }, { measureId: 'M8', districtId: 'Нура' }]);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Каталог мероприятий' }));
    expect(within(option('M9')).getByRole<HTMLButtonElement>('button', { name: 'Добавить M9' }).disabled).toBe(true);
    expect(within(option('M9')).getByText('В направлении «Социальная сфера» допускается не более 2 мероприятий.')).toBeTruthy();
    expect(within(option('M10')).getByRole<HTMLButtonElement>('button', { name: 'Добавить M10' }).disabled).toBe(false);
  });

  it('blocks additions exceeding the 100-point budget', () => {
    seedPlan([
      { measureId: 'M3', districtId: 'Нура' }, { measureId: 'M5', districtId: 'Сарыарка' },
      { measureId: 'M7', districtId: 'Нура' },
    ]);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Каталог мероприятий' }));
    expect(within(catalog()).getByText('Решений: 3 / 5 · Бюджет: 79 / 100')).toBeTruthy();
    const add = within(option('M2')).getByRole<HTMLButtonElement>('button', { name: 'Добавить M2' });
    expect(add.disabled).toBe(true);
    expect(within(option('M2')).getByText('Бюджет превышен: 101 из 100.')).toBeTruthy();
    fireEvent.click(add);
    expect(savedPlan()).toHaveLength(3);
  });

  it('shows the example result only after calculation, provides before/after indicators, and clears it on edit', async () => {
    render(<App />);
    openPlan();
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить пример из ТЗ' }));
    expect(calculateButton().disabled).toBe(false);
    expect(finalScore()).toBeNull();
    expect(screen.queryByText('56.54307')).toBeNull();
    await calculateAndWait();

    expect(finalScore()).toBeTruthy();
    expect(screen.getByText('56.54307')).toBeTruthy();
    expect(screen.getByText(/Сценарий через 8 кварталов/)).toBeTruthy();
    expect(screen.getByText(/Режим карты: after/)).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: 'Мой план' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Нура\s*Индекс/ }));
    const card = screen.getByRole('article', { name: 'Нура' });
    expect(within(card).getByRole('columnheader', { name: 'До → после' })).toBeTruthy();
    const s1Row = within(card).getByRole('rowheader', { name: /S1 Школы/ }).closest('tr')!;
    expect(within(s1Row).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['38 → 48', '+10']);
    expect(within(card).getByText('49,18 → 52,9625')).toBeTruthy();

    openPlan();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить M7 из плана' }));
    expect(finalScore()).toBeNull();
    expect(screen.queryByText('56.54307')).toBeNull();
    expect(screen.getByText(/Режим карты: before/)).toBeTruthy();
    expect(calculateButton().disabled).toBe(true);
  });

  it('prevents a sixth measure and duplicate additions', () => {
    render(<App />);
    openPlan();
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить пример из ТЗ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Каталог мероприятий' }));
    expect(within(option('M12')).queryByRole('button', { name: 'Добавить M12' })).toBeNull();
    expect(within(option('M12')).getByRole('button', { name: 'Удалить M12' })).toBeTruthy();
    expect(within(option('M11')).getByRole<HTMLButtonElement>('button', { name: 'Добавить M11' }).disabled).toBe(true);
    expect(within(option('M11')).getByText(/В плане может быть не более 5 мероприятий/)).toBeTruthy();
  });

  it('invalidates the final result when a target edit creates a local incompatibility', async () => {
    seedPlan([
      { measureId: 'M4', districtId: 'Есиль' }, { measureId: 'M7', districtId: 'Нура' },
      { measureId: 'M10', districtId: 'Нура' }, { measureId: 'M12', districtId: null },
      { measureId: 'M11', districtId: 'Нура' },
    ]);
    render(<App />);
    openPlan();
    await calculateAndWait();
    expect(finalScore()).toBeTruthy();
    openPlan();
    fireEvent.change(screen.getByRole('combobox', { name: 'M7: целевой район' }), { target: { value: 'Есиль' } });
    expect(screen.getByText('M4 и M7 несовместимы в одном районе.')).toBeTruthy();
    expect(calculateButton().disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'После — сценарий' }).disabled).toBe(true);
    expect(finalScore()).toBeNull();
    expect(savedPlan().find((item) => item.measureId === 'M7')?.districtId).toBe('Есиль');
  });

  it('persists a partially completed plan and target changes across unmount and reload', () => {
    seedPlan([{ measureId: 'M7', districtId: 'Нура' }]);
    const first = render(<App />);
    openPlan();
    fireEvent.change(screen.getByRole('combobox', { name: 'M7: целевой район' }), { target: { value: 'Алматы' } });
    expect(savedPlan()).toEqual([{ measureId: 'M7', districtId: 'Алматы' }]);
    first.unmount();
    render(<App />);
    openPlan();
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'M7: целевой район' }).value).toBe('Алматы');
    expect(calculateButton().disabled).toBe(true);
    expect(finalScore()).toBeNull();
    expect(screen.getByText('План сохранён в этом браузере.')).toBeTruthy();
  });

  it('restores a complete plan but requires a fresh calculation before displaying its Score', async () => {
    const first = render(<App />);
    openPlan();
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить пример из ТЗ' }));
    await calculateAndWait();
    expect(screen.getByText('56.54307')).toBeTruthy();
    first.unmount();
    render(<App />);
    expect(finalScore()).toBeNull();
    openPlan();
    expect(calculateButton().disabled).toBe(false);
    await calculateAndWait();
    expect(screen.getByText('56.54307')).toBeTruthy();
  });

  it('keeps a saved invalid complete plan editable without exposing a final Score', async () => {
    seedPlan([
      { measureId: 'M7', districtId: null }, { measureId: 'M8', districtId: 'Нура' },
      { measureId: 'M10', districtId: 'Нура' }, { measureId: 'M12', districtId: 'Нура' },
      { measureId: 'M5', districtId: 'Сарыарка' },
    ]);
    render(<App />);
    openPlan();
    expect(screen.getByText('Для M7 выберите один из пяти игровых районов.')).toBeTruthy();
    expect(screen.getByText('M12 действует на весь город: целевой район не указывается.')).toBeTruthy();
    expect(calculateButton().disabled).toBe(true);
    expect(finalScore()).toBeNull();
    expect(savedPlan()).toHaveLength(5);

    fireEvent.change(screen.getByRole('combobox', { name: 'M7: целевой район' }), { target: { value: 'Нура' } });
    fireEvent.click(screen.getByRole('button', { name: 'Убрать целевой район' }));
    expect(calculateButton().disabled).toBe(false);
    expect(finalScore()).toBeNull();
    await calculateAndWait();
    expect(screen.getByText('56.54307')).toBeTruthy();
  });

  it('uses the returned server Score rather than a local final calculation', async () => {
    vi.mocked(simulatePlan).mockImplementation(async (plan) => ({
      ...serverResult(plan), result: { ...calculateEffects(plan), score: 58.12345 },
    }));
    render(<App />);
    openPlan();
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить пример из ТЗ' }));
    await calculateAndWait();
    expect(screen.getByText('58.12345')).toBeTruthy();
    expect(screen.queryByText('56.54307')).toBeNull();
    expect(verifyCatalog).toHaveBeenCalled();
    expect(analyzePlan).toHaveBeenCalledWith(savedPlan(), expect.any(AbortSignal));
  });

  it('keeps a failed calculation editable and lets the user retry without a local fallback Score', async () => {
    vi.mocked(simulatePlan).mockRejectedValueOnce(new Error('Сервер временно недоступен.'));
    render(<App />);
    openPlan();
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить пример из ТЗ' }));
    fireEvent.click(calculateButton());
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toContain('Сервер временно недоступен.');
    expect(finalScore()).toBeNull();
    expect(savedPlan()).toHaveLength(5);
    await calculateAndWait();
    expect(screen.getByText('56.54307')).toBeTruthy();
  });

  it('does not simulate when the backend catalog differs from the preview dataset', async () => {
    vi.mocked(verifyCatalog).mockRejectedValueOnce(new Error('Каталог сервера отличается от датасета сайта.'));
    render(<App />);
    openPlan();
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить пример из ТЗ' }));
    fireEvent.click(calculateButton());
    await screen.findByRole('alert');
    expect(simulatePlan).not.toHaveBeenCalled();
    expect(finalScore()).toBeNull();
  });

  it('ignores a late response after the plan was edited and then restored', async () => {
    let finish!: (response: Awaited<ReturnType<typeof analyzePlan>>) => void;
    vi.mocked(simulatePlan).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<App />);
    openPlan();
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить пример из ТЗ' }));
    const original = savedPlan();
    fireEvent.click(calculateButton());
    await waitFor(() => expect(simulatePlan).toHaveBeenCalled());
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Рассчитываем…' }).disabled).toBe(true);
    fireEvent.change(screen.getByRole('combobox', { name: 'M7: целевой район' }), { target: { value: 'Есиль' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'M7: целевой район' }), { target: { value: 'Нура' } });
    expect(vi.mocked(simulatePlan).mock.calls[0][1]?.aborted).toBe(true);
    await act(async () => finish(serverResult(original)));
    expect(finalScore()).toBeNull();
    expect(screen.queryByText('56.54307')).toBeNull();
    await calculateAndWait();
  });

  it('respects a return to Before while the server calculation is pending', async () => {
    let finish!: (response: Awaited<ReturnType<typeof analyzePlan>>) => void;
    vi.mocked(simulatePlan).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<App />);
    openPlan();
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить пример из ТЗ' }));
    const plan = savedPlan();
    fireEvent.click(calculateButton());
    await waitFor(() => expect(simulatePlan).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'До — сейчас' }));
    expect(vi.mocked(simulatePlan).mock.calls[0][1]?.aborted).toBe(true);
    await act(async () => finish(serverResult(plan)));
    expect(finalScore()).toBeNull();
    expect(screen.getByRole('button', { name: 'До — сейчас' }).getAttribute('aria-pressed')).toBe('true');
    expect(calculateButton().disabled).toBe(false);
  });

  it('opens loading and errors in the plan panel when calculation starts from the After switch', async () => {
    vi.mocked(simulatePlan).mockRejectedValueOnce(new Error('Нет соединения с сервером.'));
    render(<App />);
    openPlan();
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить пример из ТЗ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть план' }));
    fireEvent.click(screen.getByRole('button', { name: 'После — сценарий' }));
    expect(screen.getByRole('complementary', { name: 'Мой план' })).toBeTruthy();
    await screen.findByRole('alert');
    expect(finalScore()).toBeNull();
  });

  it('toggles the district menu and keeps the plan reachable when the dock is closed', () => {
    render(<App />);
    expect(screen.queryByRole('complementary', { name: 'Мой план' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть меню районов' }));
    expect(screen.queryByRole('navigation', { name: 'Игровые районы' })).toBeNull();

    openPlan();
    expect(screen.getByRole('complementary', { name: 'Мой план' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть план' }));
    expect(screen.queryByRole('complementary', { name: 'Мой план' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Развернуть районы' }));
    expect(screen.getByRole('navigation', { name: 'Игровые районы' })).toBeTruthy();
    openPlan();
    fireEvent.click(screen.getByRole('button', { name: /^Нура\s*Индекс/ }));
    expect(screen.queryByRole('complementary', { name: 'Мой план' })).toBeNull();
    expect(screen.getByRole('article', { name: 'Нура' })).toBeTruthy();
  });
});
