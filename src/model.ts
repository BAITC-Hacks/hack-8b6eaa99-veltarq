import type { DistrictId } from './data';
import {
  BASE_INDICATORS, DISTRICT_IDS, DIRECTION_LABELS, INDICATORS, INDICATOR_KEYS,
  POPULATION_SHARES, measureById,
  type CityIndicators, type Direction, type IndicatorKey, type MeasureId, type PlanItem,
} from './modelData';

export type { PlanItem } from './modelData';
export const SCENARIO_QUARTERS = 8;
export const PLAN_BUDGET = 100;
export const PLAN_SIZE = 5;

export type ValidationIssueCode = 'plan' | 'count' | 'measure' | 'target' | 'duplicate' | 'budget' | 'direction' | 'incompatibility';
export type ValidationIssue = { code: ValidationIssueCode; message: string };
export type ValidationResult = { valid: boolean; issues: ValidationIssue[]; cost: number; count: number };
export type ScenarioResult = {
  indicators: CityIndicators;
  districtIndices: Record<DistrictId, number>;
  criticalCount: number;
  weightedIndex: number;
  minIndex: number;
  score: number;
};

const districtIds = new Set<string>(DISTRICT_IDS);
const localIncompatibilities: readonly (readonly [MeasureId, MeasureId])[] = [['M4', 'M7'], ['M5', 'M13']];

/** Validate runtime input too: localStorage may contain stale or manually edited data. */
export function validatePlan(plan: readonly PlanItem[], options: { complete?: boolean } = {}): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!Array.isArray(plan)) {
    return { valid: false, issues: [{ code: 'plan', message: 'План должен быть списком мероприятий.' }], cost: 0, count: 0 };
  }
  const count = plan.length;
  if (options.complete !== false ? count !== PLAN_SIZE : count > PLAN_SIZE) {
    issues.push({ code: 'count', message: options.complete !== false ? 'Для итогового расчёта выберите ровно 5 мероприятий.' : 'В плане может быть не более 5 мероприятий.' });
  }
  let cost = 0;
  const seen = new Map<MeasureId, PlanItem>();
  const directionCounts = new Map<Direction, number>();
  for (const item of plan) {
    const measure = item && typeof item === 'object' ? measureById.get(item.measureId) : undefined;
    if (!measure) {
      issues.push({ code: 'measure', message: 'В плане обнаружено неизвестное мероприятие.' });
      continue;
    }
    cost += measure.cost;
    if (seen.has(measure.id)) {
      issues.push({ code: 'duplicate', message: `${measure.id} уже есть в плане: повторы не допускаются.` });
    } else {
      seen.set(measure.id, item);
    }
    directionCounts.set(measure.direction, (directionCounts.get(measure.direction) ?? 0) + 1);
    if (measure.scope === 'district' && (typeof item.districtId !== 'string' || !districtIds.has(item.districtId))) {
      issues.push({ code: 'target', message: `Для ${measure.id} выберите один из пяти игровых районов.` });
    } else if (measure.scope === 'city' && item.districtId !== null) {
      issues.push({ code: 'target', message: `${measure.id} действует на весь город: целевой район не указывается.` });
    }
  }
  if (cost > PLAN_BUDGET) issues.push({ code: 'budget', message: `Бюджет превышен: ${cost} из ${PLAN_BUDGET}.` });
  for (const [direction, directionCount] of directionCounts) {
    if (directionCount > 2) issues.push({ code: 'direction', message: `В направлении «${DIRECTION_LABELS[direction]}» допускается не более 2 мероприятий.` });
  }
  if (seen.has('M1') && seen.has('M3')) issues.push({ code: 'incompatibility', message: 'M1 и M3 несовместимы в одном плане, даже в разных районах.' });
  for (const [first, second] of localIncompatibilities) {
    const firstItem = seen.get(first);
    const secondItem = seen.get(second);
    if (firstItem && secondItem && firstItem.districtId === secondItem.districtId) {
      issues.push({ code: 'incompatibility', message: `${first} и ${second} несовместимы в одном районе.` });
    }
  }
  return { valid: issues.length === 0, issues, cost, count };
}

