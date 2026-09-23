import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  API_TIMEOUT_MS, DISTRICT_API_IDS, analyzePlan, simulatePlan, comparePlans, recommendPlans, verifyCatalog,
  type BackendSimulation,
} from './api';
import { BASELINE, calculatePlan, validatePlan } from './model';
import {
  BASE_INDICATORS, DISTRICT_IDS, INDICATORS, INDICATOR_KEYS, MEASURES, POPULATION_SHARES,
  type Direction, type PlanItem,
} from './modelData';

const plan: PlanItem[] = [
  { measureId: 'M7', districtId: 'Нура' }, { measureId: 'M8', districtId: 'Нура' },
  { measureId: 'M10', districtId: 'Нура' }, { measureId: 'M12', districtId: null },
  { measureId: 'M5', districtId: 'Сарыарка' },
];
const alternative = plan.map((item) => ({ ...item, districtId: item.measureId === 'M10' ? 'Есиль' as const : item.districtId }));
const wirePlan = (items = plan) => items.map((item) => ({ measure_id: item.measureId, district_id: item.districtId === null ? null : DISTRICT_API_IDS[item.districtId] }));
function simulation(items = plan): BackendSimulation {
  const result = calculatePlan(items)!;
  const cost = validatePlan(items).cost;
  return {
    dataset_version: '1.0.0', horizon_quarters: 8, budget_used: cost, budget_remaining: 100 - cost,
    decisions: wirePlan(items), activated_synergies: ['M10+M12'],
    contributions: [{ source: 'M10+M12', source_type: 'synergy', district_id: DISTRICT_API_IDS[items.find((item) => item.measureId === 'M10')!.districtId!], indicator_code: 'B1', delta: 2 }],
    districts: DISTRICT_IDS.map((name) => ({
      district_id: DISTRICT_API_IDS[name], district_name: name, population_share: POPULATION_SHARES[name],
      score_before: BASELINE.districtIndices[name], score_after: result.districtIndices[name],
      score_delta: result.districtIndices[name] - BASELINE.districtIndices[name],
      indicators: INDICATOR_KEYS.map((code) => ({ code, before: BASE_INDICATORS[name][code], after: result.indicators[name][code], delta: result.indicators[name][code] - BASE_INDICATORS[name][code] })),
    })),
    score: {
      city_average_before: BASELINE.weightedIndex, city_average_after: result.weightedIndex,
      weakest_district_before: BASELINE.minIndex, weakest_district_after: result.minIndex,
      critical_count_before: BASELINE.criticalCount, critical_count_after: result.criticalCount,
      score_before: BASELINE.score, score_after: result.score, score_delta: result.score - BASELINE.score,
    },
  };
}
function analyzed(items = plan) {
  return {
    simulation: simulation(items),
    analysis: { provider: 'deterministic', summary: 'Проверенное объяснение.', strengths: ['Соцсфера Нуры улучшилась.'], risks: [], tradeoffs: ['Бюджет 95.'], recommendations: ['Сравните альтернативу.'], facts: { critical_count: 0 } },
  };
}
function catalog() {
  const directions: Record<Direction, string> = { T: 'transport', E: 'ecology', S: 'social', B: 'safety', C: 'services' };
  return {
    dataset_version: '1.0.0', rules: { budget: 100, decision_count: 5, horizon_quarters: 8, max_measures_per_direction: 2 },
    districts: DISTRICT_IDS.map((name) => ({ id: DISTRICT_API_IDS[name], name, population_share: POPULATION_SHARES[name], indicators: { ...BASE_INDICATORS[name] } })),
    indicators: INDICATORS.map((item) => ({ code: item.key, name: item.name, weight: item.weight / 100, direction: directions[item.direction] })),
    measures: MEASURES.map((item) => ({ ...item, direction: directions[item.direction], realization_factor: (8 - item.lag) / 8, effects: { ...item.effects } })),
    synergies: [
      { measures: ['M1', 'M2'], indicator_code: 'T1', bonus: 2, target: 'district_of_first_measure' },
      { measures: ['M10', 'M12'], indicator_code: 'B1', bonus: 2, target: 'district_of_first_measure' },
      { measures: ['M5', 'M6'], indicator_code: 'E2', bonus: 2, target: 'district_of_first_measure' },
    ],
    conflicts: [
      { measures: ['M1', 'M3'], scope: 'global' },
      { measures: ['M4', 'M7'], scope: 'same_district' },
      { measures: ['M5', 'M13'], scope: 'same_district' },
    ],
  };
}
const fetchMock = vi.fn<typeof fetch>();
function respond(payload: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } }));
}
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('backend contract adapter', () => {
  it('requests simulation independently of explanation and copies every authoritative value', async () => {
    const payload = simulation();
    payload.score.score_delta = 6.12345;
    respond(payload);
    const answer = await simulatePlan(plan);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/scenarios/simulate');
    expect(answer.simulation.score.score_delta).toBe(6.12345);
    expect(answer.result.score).toBe(56.54307);
    expect(answer).not.toHaveProperty('analysis');
  });

  it('validates structured provenance and fallback metadata', async () => {
    const payload = { ...analyzed(), analysis: { ...analyzed().analysis, provider: 'deterministic_fallback', fallback_reason: 'timeout', fact_refs: { summary: ['score.overview'] } } };
    respond(payload);
    expect((await analyzePlan(plan)).analysis).toEqual(payload.analysis);
    respond({ ...payload, analysis: { ...payload.analysis, fact_refs: { summary: [123] } } });
    await expect(analyzePlan(plan)).rejects.toMatchObject({ code: 'response' });
    respond({ ...payload, analysis: { ...payload.analysis, provider: 'invented' } });
    await expect(analyzePlan(plan)).rejects.toMatchObject({ code: 'response' });
  });

  it('serializes backend IDs, maps all district metrics, and preserves server Score', async () => {
    const payload = analyzed();
    // Distinct server values prove that no local recalculation replaces its result.
    payload.simulation.score.score_after = 57.123456;
    payload.simulation.score.city_average_after = 60.123456;
    payload.simulation.districts.reverse();
    payload.simulation.districts.forEach((district) => district.indicators.reverse());
    respond(payload);
    const answer = await analyzePlan(plan);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/scenarios/analyze', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ decisions: wirePlan() }),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, signal: expect.any(AbortSignal),
    }));
    expect(answer.result).toEqual({ ...calculatePlan(plan), score: 57.123456, weightedIndex: 60.123456 });
    expect(answer.simulation).toEqual(payload.simulation);
    expect(answer.analysis).toEqual(payload.analysis);
  });

  it('uses a configured API prefix without adding double slashes', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test/api/v1/');
    respond(analyzed());
    await analyzePlan(plan);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/api/v1/scenarios/analyze');
  });

  it('maps recommendations into editable frontend plans with authoritative numbers', async () => {
    respond({ current_score: 56.54307, candidates: [{ decisions: wirePlan(alternative), score: 57.321, improvement: 0.77793, budget_used: 95, budget_remaining: 5 }] });
    expect(await recommendPlans(plan)).toEqual({ currentScore: 56.54307, candidates: [{ plan: alternative, score: 57.321, improvement: 0.77793, budgetUsed: 95, budgetRemaining: 5 }] });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/scenarios/recommend');
  });

  it('maps comparison with the backend absolute difference and winner', async () => {
    respond({ first: simulation(), second: simulation(alternative), score_difference: 0.5, better_scenario: 'first', explanation: 'Первый сценарий лучше.', analysis: analyzed().analysis });
    const result = await comparePlans(plan, alternative);
    expect(result).toEqual({ first: calculatePlan(plan), second: calculatePlan(alternative), scoreDifference: 0.5, betterScenario: 'first', explanation: 'Первый сценарий лучше.', analysis: analyzed().analysis });
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ first: { decisions: wirePlan() }, second: { decisions: wirePlan(alternative) } });
  });

  it.each([
    ['missing district', (data: BackendSimulation) => { data.districts.pop(); }],
    ['duplicate district', (data: BackendSimulation) => { data.districts[1] = data.districts[0]; }],
    ['unknown district', (data: BackendSimulation) => { data.districts[0].district_id = 'unknown'; }],
    ['missing metric', (data: BackendSimulation) => { data.districts[0].indicators.pop(); }],
    ['duplicate metric', (data: BackendSimulation) => { data.districts[0].indicators[1] = data.districts[0].indicators[0]; }],
    ['non-finite score', (data: BackendSimulation) => { data.score.score_after = NaN; }],
    ['out-of-range indicator', (data: BackendSimulation) => { data.districts[0].indicators[0].after = 101; }],
    ['changed baseline', (data: BackendSimulation) => { data.districts[0].indicators[0].before += 1; }],
    ['incorrect budget', (data: BackendSimulation) => { data.budget_used = 94; }],
    ['fractional critical count', (data: BackendSimulation) => { data.score.critical_count_after = 1.5; }],
    ['changed horizon', (data: BackendSimulation) => { data.horizon_quarters = 4; }],
    ['wrong version', (data: BackendSimulation) => { data.dataset_version = '2.0.0'; }],
    ['response for another plan', (data: BackendSimulation) => { data.decisions = wirePlan(alternative); }],
  ])('rejects %s instead of showing an apparently valid result', async (_, mutate) => {
    const payload = analyzed();
    mutate(payload.simulation);
    respond(payload);
    await expect(analyzePlan(plan)).rejects.toMatchObject({ name: 'ApiError', code: 'response' });
  });

  it('rejects an incomplete analysis and invalid recommendation plan', async () => {
    respond({ simulation: simulation(), analysis: { summary: 'Неполный ответ.' } });
    await expect(analyzePlan(plan)).rejects.toMatchObject({ code: 'response' });
    respond({ current_score: 56, candidates: [{ decisions: wirePlan().slice(1), score: 57, improvement: 1, budget_used: 71, budget_remaining: 29 }] });
    await expect(recommendPlans(plan)).rejects.toMatchObject({ code: 'response' });
  });
});

