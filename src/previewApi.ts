import { API_TIMEOUT_MS, DISTRICT_API_IDS } from './api';
import type { DistrictId } from './data';
import { INDICATOR_KEYS, measureById } from './modelData';
import type { IndicatorKey, MeasureId, PlanItem } from './modelData';

export type MeasuresPreview = {
  candidates: Array<{
    measureId: MeasureId;
    districts: Array<{
      districtId: DistrictId;
      indicators: Array<{ code: IndicatorKey; before: number; after: number; delta: number }>;
    }>;
  }>;
};

function valid(condition: unknown): asserts condition {
  if (!condition) throw new Error('Сервер вернул некорректный предпросмотр. Повторите запрос.');
}
function record(raw: unknown): Record<string, unknown> {
  valid(raw !== null && typeof raw === 'object' && !Array.isArray(raw));
  return raw as Record<string, unknown>;
}
function array(raw: unknown): unknown[] { valid(Array.isArray(raw)); return raw; }
function numeric(raw: unknown, min = 0, max = 100): number {
  valid(typeof raw === 'number' && Number.isFinite(raw) && raw >= min && raw <= max);
  return raw;
}

/** All consequences and deltas come from the same server engine as final scenarios. */
export async function previewMeasures(plan: readonly PlanItem[], districtId: DistrictId, signal?: AbortSignal): Promise<MeasuresPreview> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, API_TIMEOUT_MS);
  try {
    const base = (import.meta.env.VITE_API_BASE_URL?.trim() || '/api/v1').replace(/\/+$/, '');
    const decisions = plan.map((item) => ({ measure_id: item.measureId, district_id: item.districtId === null ? null : DISTRICT_API_IDS[item.districtId] }));
    const response = await fetch(`${base}/scenarios/preview`, {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisions, district_id: DISTRICT_API_IDS[districtId] }), signal: controller.signal,
    });
    if (!response.ok) throw new Error(response.status === 422 ? 'Предпросмотр недоступен для недопустимого плана. Исправьте выбранные меры.' : 'Предпросмотр временно недоступен. Повторите запрос.');
    const data = record(await response.json());
    controller.signal.throwIfAborted();
    valid(data.dataset_version === '1.0.0' && data.horizon_quarters === 8);
    valid(data.district_id === DISTRICT_API_IDS[districtId]);
    const echoed = array(data.decisions);
    valid(echoed.length === decisions.length && echoed.every((raw, index) => {
      const item = record(raw);
      return item.measure_id === decisions[index].measure_id && item.district_id === decisions[index].district_id;
    }));
    const used = new Set<string>();
    return { candidates: array(data.candidates).map((raw) => {
      const candidate = record(raw);
      const measure = measureById.get(candidate.measure_id as MeasureId);
      valid(measure && !used.has(measure.id) && !plan.some((item) => item.measureId === measure.id));
      valid(candidate.district_id === (measure.scope === 'city' ? null : DISTRICT_API_IDS[districtId]));
      used.add(measure.id);
      const seenDistricts = new Set<string>();
      return { measureId: measure.id, districts: array(candidate.districts).map((rawDistrict) => {
        const district = record(rawDistrict);
        const name = Object.entries(DISTRICT_API_IDS).find(([, id]) => id === district.district_id)?.[0] as DistrictId | undefined;
        valid(name && !seenDistricts.has(name));
        seenDistricts.add(name);
        const seenIndicators = new Set<string>();
        return { districtId: name, indicators: array(district.indicators).map((rawIndicator) => {
          const indicator = record(rawIndicator);
          valid(typeof indicator.code === 'string' && (INDICATOR_KEYS as readonly string[]).includes(indicator.code) && !seenIndicators.has(indicator.code));
          seenIndicators.add(indicator.code);
          return { code: indicator.code as IndicatorKey, before: numeric(indicator.before), after: numeric(indicator.after), delta: numeric(indicator.delta, -100, 100) };
        }) };
      }) };
    }) };
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Запрос отменён.', 'AbortError');
    if (timedOut) throw new Error('Предпросмотр не получен вовремя. Повторите запрос.');
    if (error instanceof SyntaxError) throw new Error('Сервер вернул некорректный предпросмотр. Повторите запрос.');
    if (error instanceof TypeError) throw new Error('Не удалось связаться с сервером предпросмотра. Повторите запрос.');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
