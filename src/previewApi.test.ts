import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { previewMeasures } from './previewApi';

const body = {
  dataset_version: '1.0.0', horizon_quarters: 8,
  decisions: [{ measure_id: 'M12', district_id: null }], district_id: 'nura',
  candidates: [{ measure_id: 'M7', district_id: 'nura', districts: [{
    district_id: 'nura', district_name: 'Нура',
    indicators: [{ code: 'S1', before: 38, after: 47.125, delta: 9.125 }],
  }] }],
};
const plan = [{ measureId: 'M12' as const, districtId: null }];

describe('preview API contract', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('serializes server IDs and preserves all returned effects without arithmetic', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example/api/v1/');
    vi.mocked(fetch).mockResolvedValue(Response.json(body));
    const result = await previewMeasures(plan, 'Нура');
    expect(result).toEqual({ candidates: [{ measureId: 'M7', districts: [{
      districtId: 'Нура', indicators: [{ code: 'S1', before: 38, after: 47.125, delta: 9.125 }],
    }] }] });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://api.example/api/v1/scenarios/preview');
    expect(JSON.parse(init!.body as string)).toEqual({ decisions: body.decisions, district_id: 'nura' });
    expect(init!.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects incomplete indicator data, duplicate measures, and a mismatched scenario', async () => {
    const invalidIndicator = structuredClone(body);
    (invalidIndicator.candidates[0].districts[0].indicators[0] as Record<string, unknown>).after = undefined;
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(invalidIndicator))
      .mockResolvedValueOnce(Response.json({ ...body, candidates: [...body.candidates, ...body.candidates] }))
      .mockResolvedValueOnce(Response.json({ ...body, decisions: [] }))
      .mockResolvedValueOnce(Response.json({ ...body, district_id: 'esil' }));
    for (let index = 0; index < 4; index += 1) {
      await expect(previewMeasures(plan, 'Нура')).rejects.toThrow('Сервер вернул некорректный предпросмотр.');
    }
  });

  it('provides readable errors without a local simulation fallback', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 422 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('{invalid'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(previewMeasures(plan, 'Нура')).rejects.toThrow('недопустимого плана');
    await expect(previewMeasures(plan, 'Нура')).rejects.toThrow('временно недоступен');
    await expect(previewMeasures(plan, 'Нура')).rejects.toThrow('некорректный предпросмотр');
    await expect(previewMeasures(plan, 'Нура')).rejects.toThrow('Не удалось связаться');
  });

  it('does not start a cancelled request and rejects a late response after cancellation', async () => {
    const stopped = new AbortController();
    stopped.abort();
    await expect(previewMeasures(plan, 'Нура', stopped.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
    let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValue(new Promise<Response>((yes) => { resolve = yes; }));
    const controller = new AbortController();
    const result = previewMeasures(plan, 'Нура', controller.signal);
    const expectation = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    expect(vi.mocked(fetch).mock.calls[0][1]!.signal!.aborted).toBe(true);
    resolve(Response.json(body));
    await expectation;
  });
});