describe('catalog compatibility', () => {
  it('accepts numeric agreement despite different labels and ordering', async () => {
    const data = catalog();
    data.measures[0].name = 'Другое название';
    data.districts.reverse();
    data.indicators.reverse();
    data.conflicts[0].measures.reverse();
    respond(data);
    await expect(verifyCatalog()).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/catalog');
    expect(fetchMock.mock.calls[0][1]!.method).toBe('GET');
  });

  it.each([
    ['version', (data: ReturnType<typeof catalog>) => { data.dataset_version = 'next'; }],
    ['rule', (data: ReturnType<typeof catalog>) => { data.rules.max_measures_per_direction = 3; }],
    ['district', (data: ReturnType<typeof catalog>) => { data.districts[0].indicators.T1 += 1; }],
    ['weight', (data: ReturnType<typeof catalog>) => { data.indicators[0].weight = 0.11; }],
    ['cost', (data: ReturnType<typeof catalog>) => { data.measures[0].cost = 19; }],
    ['effect', (data: ReturnType<typeof catalog>) => { data.measures[0].effects.T1 = 7; }],
    ['lag', (data: ReturnType<typeof catalog>) => { data.measures[0].lag = 3; }],
    ['duplicate measure', (data: ReturnType<typeof catalog>) => { data.measures[1] = data.measures[0]; }],
    ['synergy', (data: ReturnType<typeof catalog>) => { data.synergies[0].bonus = 3; }],
    ['conflict', (data: ReturnType<typeof catalog>) => { data.conflicts[0].scope = 'same_district'; }],
  ])('stops calculation for incompatible %s', async (_, mutate) => {
    const data = catalog();
    mutate(data);
    respond(data);
    await expect(verifyCatalog()).rejects.toMatchObject({ code: 'catalog', message: expect.stringContaining('Расчёт остановлен') });
  });
});

