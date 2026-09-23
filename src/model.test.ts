import { describe, expect, it } from 'vitest';
import auditResults from './test-fixtures/audit_results.json';
import type { DistrictId } from './data';
import {
  BASE_INDICATORS, DISTRICT_IDS, INDICATORS, INDICATOR_KEYS, MEASURES, POPULATION_SHARES,
  type CityIndicators, type IndicatorKey, type MeasureId, type PlanItem,
} from './modelData';
import { BASELINE, calculateEffects, calculatePlan, clampIndicator, scoreIndicators, validatePlan } from './model';

const item = (measureId: MeasureId, districtId: DistrictId | null = 'Нура'): PlanItem => ({ measureId, districtId });
const example: PlanItem[] = [item('M7'), item('M8'), item('M10'), item('M12', null), item('M5', 'Сарыарка')];
const codes = (plan: readonly PlanItem[], complete = false) => validatePlan(plan, { complete }).issues.map((issue) => issue.code);
const uniform = (value: number): CityIndicators => Object.fromEntries(DISTRICT_IDS.map((district) => [
  district, Object.fromEntries(INDICATOR_KEYS.map((key) => [key, value])),
])) as CityIndicators;

describe('reference arithmetic from analysis/audit_model.py', () => {
  const fixtures = [
    ['baseline', auditResults.baseline],
    ['PDF example', auditResults.pdf_example],
    ['best under PDF rules', auditResults.pdf_rules.best],
    ['best with all five directions', auditResults.all_five_directions.best],
  ] as const;

  it.each(fixtures)('matches all indicators, district indices and exact Score: %s', (_, fixture) => {
    const plan = fixture.decisions.map(([measureId, districtId]) => ({ measureId, districtId })) as PlanItem[];
    const result = calculateEffects(plan);
    expect(result.score).toBe(fixture.score);
    expect(result.criticalCount).toBe(fixture.critical_count);
    expect(result.districtIndices).toEqual(fixture.district_scores);
    for (const district of DISTRICT_IDS) {
      expect(INDICATOR_KEYS.map((key) => result.indicators[district][key])).toEqual(fixture.indicators[district]);
    }
    expect(validatePlan(plan, { complete: plan.length > 0 })).toMatchObject({ valid: true, cost: fixture.cost });
  });

  it('keeps the two required control scores exact', () => {
    expect(BASELINE.score).toBe(52.55768);
    expect(calculatePlan(example)?.score).toBe(56.54307);
  });

  it('uses the population shares rather than a mean of district indices', () => {
    expect(Object.values(POPULATION_SHARES).reduce((sum, value) => sum + value, 0)).toBe(1);
    expect(INDICATORS.reduce((sum, indicator) => sum + indicator.weight, 0)).toBe(100);
    expect(BASELINE.weightedIndex).toBe(56.8624);
    const weighted = DISTRICT_IDS.reduce((sum, district) => sum + BASELINE.districtIndices[district] * POPULATION_SHARES[district], 0);
    expect(BASELINE.weightedIndex).toBeCloseTo(weighted, 12);
    expect(BASELINE.score).toBeCloseTo(0.7 * weighted + 0.3 * BASELINE.minIndex - BASELINE.criticalCount, 12);
  });

  it('is independent of plan ordering', () => {
    expect(calculateEffects([...example].reverse())).toEqual(calculateEffects(example));
    const synergyPlan = [item('M1'), item('M2', null), item('M10'), item('M12', null)];
    expect(calculateEffects([...synergyPlan].reverse())).toEqual(calculateEffects(synergyPlan));
  });

  it.each(MEASURES)('applies the lag and correct scope for $id', (measure) => {
    const result = calculateEffects([item(measure.id, measure.scope === 'city' ? null : 'Нура')]);
    for (const district of DISTRICT_IDS) {
      for (const key of INDICATOR_KEYS) {
        const affected = measure.scope === 'city' || district === 'Нура';
        const effect = affected ? (measure.effects[key] ?? 0) * (8 - measure.lag) / 8 : 0;
        expect(result.indicators[district][key]).toBe(BASE_INDICATORS[district][key] + effect);
      }
    }
  });

  it.each<[MeasureId, MeasureId, IndicatorKey]>([['M1', 'M2', 'T1'], ['M10', 'M12', 'B1'], ['M5', 'M6', 'E2']])(
    'adds an unlagged +2 synergy for %s + %s in the district target only', (local, city, key) => {
      const one = calculateEffects([item(local, 'Алматы')]);
      const two = calculateEffects([item(city, null)]);
      const both = calculateEffects([item(local, 'Алматы'), item(city, null)]);
      for (const district of DISTRICT_IDS) {
        expect(both.indicators[district][key]).toBe(
          one.indicators[district][key] + two.indicators[district][key] - BASE_INDICATORS[district][key] + (district === 'Алматы' ? 2 : 0),
        );
      }
    },
  );

  it('does not mutate the plan, input indicators or baseline', () => {
    const planBefore = structuredClone(example);
    const baseBefore = structuredClone(BASE_INDICATORS);
    const result = calculateEffects(example);
    result.indicators.Нура.T1 = 100;
    expect(example).toEqual(planBefore);
    expect(BASE_INDICATORS).toEqual(baseBefore);
    expect(calculateEffects(example).indicators.Нура.T1).toBe(55);
    const input = uniform(101);
    scoreIndicators(input);
    expect(input).toEqual(uniform(101));
  });
});

