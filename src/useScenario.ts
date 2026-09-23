import { useCallback, useEffect, useRef, useState } from 'react';
import { analyzePlan, simulatePlan, verifyCatalog } from './api';
import type { AnalysisResult, BackendSimulation, SimulatedPlan } from './api';
import { delta, number } from './format';
import { validatePlan } from './model';
import type { PlanItem } from './modelData';

type State = {
  key: string; loading: boolean; response: SimulatedPlan | null; error: string | null;
  analysis: AnalysisResult | null; analysisLoading: boolean; analysisError: string | null;
};
const emptyState: State = { key: '', loading: false, response: null, error: null, analysis: null, analysisLoading: false, analysisError: null };

/** Only presents values already supplied by the calculation service; never simulates a plan. */
function automaticExplanation(simulation: BackendSimulation): AnalysisResult {
  const benefited = simulation.districts.filter((district) => district.score_delta > 0);
  const critical = simulation.districts.flatMap((district) => district.indicators.filter((item) => item.after < 40).map((item) => `${district.district_name}: ${item.code} — ${number(item.after)}.`));
  const regressions = simulation.districts.flatMap((district) => district.indicators.filter((item) => item.delta < 0).map((item) => `${district.district_name}: ${item.code} ${delta(item.delta)}.`));
  return {
    provider: 'deterministic_fallback', fallback_reason: 'request_failed',
    summary: `Score: ${number(simulation.score.score_before, 5)} → ${number(simulation.score.score_after, 5)}; изменение ${delta(simulation.score.score_delta, 5)}.`,
    strengths: benefited.map((district) => `${district.district_name}: индекс района ${number(district.score_before, 5)} → ${number(district.score_after, 5)}.`),
    risks: critical.length ? critical : ['Критических показателей после расчёта не осталось.'],
    tradeoffs: [`Бюджет: потрачено ${number(simulation.budget_used)}, осталось ${number(simulation.budget_remaining)}.`, ...regressions],
    recommendations: ['Сравните найденные улучшения по серверному расчёту.'], facts: {},
  };
}

/** Each request belongs to one plan revision, including when edits are undone. */
export function useScenario(plan: readonly PlanItem[]) {
  const key = JSON.stringify(plan);
  const currentKey = useRef(key);
  currentKey.current = key;
  const revision = useRef(0);
  const request = useRef<AbortController | null>(null);
  const analysisRequest = useRef<AbortController | null>(null);
  const [state, setState] = useState<State>(emptyState);

  const reset = useCallback(() => {
    revision.current += 1;
    request.current?.abort();
    analysisRequest.current?.abort();
    request.current = null;
    analysisRequest.current = null;
    setState(emptyState);
  }, []);

  useEffect(() => {
    reset();
    return () => {
      revision.current += 1;
      request.current?.abort();
      analysisRequest.current?.abort();
    };
  }, [key, reset]);

  const explain = useCallback(async (response: SimulatedPlan, id: number) => {
    analysisRequest.current?.abort();
    const controller = new AbortController();
    analysisRequest.current = controller;
    const active = () => !controller.signal.aborted && id === revision.current && key === currentKey.current;
    setState((previous) => ({ ...previous, analysisLoading: true, analysisError: null }));
    try {
      const analyzed = await analyzePlan(plan, controller.signal);
      if (!active()) return;
      // An explanation may not silently replace the simulation currently shown to the user.
      if (JSON.stringify(analyzed.simulation) !== JSON.stringify(response.simulation)) throw new Error('Данные объяснения не совпали с расчётом. Повторите запрос объяснения.');
      setState((previous) => ({ ...previous, analysis: analyzed.analysis, analysisLoading: false }));
    } catch (error) {
      if (!active()) return;
      setState((previous) => ({ ...previous, analysisLoading: false, analysis: automaticExplanation(response.simulation), analysisError: error instanceof Error ? error.message : 'Не удалось получить объяснение. Повторите запрос.' }));
    } finally {
      if (analysisRequest.current === controller) analysisRequest.current = null;
    }
  }, [key, plan]);

  const calculate = useCallback(async (): Promise<boolean> => {
    request.current?.abort();
    analysisRequest.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const id = ++revision.current;
    const active = () => !controller.signal.aborted && id === revision.current && key === currentKey.current;
    setState({ ...emptyState, key, loading: true });
    try {
      const validation = validatePlan(plan);
      if (!validation.valid) throw new Error(validation.issues.map((issue) => issue.message).join(' '));
      await verifyCatalog(controller.signal);
      if (!active()) return false;
      const response = await simulatePlan(plan, controller.signal);
      if (!active()) return false;
      setState({ ...emptyState, key, response });
      void explain(response, id);
      return true;
    } catch (error) {
      if (!active()) return false;
      setState({ ...emptyState, key, error: error instanceof Error ? error.message : 'Не удалось рассчитать сценарий. Попробуйте ещё раз.' });
      return false;
    } finally {
      if (request.current === controller) request.current = null;
    }
  }, [key, plan, explain]);

  const visible = state.key === key ? state : emptyState;
  const retryAnalysis = useCallback(() => {
    if (state.key === key && state.response) void explain(state.response, revision.current);
  }, [state.key, state.response, key, explain]);
  return { ...visible, calculate, reset, retryAnalysis };
}
