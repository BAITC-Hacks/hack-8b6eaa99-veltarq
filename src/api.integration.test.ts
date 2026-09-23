import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzePlan, comparePlans, recommendPlans, simulatePlan, verifyCatalog } from './api';
import { calculatePlan } from './model';
import type { PlanItem } from './modelData';

const example: PlanItem[] = [
  { measureId: 'M7', districtId: 'Нура' }, { measureId: 'M8', districtId: 'Нура' },
  { measureId: 'M10', districtId: 'Нура' }, { measureId: 'M12', districtId: null },
  { measureId: 'M5', districtId: 'Сарыарка' },
];

describe.skipIf(!import.meta.env.VITE_TEST_API_URL)('real FastAPI / frontend contract', () => {
  beforeEach(() => vi.stubEnv('VITE_API_BASE_URL', import.meta.env.VITE_TEST_API_URL));
  afterEach(() => vi.unstubAllEnvs());

  it('agrees on every district, measure, weight, rule and synergy', async () => {
    await expect(verifyCatalog()).resolves.toBeUndefined();
  });

  it('returns the PDF example and agrees with the catalog preview for all fifty metrics', async () => {
    const simulation = await simulatePlan(example);
    const response = await analyzePlan(example);
    expect(response.simulation).toEqual(simulation.simulation);
    expect(response.result.score).toBe(56.54307);
    expect(response.simulation.score.score_before).toBe(52.55768);
    expect(response.simulation.budget_used).toBe(95);
    expect(response.result).toEqual(calculatePlan(example));
    expect(response.analysis.summary).toBeTruthy();
    expect(response.analysis.provider).toBe('deterministic_fallback');
    expect(response.analysis.fallback_reason).toBe('not_configured');
    expect(response.analysis.fact_refs?.summary.length).toBeGreaterThan(0);
    expect(response.simulation.activated_synergies).toContain('M10+M12');
  });

  it('recommends an improvement that can be compared and recalculated by the same server', async () => {
    const recommendations = await recommendPlans(example);
    expect(recommendations.candidates.length).toBeGreaterThan(0);
    const candidate = recommendations.candidates[0];
    const comparison = await comparePlans(example, candidate.plan);
    const applied = await simulatePlan(candidate.plan);
    const explanation = await analyzePlan(candidate.plan);
    expect(comparison.betterScenario).toBe('second');
    expect(comparison.second.score).toBe(candidate.score);
    expect(applied.result.score).toBe(candidate.score);
    expect(explanation.simulation).toEqual(applied.simulation);
    expect(comparison.analysis.provider).toBe('deterministic_fallback');
    expect(comparison.analysis.fallback_reason).toBe('not_configured');
    expect(comparison.analysis.fact_refs?.summary.length).toBeGreaterThan(0);
    expect(candidate.score).toBeCloseTo(calculatePlan(candidate.plan)!.score, 6);
  });
});
