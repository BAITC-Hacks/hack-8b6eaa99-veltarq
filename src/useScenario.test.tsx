// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzePlan, simulatePlan, verifyCatalog, type AnalyzedPlan, type SimulatedPlan } from './api';
import { useScenario } from './useScenario';
import { alternativePlan, examplePlan, serverResult } from './scenarioTestFixtures';

vi.mock('./api', async (importOriginal) => ({ ...await importOriginal<typeof import('./api')>(), analyzePlan: vi.fn(), simulatePlan: vi.fn(), verifyCatalog: vi.fn() }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(verifyCatalog).mockResolvedValue(undefined);
  vi.mocked(simulatePlan).mockImplementation(async (plan) => serverResult(plan));
  vi.mocked(analyzePlan).mockImplementation(async (plan) => serverResult(plan));
});
afterEach(() => cleanup());

describe('independent simulation and explanation', () => {
  it('publishes server calculation while explanation is pending and then shows its structured response', async () => {
    const pending = deferred<AnalyzedPlan>();
    vi.mocked(analyzePlan).mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useScenario(examplePlan));
    await act(async () => expect(await result.current.calculate()).toBe(true));
    expect(result.current.loading).toBe(false);
    expect(result.current.response?.result.score).toBe(56.54307);
    expect(result.current.response?.simulation.score.score_before).toBe(52.55768);
    expect(result.current.analysisLoading).toBe(true);
    expect(result.current.analysis).toBeNull();
    await act(async () => pending.resolve(serverResult()));
    expect(result.current.analysis?.provider).toBe('llm');
    expect(result.current.analysis?.summary).toBe(serverResult().analysis.summary);
    expect(result.current.analysisLoading).toBe(false);
  });

  it.each(['Сервис ИИ временно недоступен.', 'Сервер не ответил вовремя.', 'Сервер вернул неполные или некорректные данные.'])('keeps calculation with deterministic fallback for %s and retries only explanation', async (message) => {
    vi.mocked(analyzePlan).mockRejectedValueOnce(new Error(message));
    const response = serverResult();
    // Deliberately distinct engine values expose accidental local arithmetic in fallback.
    response.simulation.score.score_delta = 9.12345;
    response.simulation.budget_remaining = 3;
    vi.mocked(simulatePlan).mockResolvedValueOnce(response);
    vi.mocked(analyzePlan).mockResolvedValueOnce(response);
    const { result } = renderHook(() => useScenario(examplePlan));
    await act(async () => { await result.current.calculate(); });
    expect(result.current.response).toBe(response);
    expect(result.current.error).toBeNull();
    expect(result.current.analysisError).toBe(message);
    expect(result.current.analysis?.provider).toBe('deterministic_fallback');
    expect(result.current.analysis?.summary).toContain('+9,12345');
    expect(result.current.analysis?.tradeoffs).toContain('Бюджет: потрачено 95, осталось 3.');
    act(() => result.current.retryAnalysis());
    await waitFor(() => expect(result.current.analysis?.provider).toBe('llm'));
    expect(simulatePlan).toHaveBeenCalledTimes(1);
    expect(verifyCatalog).toHaveBeenCalledTimes(1);
    expect(analyzePlan).toHaveBeenCalledTimes(2);
    expect(result.current.analysisError).toBeNull();
  });

  it('refuses an explanation of different server results while retaining the original simulation', async () => {
    const analyzed = serverResult();
    analyzed.simulation.score.score_after = 99;
    vi.mocked(analyzePlan).mockResolvedValueOnce(analyzed);
    const { result } = renderHook(() => useScenario(examplePlan));
    await act(async () => { await result.current.calculate(); });
    expect(result.current.response?.simulation.score.score_after).toBe(56.54307);
    expect(result.current.analysis?.provider).toBe('deterministic_fallback');
    expect(result.current.analysisError).toContain('не совпали');
  });

  it('ignores a late simulation after editing and restoring the exact same plan', async () => {
    const pending = deferred<SimulatedPlan>();
    vi.mocked(simulatePlan).mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(({ plan }) => useScenario(plan), { initialProps: { plan: examplePlan } });
    let calculation!: Promise<boolean>;
    act(() => { calculation = result.current.calculate(); });
    await waitFor(() => expect(simulatePlan).toHaveBeenCalled());
    const signal = vi.mocked(simulatePlan).mock.calls[0][1]!;
    rerender({ plan: alternativePlan });
    rerender({ plan: examplePlan });
    expect(signal.aborted).toBe(true);
    await act(async () => { pending.resolve(serverResult()); expect(await calculation).toBe(false); });
    expect(result.current.response).toBeNull();
    expect(analyzePlan).not.toHaveBeenCalled();
  });

  it('aborts and ignores stale LLM explanations on edits even after undo and a fresh calculation', async () => {
    const pending = deferred<AnalyzedPlan>();
    vi.mocked(analyzePlan).mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(({ plan }) => useScenario(plan), { initialProps: { plan: examplePlan } });
    await act(async () => { await result.current.calculate(); });
    const signal = vi.mocked(analyzePlan).mock.calls[0][1]!;
    rerender({ plan: alternativePlan });
    expect(result.current.response).toBeNull();
    expect(result.current.analysis).toBeNull();
    rerender({ plan: examplePlan });
    expect(signal.aborted).toBe(true);
    await act(async () => { await result.current.calculate(); });
    const stale = serverResult();
    stale.analysis.summary = 'Устаревшее объяснение';
    await act(async () => pending.resolve(stale));
    expect(result.current.analysis?.summary).toBe(serverResult().analysis.summary);
  });

  it('revalidates before every new calculation, including an invalid recommended plan', async () => {
    const { result } = renderHook(() => useScenario(examplePlan.slice(1)));
    await act(async () => expect(await result.current.calculate()).toBe(false));
    expect(result.current.error).toContain('5');
    expect(verifyCatalog).not.toHaveBeenCalled();
    expect(simulatePlan).not.toHaveBeenCalled();
  });
});