describe('clipping and strict threshold penalties', () => {
  it('clamps before scoring to 0–100', () => {
    expect(clampIndicator(-10)).toBe(0);
    expect(clampIndicator(110)).toBe(100);
    expect(scoreIndicators(uniform(120))).toMatchObject({ score: 100, criticalCount: 0, minIndex: 100, indicators: uniform(100) });
    expect(scoreIndicators(uniform(-20))).toMatchObject({ score: -50, criticalCount: 50, minIndex: 0, indicators: uniform(0) });
  });

  it('penalizes strictly below 40 but not 40', () => {
    const state = uniform(40);
    expect(scoreIndicators(state)).toMatchObject({ score: 40, criticalCount: 0 });
    state.Нура.C2 = 39.875;
    expect(scoreIndicators(state)).toMatchObject({ score: 38.99485, criticalCount: 1 });
    state.Нура.C2 = 40.125;
    expect(scoreIndicators(state).criticalCount).toBe(0);
  });

  it.each([NaN, Infinity, -Infinity])('rejects non-finite value %s', (value) => {
    expect(() => clampIndicator(value)).toThrow();
    const state = uniform(40);
    state.Есиль.T1 = value;
    expect(() => scoreIndicators(state)).toThrow();
  });
});

describe('plan eligibility', () => {
  it('requires exactly five measures only for a final calculation', () => {
    expect(validatePlan([]).valid).toBe(false);
    expect(validatePlan([], { complete: false }).valid).toBe(true);
    expect(calculatePlan([])).toBeNull();
    expect(calculatePlan(example)).not.toBeNull();
    expect(codes([...example, item('M14', null)])).toContain('count');
    expect(calculatePlan([...example, item('M14', null)])).toBeNull();
  });

  it('accepts exactly 100 budget units and rejects 101', () => {
    const exact = [item('M3'), item('M6', null), item('M7'), item('M10'), item('M12', null)];
    const over = [item('M2', null), item('M4', 'Есиль'), item('M7'), item('M8'), item('M6', null)];
    expect(validatePlan(exact)).toMatchObject({ valid: true, cost: 100, count: 5 });
    expect(validatePlan(over).cost).toBe(101);
    expect(codes(over)).toContain('budget');
    expect(calculatePlan(over)).toBeNull();
  });

  it('forbids repeating an ID even when district targets differ', () => {
    expect(codes([item('M10'), item('M10', 'Есиль')])).toContain('duplicate');
    expect(() => calculateEffects([item('M10'), item('M10', 'Есиль')])).toThrow();
  });

  it('limits directions to two without requiring all five directions', () => {
    expect(codes([item('M7'), item('M8'), item('M9'), item('M10'), item('M12', null)])).toContain('direction');
    expect(validatePlan(example).valid).toBe(true);
  });

  it('forbids M1 + M3 across the entire city', () => {
    expect(codes([item('M1', 'Есиль'), item('M3', 'Нура')])).toContain('incompatibility');
  });

  it.each<[MeasureId, MeasureId]>([['M4', 'M7'], ['M5', 'M13']])('forbids %s + %s only in the same district', (first, second) => {
    expect(codes([item(first), item(second)])).toContain('incompatibility');
    expect(validatePlan([item(first, 'Есиль'), item(second, 'Нура')], { complete: false }).valid).toBe(true);
  });

  it.each([
    [{ measureId: 'M1', districtId: null }],
    [{ measureId: 'M1', districtId: 'Unknown' }],
    [{ measureId: 'M1', districtId: '__proto__' }],
    [{ measureId: 'M2', districtId: 'Нура' }],
    [{ measureId: 'M2' }],
  ])('rejects malformed target %#', (invalid) => {
    const plan = [invalid] as unknown as PlanItem[];
    expect(codes(plan)).toContain('target');
    expect(() => calculateEffects(plan)).toThrow();
  });

  it.each([[null], [{ measureId: 'M99', districtId: null }], [{ districtId: 'Нура' }], ['M1']])('rejects malformed measure %#', (invalid) => {
    const plan = [invalid] as unknown as PlanItem[];
    expect(codes(plan)).toContain('measure');
    expect(() => calculateEffects(plan)).toThrow();
  });

  it('rejects non-array runtime input without crashing validation', () => {
    const bad = null as unknown as PlanItem[];
    expect(validatePlan(bad)).toMatchObject({ valid: false, count: 0, cost: 0 });
    expect(() => calculateEffects(bad)).toThrow();
    expect(calculatePlan(bad)).toBeNull();
  });

  it('allows effect previews but never final results for business-rule violations', () => {
    const overDirection = [item('M7'), item('M8'), item('M9'), item('M10'), item('M12', null)];
    expect(calculateEffects(overDirection).score).toBeTypeOf('number');
    expect(calculatePlan(overDirection)).toBeNull();
  });
});
