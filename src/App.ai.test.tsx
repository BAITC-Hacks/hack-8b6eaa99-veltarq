// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { analyzePlan, comparePlans, recommendPlans, simulatePlan, verifyCatalog, type AnalyzedPlan } from './api';
import { examplePlan, alternativePlan, serverResult } from './scenarioTestFixtures';
import { PLAN_STORAGE_KEY } from './useSavedPlan';

vi.mock('./api', async (importOriginal) => ({ ...await importOriginal<typeof import('./api')>(), analyzePlan: vi.fn(), simulatePlan: vi.fn(), verifyCatalog: vi.fn(), comparePlans: vi.fn(), recommendPlans: vi.fn() }));
vi.mock('./CityMap', () => ({ default: () => <div>Карта</div> }));

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  vi.mocked(verifyCatalog).mockResolvedValue(undefined);
  vi.mocked(simulatePlan).mockImplementation(async (plan) => serverResult(plan));
  vi.mocked(analyzePlan).mockImplementation(async (plan) => serverResult(plan));
});
afterEach(() => cleanup());
function openPlan() { fireEvent.click(screen.getByRole('button', { name: 'Мой план' })); }
function openInsights() { fireEvent.click(screen.getByText('Анализ и улучшение плана')); }
function loadExample() {
  openPlan();
  fireEvent.click(screen.getByRole('button', { name: 'Загрузить пример из ТЗ' }));
  fireEvent.click(screen.getByRole('button', { name: 'Рассчитать сценарий' }));
}

describe('complete AI planning path in existing panels', () => {
  it('selects five measures, calculates, explains, recommends, compares, applies and recalculates the editor plan', async () => {
    const first = serverResult(examplePlan);
    const second = serverResult(alternativePlan);
    vi.mocked(recommendPlans).mockResolvedValue({ currentScore: 56.54307, candidates: [{ plan: alternativePlan, score: 57.12345, improvement: 0.58038, budgetUsed: 90, budgetRemaining: 10 }] });
    vi.mocked(comparePlans).mockResolvedValue({ first: first.result, second: { ...second.result, score: 57.12345 }, betterScenario: 'second', scoreDifference: 0.58038, explanation: 'Расчёт сравнения.', analysis: { ...first.analysis, summary: 'Альтернатива повышает Score и оставляет больше бюджета.', tradeoffs: ['Распределение пользы между районами меняется.'] } });
    render(<App />);
    loadExample();
    await screen.findByText('56.54307');
    expect(simulatePlan).toHaveBeenCalledWith(examplePlan, expect.any(AbortSignal));
    openPlan();
    openInsights();
    expect(await screen.findByText(first.analysis.summary)).toBeTruthy();
    expect(screen.getByText(/подготовлено языковой моделью/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Найти улучшения' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Сравнить вариант 1' }));
    expect(await screen.findByText('Альтернатива повышает Score и оставляет больше бюджета.')).toBeTruthy();
    expect(screen.getByText(/Предложенный вариант лучше по Score/)).toBeTruthy();
    expect(screen.getByText('Распределение пользы между районами меняется.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Применить вариант 1' }));
    await waitFor(() => expect(simulatePlan).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(analyzePlan).toHaveBeenCalledTimes(2));
    expect(simulatePlan).toHaveBeenLastCalledWith(alternativePlan, expect.any(AbortSignal));
    expect(verifyCatalog).toHaveBeenCalledTimes(2);
    expect(JSON.parse(window.localStorage.getItem(PLAN_STORAGE_KEY)!).plan).toEqual(alternativePlan);
    expect(screen.getByRole('button', { name: 'Удалить M6 из плана' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Удалить M5 из плана' })).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Мой план' })).toBeTruthy();
    expect(screen.queryByText('Альтернатива повышает Score и оставляет больше бюджета.')).toBeNull();
  });

  it('keeps Score visible during LLM loading and retries provider fallback without recalculating', async () => {
    let finish!: (value: AnalyzedPlan) => void;
    vi.mocked(analyzePlan).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    render(<App />);
    loadExample();
    await screen.findByText('56.54307');
    openPlan();
    openInsights();
    expect(screen.getByText('Готовим объяснение по рассчитанному сценарию…')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Готовим объяснение…' }).disabled).toBe(true);
    const fallback = serverResult();
    fallback.analysis = { ...fallback.analysis, provider: 'deterministic_fallback', fallback_reason: 'timeout' };
    await act(async () => finish(fallback));
    expect(screen.getByText('Автоматическое объяснение без ИИ')).toBeTruthy();
    expect(screen.getByText('Сервис ИИ не ответил вовремя.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить запрос объяснения' }));
    await screen.findByText(/подготовлено языковой моделью/);
    expect(simulatePlan).toHaveBeenCalledTimes(1);
    expect(analyzePlan).toHaveBeenCalledTimes(2);
  });

  it('cancels pending calculation when the user returns to Before', async () => {
    let finish!: (value: AnalyzedPlan) => void;
    vi.mocked(simulatePlan).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    render(<App />);
    loadExample();
    await waitFor(() => expect(simulatePlan).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'До — сейчас' }));
    expect(vi.mocked(simulatePlan).mock.calls[0][1]?.aborted).toBe(true);
    await act(async () => finish(serverResult()));
    expect(screen.queryByText('ИТОГОВЫЙ SCORE')).toBeNull();
    expect(screen.getByText('52.55768')).toBeTruthy();
    expect(analyzePlan).not.toHaveBeenCalled();
  });
});