describe('failures and cancellation', () => {
  it('exposes the server validation reasons in Russian', async () => {
    respond({ detail: [{ code: 'budget', message: 'Бюджет превышен.' }, { code: 'count', message: 'Нужно ровно 5 мероприятий.' }] }, 422);
    await expect(analyzePlan(plan)).rejects.toMatchObject({ code: 'http', status: 422, message: 'Сервер отклонил план. Бюджет превышен. Нужно ровно 5 мероприятий.' });
  });

  it('handles framework validation messages and unavailable/non-JSON responses', async () => {
    respond({ detail: [{ msg: 'Field required' }] }, 422);
    await expect(analyzePlan(plan)).rejects.toThrow('Field required');
    fetchMock.mockResolvedValueOnce(new Response('<html>Gateway failure</html>', { status: 502 }));
    await expect(analyzePlan(plan)).rejects.toMatchObject({ code: 'http', status: 502 });
    fetchMock.mockResolvedValueOnce(new Response('<html>Frontend fallback</html>'));
    await expect(analyzePlan(plan)).rejects.toMatchObject({ code: 'response' });
  });

  it('reports network failures without falling back to local arithmetic', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(analyzePlan(plan)).rejects.toMatchObject({ code: 'network', message: expect.stringContaining('Не удалось связаться') });
  });

  it('does not start an already cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(analyzePlan(plan, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards cancellation and ignores a late successful response', async () => {
    const controller = new AbortController();
    let resolve!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const pending = analyzePlan(plan, controller.signal);
    controller.abort();
    expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(true);
    resolve(new Response(JSON.stringify(analyzed())));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('aborts stalled requests with an actionable timeout message', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce((_, options) => new Promise((_, reject) => {
      options!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const assertion = expect(analyzePlan(plan)).rejects.toMatchObject({ code: 'timeout', message: expect.stringContaining('не ответил вовремя') });
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});
