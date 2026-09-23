import type { AnalyzedPlan, BackendSimulation } from './api';
import { DISTRICT_API_IDS } from './api';
import { BASELINE, calculateEffects, validatePlan } from './model';
import { DISTRICT_IDS, INDICATOR_KEYS, POPULATION_SHARES, type PlanItem } from './modelData';

export const examplePlan: PlanItem[] = [
  { measureId: 'M7', districtId: 'Нура' }, { measureId: 'M8', districtId: 'Нура' },
  { measureId: 'M10', districtId: 'Нура' }, { measureId: 'M12', districtId: null },
  { measureId: 'M5', districtId: 'Сарыарка' },
];
export const alternativePlan: PlanItem[] = examplePlan.map((item) => item.measureId === 'M5' ? { measureId: 'M6', districtId: null } : { ...item });

/** Engine-shaped fixtures only for tests. Runtime scenario rendering never calls this local model. */
export function serverResult(plan: readonly PlanItem[] = examplePlan): AnalyzedPlan {
  const result = calculateEffects(plan);
  const cost = validatePlan(plan).cost;
  const simulation: BackendSimulation = {
    dataset_version: '1.0.0', horizon_quarters: 8, budget_used: cost, budget_remaining: 100 - cost,
    decisions: plan.map((item) => ({ measure_id: item.measureId, district_id: item.districtId ? DISTRICT_API_IDS[item.districtId] : null })),
    activated_synergies: [], contributions: [],
    districts: DISTRICT_IDS.map((name) => ({
      district_id: DISTRICT_API_IDS[name], district_name: name, population_share: POPULATION_SHARES[name],
      score_before: BASELINE.districtIndices[name], score_after: result.districtIndices[name], score_delta: result.districtIndices[name] - BASELINE.districtIndices[name],
      indicators: INDICATOR_KEYS.map((code) => ({ code, before: BASELINE.indicators[name][code], after: result.indicators[name][code], delta: result.indicators[name][code] - BASELINE.indicators[name][code] })),
    })),
    score: {
      city_average_before: BASELINE.weightedIndex, city_average_after: result.weightedIndex,
      weakest_district_before: BASELINE.minIndex, weakest_district_after: result.minIndex,
      critical_count_before: BASELINE.criticalCount, critical_count_after: result.criticalCount,
      score_before: BASELINE.score, score_after: result.score, score_delta: result.score - BASELINE.score,
    },
  };
  return { result, simulation, analysis: { provider: 'llm', summary: 'Проверенное объяснение рассчитанного сценария.', strengths: ['Улучшились показатели Нуры.'], risks: [], tradeoffs: ['Остаются ограничения бюджета.'], recommendations: ['Сравните найденные улучшения.'], facts: {} } };
}