export function clampIndicator(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Показатель должен быть конечным числом.');
  return Math.max(0, Math.min(100, value));
}

function mapIndicators(mapValue: (district: DistrictId, key: IndicatorKey) => number): CityIndicators {
  return Object.fromEntries(DISTRICT_IDS.map((district) => [
    district, Object.fromEntries(INDICATOR_KEYS.map((key) => [key, mapValue(district, key)])),
  ])) as CityIndicators;
}

/** Port of audit_model.py: accumulate and score in eighths, round only when formatting UI. */
function scoreEighths(rawState: CityIndicators): ScenarioResult {
  const eighths = mapIndicators((district, key) => clampIndicator(rawState[district][key] / 8) * 8);
  const districtWeighted = Object.fromEntries(DISTRICT_IDS.map((district) => [
    district, INDICATORS.reduce((sum, indicator) => sum + eighths[district][indicator.key] * indicator.weight, 0),
  ])) as Record<DistrictId, number>;
  let criticalCount = 0;
  for (const district of DISTRICT_IDS) {
    for (const key of INDICATOR_KEYS) if (eighths[district][key] < 320) criticalCount += 1;
  }
  // Population shares become exact integer percentages for the audit's numerator.
  const populationWeighted = DISTRICT_IDS.reduce((sum, district) => sum + districtWeighted[district] * Math.round(POPULATION_SHARES[district] * 100), 0);
  const minimumWeighted = Math.min(...DISTRICT_IDS.map((district) => districtWeighted[district]));
  const numerator = 7 * populationWeighted + 300 * minimumWeighted - 800000 * criticalCount;
  return {
    indicators: mapIndicators((district, key) => eighths[district][key] / 8),
    districtIndices: Object.fromEntries(DISTRICT_IDS.map((district) => [district, districtWeighted[district] / 800])) as Record<DistrictId, number>,
    criticalCount,
    weightedIndex: populationWeighted / 80000,
    minIndex: minimumWeighted / 800,
    score: numerator / 800000,
  };
}

/** Pure scoring helper; clamps each indicator before indices and strict-below-40 penalties. */
export function scoreIndicators(indicators: CityIndicators): ScenarioResult {
  return scoreEighths(mapIndicators((district, key) => indicators[district][key] * 8));
}

/** Partial plans are supported for previews. Business-rule validation remains separate. */
export function calculateEffects(plan: readonly PlanItem[]): ScenarioResult {
  const structuralIssues = validatePlan(plan, { complete: false }).issues.filter((issue) =>
    ['plan', 'measure', 'target', 'duplicate'].includes(issue.code),
  );
  if (structuralIssues.length) throw new Error(structuralIssues.map((issue) => issue.message).join(' '));
  const state = mapIndicators((district, key) => BASE_INDICATORS[district][key] * 8);
  for (const item of plan) {
    const measure = measureById.get(item.measureId)!;
    const targets = measure.scope === 'city' ? DISTRICT_IDS : [item.districtId!];
    for (const district of targets) {
      for (const key of INDICATOR_KEYS) state[district][key] += (measure.effects[key] ?? 0) * (SCENARIO_QUARTERS - measure.lag);
    }
  }
  const selected = new Map(plan.map((item) => [item.measureId, item]));
  const synergies: readonly (readonly [MeasureId, MeasureId, IndicatorKey])[] = [
    ['M1', 'M2', 'T1'], ['M10', 'M12', 'B1'], ['M5', 'M6', 'E2'],
  ];
  for (const [districtMeasure, cityMeasure, key] of synergies) {
    const target = selected.get(districtMeasure)?.districtId;
    if (target && selected.has(cityMeasure)) state[target][key] += 2 * 8;
  }
  return scoreEighths(state);
}

/** The only route to an eligible final scenario; incomplete/invalid plans have no result. */
export function calculatePlan(plan: readonly PlanItem[]): ScenarioResult | null {
  return validatePlan(plan).valid ? calculateEffects(plan) : null;
}

export const BASELINE: ScenarioResult = calculateEffects([]);
