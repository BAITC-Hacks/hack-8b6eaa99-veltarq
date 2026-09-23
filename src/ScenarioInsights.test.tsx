// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScenarioInsights from './ScenarioInsights';
import { comparePlans, recommendPlans } from './api';
import type { AnalysisResult, BackendSimulation, ComparisonResult, RecommendationsResult } from './api';
import { BASELINE, calculatePlan } from './model';
import type { PlanItem } from './modelData';

vi.mock('./api', () => ({ recommendPlans: vi.fn(), comparePlans: vi.fn() }));

const plan: PlanItem[] = [
  { measureId: 'M7', districtId: 'Нура' }, { measureId: 'M8', districtId: 'Нура' },
  { measureId: 'M10', districtId: 'Нура' }, { measureId: 'M12', districtId: null },
  { measureId: 'M5', districtId: 'Сарыарка' },
];
const candidatePlan: PlanItem[] = plan.map((item) => item.measureId === 'M5' ? { measureId: 'M6', districtId: null } : { ...item });
const analysis: AnalysisResult = {
  provider: 'deterministic', summary: 'План улучшает показатели города.',
  strengths: ['Школы стали доступнее.'], risks: ['В Нуре остаётся дефицит транспорта.'],
  tradeoffs: ['На остальные меры остаётся 5 единиц.'], recommendations: ['Сравните альтернативы.'], facts: {},
};
const simulation: BackendSimulation = {
  dataset_version: '1.0.0', horizon_quarters: 8, budget_used: 95, budget_remaining: 5,
  decisions: [],
  districts: [{ district_id: 'nura', district_name: 'Нура', population_share: 0.16, score_before: 49.93, score_after: 55.675, score_delta: 5.745, indicators: [] }],
  contributions: [
    { source: 'M7', source_type: 'measure', district_id: 'nura', indicator_code: 'S1', delta: 10 },
    { source: 'M10+M12', source_type: 'synergy', district_id: 'nura', indicator_code: 'B1', delta: 2 },
  ],
  activated_synergies: ['M10+M12'],
  score: {
    city_average_before: BASELINE.weightedIndex, city_average_after: 63,
    weakest_district_before: BASELINE.minIndex, weakest_district_after: 55.675,
    critical_count_before: 2, critical_count_after: 0,
    score_before: BASELINE.score, score_after: 60.55, score_delta: 7.99,
  },
};
const recommendations: RecommendationsResult = {
  currentScore: 60.55,
  candidates: [{ plan: candidatePlan, score: 60.9, improvement: 0.35, budgetUsed: 90, budgetRemaining: 10 }],
};
const comparison: ComparisonResult = {
  first: calculatePlan(plan)!, second: calculatePlan(candidatePlan)!,
  betterScenario: 'second', scoreDifference: 0.35,
  explanation: 'Второй сценарий лучше первого на 0.35 балла.',
  analysis: { ...analysis, provider: 'llm', summary: 'Альтернатива улучшает Score по серверному расчёту.' },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function openInsights() {
  fireEvent.click(screen.getByText('Анализ и улучшение плана'));
}

describe('backend scenario insights', () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => cleanup());

  it('starts collapsed, explains calculation sources and makes no request merely on opening', () => {
    render(<ScenarioInsights plan={plan} simulation={simulation} analysis={analysis} onApply={vi.fn()} />);
    expect(screen.getByText('Анализ и улучшение плана').parentElement?.hasAttribute('open')).toBe(false);
    openInsights();
    for (const title of ['Сильные стороны', 'Риски', 'Компромиссы', 'Рекомендации']) {
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    }
    expect(screen.getByText(analysis.summary)).toBeTruthy();
    expect(screen.getByText('Автоматическое объяснение без ИИ')).toBeTruthy();
    expect(screen.getByText(/глобальный максимум не гарантируется/)).toBeTruthy();
    fireEvent.click(screen.getByText('Синергии и вклад мероприятий'));
    expect(screen.getByText('Активированные синергии: M10+M12.')).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Вклад в показатели районов' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByText('+10')).toBeTruthy();
    expect(within(table).getByText(/M10\+M12 · синергия/)).toBeTruthy();
    expect(recommendPlans).not.toHaveBeenCalled();
    expect(comparePlans).not.toHaveBeenCalled();
  });

  it.each([
    ['llm', /подготовлено языковой моделью \(LLM\)/],
    ['deterministic_fallback', /Автоматическое объяснение без ИИ/],
  ])('labels the %s explanation honestly', (provider, label) => {
    render(<ScenarioInsights plan={plan} simulation={simulation} analysis={{ ...analysis, provider }} onApply={vi.fn()} />);
    openInsights();
    expect(screen.getByText(label)).toBeTruthy();
  });

  it('searches explicitly, shows loading and displays up to three scored and budgeted candidates', async () => {
    const pending = deferred<RecommendationsResult>();
    vi.mocked(recommendPlans).mockReturnValue(pending.promise);
    render(<ScenarioInsights plan={plan} simulation={simulation} analysis={analysis} onApply={vi.fn()} />);
    openInsights();
    fireEvent.click(screen.getByRole('button', { name: 'Найти улучшения' }));
    expect(recommendPlans).toHaveBeenCalledWith(plan, expect.any(AbortSignal));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Ищем улучшения…' }).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('проверяет');
    await act(async () => pending.resolve({
      ...recommendations,
      candidates: Array.from({ length: 4 }, (_, index) => ({
        ...recommendations.candidates[0], plan: candidatePlan.map((item) => item.measureId === 'M10' ? { ...item, districtId: (['Нура', 'Есиль', 'Алматы', 'Сарыарка'] as const)[index] } : item),
      })),
    }));
    expect(screen.getAllByRole('button', { name: /^Применить вариант/ })).toHaveLength(3);
    expect(screen.getByText('Score текущего плана: 60,55.')).toBeTruthy();
    expect(screen.getAllByText(/Изменение Score: \+0,35. Бюджет: 90 \/ 100; остаток: 10./)).toHaveLength(3);
    expect(comparePlans).not.toHaveBeenCalled();
  });

  it('retries a failed search and distinguishes no local improvement from a global optimum', async () => {
    vi.mocked(recommendPlans).mockRejectedValueOnce(new Error('Сервис временно недоступен.')).mockResolvedValueOnce({ currentScore: 60.55, candidates: [] });
    render(<ScenarioInsights plan={plan} simulation={simulation} analysis={analysis} onApply={vi.fn()} />);
    openInsights();
    fireEvent.click(screen.getByRole('button', { name: 'Найти улучшения' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Сервис временно недоступен.');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить поиск' }));
    expect(await screen.findByText('Улучшений среди проверенных вариантов с одним изменением не найдено.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(recommendPlans).toHaveBeenCalledTimes(2);
  });

  it('compares through the server, retries failures and applies a copied candidate only on demand', async () => {
    const onApply = vi.fn();
    vi.mocked(recommendPlans).mockResolvedValue(recommendations);
    const pending = deferred<ComparisonResult>();
    vi.mocked(comparePlans).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(comparison);
    render(<ScenarioInsights plan={plan} simulation={simulation} analysis={analysis} onApply={onApply} />);
    openInsights();
    fireEvent.click(screen.getByRole('button', { name: 'Найти улучшения' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Сравнить вариант 1' }));
    expect(comparePlans).toHaveBeenCalledWith(plan, candidatePlan, expect.any(AbortSignal));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Сравнить вариант 1' }).disabled).toBe(true);
    await act(async () => pending.reject(new Error('Сравнение недоступно.')));
    expect(screen.getByRole('alert').textContent).toBe('Сравнение недоступно.');
    expect(screen.getByText('Повторить сравнение')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Сравнить вариант 1' }));
    expect(await screen.findByText(comparison.analysis.summary)).toBeTruthy();
    expect(screen.getByText(/Предложенный вариант лучше/)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Применить вариант 1' }));
    expect(onApply).toHaveBeenCalledWith(candidatePlan);
    expect(onApply.mock.calls[0][0]).not.toBe(candidatePlan);
    expect(onApply.mock.calls[0][0][0]).not.toBe(candidatePlan[0]);
  });

  it('aborts search and ignores stale results when the plan changes', async () => {
    const pending = deferred<RecommendationsResult>();
    vi.mocked(recommendPlans).mockReturnValue(pending.promise);
    const onApply = vi.fn();
    const { rerender } = render(<ScenarioInsights plan={plan} simulation={simulation} analysis={analysis} onApply={onApply} />);
    openInsights();
    fireEvent.click(screen.getByRole('button', { name: 'Найти улучшения' }));
    const signal = vi.mocked(recommendPlans).mock.calls[0][1]!;
    rerender(<ScenarioInsights plan={candidatePlan} simulation={simulation} analysis={analysis} onApply={onApply} />);
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(recommendations));
    expect(screen.queryByRole('button', { name: 'Применить вариант 1' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Найти улучшения' })).toBeTruthy();
  });

  it('aborts an in-flight comparison on unmount', async () => {
    vi.mocked(recommendPlans).mockResolvedValue(recommendations);
    const pending = deferred<ComparisonResult>();
    vi.mocked(comparePlans).mockReturnValue(pending.promise);
    const { unmount } = render(<ScenarioInsights plan={plan} simulation={simulation} analysis={analysis} onApply={vi.fn()} />);
    openInsights();
    fireEvent.click(screen.getByRole('button', { name: 'Найти улучшения' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Сравнить вариант 1' }));
    const signal = vi.mocked(comparePlans).mock.calls[0][2]!;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(comparison));
  });

  it('drops comparison results when the plan changes and then returns to the previous plan', async () => {
    vi.mocked(recommendPlans).mockResolvedValue(recommendations);
    const pending = deferred<ComparisonResult>();
    vi.mocked(comparePlans).mockReturnValueOnce(pending.promise);
    const props = { simulation, analysis, onApply: vi.fn() };
    const { rerender } = render(<ScenarioInsights {...props} plan={plan} />);
    openInsights();
    fireEvent.click(screen.getByRole('button', { name: 'Найти улучшения' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Сравнить вариант 1' }));
    const signal = vi.mocked(comparePlans).mock.calls[0][2]!;
    rerender(<ScenarioInsights {...props} plan={candidatePlan} />);
    rerender(<ScenarioInsights {...props} plan={plan} />);
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(comparison));
    expect(screen.queryByText(comparison.analysis.summary)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Применить вариант 1' })).toBeNull();
  });

  it('shows comparison fallback, reason and retry with structured tradeoffs', async () => {
    vi.mocked(recommendPlans).mockResolvedValue(recommendations);
    vi.mocked(comparePlans).mockResolvedValueOnce({ ...comparison, analysis: { ...comparison.analysis, provider: 'deterministic_fallback', fallback_reason: 'invalid_response', tradeoffs: ['Проверенный компромисс сравнения.'] } }).mockResolvedValueOnce(comparison);
    render(<ScenarioInsights plan={plan} simulation={simulation} analysis={{ ...analysis, provider: 'llm' }} onApply={vi.fn()} />);
    openInsights();
    fireEvent.click(screen.getByRole('button', { name: 'Найти улучшения' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Сравнить вариант 1' }));
    expect(await screen.findByText('Автоматическое объяснение без ИИ')).toBeTruthy();
    expect(screen.getByText('Ответ ИИ не прошёл проверку достоверности.')).toBeTruthy();
    expect(screen.getByText('Проверенный компромисс сравнения.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить запрос сравнения' }));
    await screen.findByText(comparison.analysis.summary);
    expect(comparePlans).toHaveBeenCalledTimes(2);
  });
});
