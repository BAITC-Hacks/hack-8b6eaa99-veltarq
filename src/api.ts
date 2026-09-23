import type { DistrictId } from './data';
import { PLAN_BUDGET, PLAN_SIZE, SCENARIO_QUARTERS, validatePlan, type ScenarioResult } from './model';
import {
  BASE_INDICATORS, DISTRICT_IDS, INDICATORS, INDICATOR_KEYS, MEASURES, POPULATION_SHARES, measureById,
  type CityIndicators, type Direction, type IndicatorKey, type Indicators, type MeasureId, type PlanItem,
} from './modelData';

export const API_TIMEOUT_MS = 45_000;
const DATASET_VERSION = '1.0.0';
export const DISTRICT_API_IDS: Record<DistrictId, string> = {
  Есиль: 'esil', Алматы: 'almaty', Сарыарка: 'saryarka', Байконур: 'baikonur', Нура: 'nura',
};
const districtNames = new Map(Object.entries(DISTRICT_API_IDS).map(([name, id]) => [id, name as DistrictId]));
const directions: Record<Direction, string> = { T: 'transport', E: 'ecology', S: 'social', B: 'safety', C: 'services' };

export type BackendDecision = { measure_id: MeasureId; district_id: string | null };
export type BackendSimulation = {
  dataset_version: string;
  horizon_quarters: number;
  budget_used: number;
  budget_remaining: number;
  decisions: BackendDecision[];
  districts: Array<{
    district_id: string; district_name: string; population_share: number;
    score_before: number; score_after: number; score_delta: number;
    indicators: Array<{ code: IndicatorKey; before: number; after: number; delta: number }>;
  }>;
  contributions: Array<{
    source: string; source_type: 'measure' | 'synergy'; district_id: string; indicator_code: IndicatorKey; delta: number;
  }>;
  activated_synergies: string[];
  score: {
    city_average_before: number; city_average_after: number;
    weakest_district_before: number; weakest_district_after: number;
    critical_count_before: number; critical_count_after: number;
    score_before: number; score_after: number; score_delta: number;
  };
};
export type AnalysisResult = {
  provider: string; summary: string; strengths: string[]; risks: string[];
  tradeoffs: string[]; recommendations: string[]; facts: Record<string, unknown>;
  fallback_reason?: string | null; fact_refs?: Record<string, string[]>;
};
export type SimulatedPlan = { simulation: BackendSimulation; result: ScenarioResult };
export type AnalyzedPlan = { simulation: BackendSimulation; analysis: AnalysisResult; result: ScenarioResult };
export type RecommendedPlan = {
  plan: PlanItem[]; score: number; improvement: number; budgetUsed: number; budgetRemaining: number;
};
export type RecommendationsResult = { currentScore: number; candidates: RecommendedPlan[] };
export type ComparisonResult = {
  explanation: string; scoreDifference: number; betterScenario: 'first' | 'second' | 'equal';
  first: ScenarioResult; second: ScenarioResult;
  analysis: AnalysisResult;
};
export class ApiError extends Error {
  constructor(message: string, public readonly code: 'network' | 'timeout' | 'http' | 'response' | 'catalog', public readonly status?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

function requireValue(condition: unknown): asserts condition {
  if (!condition) throw new ApiError('Сервер вернул неполные или некорректные данные. Повторите расчёт.', 'response');
}
function record(value: unknown): Record<string, unknown> {
  requireValue(typeof value === 'object' && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] { requireValue(Array.isArray(value)); return value; }
function string(value: unknown): string { requireValue(typeof value === 'string' && value.trim().length > 0); return value; }
function strings(value: unknown): string[] { return array(value).map(string); }
function finite(value: unknown, minimum = -Infinity, maximum = Infinity): number {
  requireValue(typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum);
  return value;
}
function integer(value: unknown, minimum: number, maximum: number): number {
  const result = finite(value, minimum, maximum);
  requireValue(Number.isInteger(result));
  return result;
}
function district(value: unknown): DistrictId {
  const id = districtNames.get(string(value));
  requireValue(id);
  return id;
}
function indicator(value: unknown): IndicatorKey {
  requireValue(typeof value === 'string' && (INDICATOR_KEYS as readonly string[]).includes(value));
  return value as IndicatorKey;
}
function measure(value: unknown): MeasureId {
  requireValue(typeof value === 'string' && measureById.has(value as MeasureId));
  return value as MeasureId;
}

function requestPlan(plan: readonly PlanItem[]): { decisions: BackendDecision[] } {
  return { decisions: plan.map((item) => {
    const id = measure(item.measureId);
    requireValue(item.districtId === null || Object.hasOwn(DISTRICT_API_IDS, item.districtId));
    return { measure_id: id, district_id: item.districtId === null ? null : DISTRICT_API_IDS[item.districtId] };
  }) };
}
function responsePlan(value: unknown): PlanItem[] {
  const plan = array(value).map((raw) => {
    const item = record(raw);
    return { measureId: measure(item.measure_id), districtId: item.district_id === null ? null : district(item.district_id) };
  });
  requireValue(validatePlan(plan).valid);
  return plan;
}
function samePlan(first: readonly PlanItem[], second: readonly PlanItem[]): boolean {
  const key = (plan: readonly PlanItem[]) => plan.map((item) => `${item.measureId}:${item.districtId ?? ''}`).sort().join('|');
  return key(first) === key(second);
}
function budget(data: Record<string, unknown>, plan: readonly PlanItem[]) {
  const used = integer(data.budget_used, 0, PLAN_BUDGET);
  const remaining = integer(data.budget_remaining, 0, PLAN_BUDGET);
  requireValue(used + remaining === PLAN_BUDGET && used === validatePlan(plan).cost);
  return { used, remaining };
}

function httpMessage(payload: unknown, status: number): string {
  if (status === 422) {
    const detail = payload && typeof payload === 'object' ? (payload as Record<string, unknown>).detail : null;
    const issues = Array.isArray(detail) ? detail.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const value = item.message ?? item.msg;
      return typeof value === 'string' ? [value] : [];
    }) : typeof detail === 'string' ? [detail] : [];
    return `Сервер отклонил план.${issues.length ? ' ' + issues.join(' ') : ' Проверьте выбранные мероприятия и районы.'}`;
  }
  if (status === 404) return 'Сервис расчёта не найден. Проверьте адрес подключения к серверу.';
  if (status === 429) return 'Сервис временно перегружен запросами. Повторите попытку немного позже.';
  return 'Сервис расчёта временно недоступен. Повторите попытку позже.';
}
async function request(path: string, body: unknown | undefined, signal?: AbortSignal): Promise<unknown> {
  if (signal?.aborted) throw new DOMException('Запрос отменён.', 'AbortError');
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, API_TIMEOUT_MS);
  try {
    const base = (import.meta.env.VITE_API_BASE_URL?.trim() || '/api/v1').replace(/\/+$/, '');
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    let payload: unknown;
    try { payload = await response.json(); } catch {
      if (!response.ok) throw new ApiError(httpMessage(null, response.status), 'http', response.status);
      throw new ApiError('Сервер вернул ответ в неподдерживаемом формате. Повторите попытку.', 'response');
    }
    controller.signal.throwIfAborted();
    if (!response.ok) throw new ApiError(httpMessage(payload, response.status), 'http', response.status);
    return payload;
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Запрос отменён.', 'AbortError');
    if (timedOut) throw new ApiError('Сервер не ответил вовремя. Повторите попытку.', 'timeout');
    if (error instanceof ApiError) throw error;
    throw new ApiError('Не удалось связаться с сервером. Проверьте подключение и повторите попытку.', 'network');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function parseSimulation(raw: unknown, expectedPlan: readonly PlanItem[]): { simulation: BackendSimulation; result: ScenarioResult } {
  const data = record(raw);
  requireValue(data.dataset_version === DATASET_VERSION && data.horizon_quarters === SCENARIO_QUARTERS);
  const plan = responsePlan(data.decisions);
  requireValue(samePlan(plan, expectedPlan));
  budget(data, plan);
  const districtRows = array(data.districts);
  requireValue(districtRows.length === DISTRICT_IDS.length);
  const indicators = {} as CityIndicators;
  const districtIndices = {} as Record<DistrictId, number>;
  for (const rawDistrict of districtRows) {
    const row = record(rawDistrict);
    const name = district(row.district_id);
    requireValue(!Object.hasOwn(indicators, name));
    string(row.district_name);
    requireValue(row.population_share === POPULATION_SHARES[name]);
    finite(row.score_before, 0, 100);
    districtIndices[name] = finite(row.score_after, 0, 100);
    finite(row.score_delta, -100, 100);
    const values = {} as Indicators;
    const metricRows = array(row.indicators);
    requireValue(metricRows.length === INDICATOR_KEYS.length);
    for (const rawMetric of metricRows) {
      const metric = record(rawMetric);
      const code = indicator(metric.code);
      requireValue(!Object.hasOwn(values, code) && metric.before === BASE_INDICATORS[name][code]);
      values[code] = finite(metric.after, 0, 100);
      finite(metric.delta, -100, 100);
    }
    indicators[name] = values;
  }
  const synergies = strings(data.activated_synergies);
  requireValue(new Set(synergies).size === synergies.length && synergies.every((id) => ['M1+M2', 'M10+M12', 'M5+M6'].includes(id)));
  for (const rawContribution of array(data.contributions)) {
    const contribution = record(rawContribution);
    district(contribution.district_id);
    indicator(contribution.indicator_code);
    finite(contribution.delta, -100, 100);
    requireValue(contribution.source_type === 'measure' || contribution.source_type === 'synergy');
    if (contribution.source_type === 'measure') requireValue(plan.some((item) => item.measureId === measure(contribution.source)));
    else requireValue(synergies.includes(string(contribution.source)));
  }
  const score = record(data.score);
  for (const key of ['city_average_before', 'city_average_after', 'weakest_district_before', 'weakest_district_after']) finite(score[key], 0, 100);
  integer(score.critical_count_before, 0, 50);
  const criticalCount = integer(score.critical_count_after, 0, 50);
  finite(score.score_before, -50, 100);
  const finalScore = finite(score.score_after, -50, 100);
  finite(score.score_delta, -150, 150);
  // The server owns calculation. This adapter validates the schema and copies its values.
  return {
    simulation: data as unknown as BackendSimulation,
    result: { indicators, districtIndices, criticalCount, weightedIndex: score.city_average_after as number, minIndex: score.weakest_district_after as number, score: finalScore },
  };
}

function parseAnalysis(raw: unknown): AnalysisResult {
  const rawAnalysis = record(raw);
  requireValue(['llm', 'deterministic', 'deterministic_fallback'].includes(string(rawAnalysis.provider)));
  const analysis: AnalysisResult = {
    provider: string(rawAnalysis.provider), summary: string(rawAnalysis.summary),
    strengths: strings(rawAnalysis.strengths), risks: strings(rawAnalysis.risks), tradeoffs: strings(rawAnalysis.tradeoffs),
    recommendations: strings(rawAnalysis.recommendations), facts: record(rawAnalysis.facts),
  };
  if (rawAnalysis.fallback_reason !== undefined) analysis.fallback_reason = rawAnalysis.fallback_reason === null ? null : string(rawAnalysis.fallback_reason);
  if (rawAnalysis.fact_refs !== undefined) analysis.fact_refs = Object.fromEntries(Object.entries(record(rawAnalysis.fact_refs)).map(([key, refs]) => [key, strings(refs)]));
  return analysis;
}

export async function simulatePlan(plan: readonly PlanItem[], signal?: AbortSignal): Promise<SimulatedPlan> {
  return parseSimulation(await request('/scenarios/simulate', requestPlan(plan), signal), plan);
}

export async function analyzePlan(plan: readonly PlanItem[], signal?: AbortSignal): Promise<AnalyzedPlan> {
  const data = record(await request('/scenarios/analyze', requestPlan(plan), signal));
  return { ...parseSimulation(data.simulation, plan), analysis: parseAnalysis(data.analysis) };
}

export async function recommendPlans(plan: readonly PlanItem[], signal?: AbortSignal): Promise<RecommendationsResult> {
  const data = record(await request('/scenarios/recommend', requestPlan(plan), signal));
  const candidates = array(data.candidates).map((raw): RecommendedPlan => {
    const candidate = record(raw);
    const candidatePlan = responsePlan(candidate.decisions);
    const { used, remaining } = budget(candidate, candidatePlan);
    return {
      plan: candidatePlan, score: finite(candidate.score, -50, 100), improvement: finite(candidate.improvement, 0, 150),
      budgetUsed: used, budgetRemaining: remaining,
    };
  });
  return { currentScore: finite(data.current_score, -50, 100), candidates };
}

export async function comparePlans(first: readonly PlanItem[], second: readonly PlanItem[], signal?: AbortSignal): Promise<ComparisonResult> {
  const data = record(await request('/scenarios/compare', { first: requestPlan(first), second: requestPlan(second) }, signal));
  requireValue(data.better_scenario === 'first' || data.better_scenario === 'second' || data.better_scenario === 'equal');
  return {
    explanation: string(data.explanation), scoreDifference: finite(data.score_difference, 0, 150), betterScenario: data.better_scenario,
    first: parseSimulation(data.first, first).result, second: parseSimulation(data.second, second).result,
    analysis: parseAnalysis(data.analysis),
  };
}

function keyed(values: unknown, key: string, count: number): Map<string, Record<string, unknown>> {
  const entries = array(values).map((value) => { const item = record(value); return [string(item[key]), item] as const; });
  const map = new Map(entries);
  requireValue(entries.length === count && map.size === count);
  return map;
}
function sameNumbers(actual: unknown, expected: Record<string, number | undefined>) {
  const values = record(actual);
  requireValue(Object.keys(values).length === Object.keys(expected).length);
  for (const [key, value] of Object.entries(expected)) requireValue(Object.hasOwn(values, key) && values[key] === value);
}

/** Ensure local previews and server calculations use the same supplied task dataset. */
export async function verifyCatalog(signal?: AbortSignal): Promise<void> {
  const payload = await request('/catalog', undefined, signal);
  try {
    const data = record(payload);
    requireValue(data.dataset_version === DATASET_VERSION);
    const rules = record(data.rules);
    requireValue(rules.budget === PLAN_BUDGET && rules.decision_count === PLAN_SIZE && rules.horizon_quarters === SCENARIO_QUARTERS && rules.max_measures_per_direction === 2);
    const remoteIndicators = keyed(data.indicators, 'code', INDICATORS.length);
    for (const item of INDICATORS) {
      const remote = remoteIndicators.get(item.key);
      requireValue(remote && remote.weight === item.weight / 100 && remote.direction === directions[item.direction]);
    }
    const remoteDistricts = keyed(data.districts, 'id', DISTRICT_IDS.length);
    for (const name of DISTRICT_IDS) {
      const remote = remoteDistricts.get(DISTRICT_API_IDS[name]);
      requireValue(remote && remote.population_share === POPULATION_SHARES[name]);
      sameNumbers(remote.indicators, BASE_INDICATORS[name]);
    }
    const remoteMeasures = keyed(data.measures, 'id', MEASURES.length);
    for (const item of MEASURES) {
      const remote = remoteMeasures.get(item.id);
      requireValue(remote && remote.direction === directions[item.direction] && remote.scope === item.scope && remote.cost === item.cost && remote.lag === item.lag && remote.realization_factor === (SCENARIO_QUARTERS - item.lag) / SCENARIO_QUARTERS);
      sameNumbers(remote.effects, item.effects);
    }
    const synergies = array(data.synergies);
    const expectedSynergies = ['M1+M2:T1', 'M10+M12:B1', 'M5+M6:E2'];
    const actualSynergies = synergies.map((raw) => {
      const item = record(raw);
      requireValue(item.bonus === 2 && item.target === 'district_of_first_measure');
      return `${strings(item.measures).join('+')}:${string(item.indicator_code)}`;
    });
    requireValue(actualSynergies.length === 3 && new Set(actualSynergies).size === 3 && expectedSynergies.every((item) => actualSynergies.includes(item)));
    const expectedConflicts = ['M1+M3:global', 'M4+M7:same_district', 'M13+M5:same_district'];
    const actualConflicts = array(data.conflicts).map((raw) => {
      const item = record(raw);
      return `${strings(item.measures).sort().join('+')}:${string(item.scope)}`;
    });
    requireValue(actualConflicts.length === 3 && new Set(actualConflicts).size === 3 && expectedConflicts.every((item) => actualConflicts.includes(item)));
  } catch {
    throw new ApiError('Данные и правила сервера отличаются от задания на сайте. Расчёт остановлен до согласования версий.', 'catalog');
  }
}
