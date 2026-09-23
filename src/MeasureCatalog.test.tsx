// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MeasureCatalog from './MeasureCatalog';
import { previewMeasures } from './previewApi';
import type { MeasuresPreview } from './previewApi';

vi.mock('./previewApi', () => ({ previewMeasures: vi.fn() }));

const preview: MeasuresPreview = { candidates: [{
  measureId: 'M7', districts: [{
    districtId: 'Нура', indicators: [{ code: 'S1', before: 38, after: 47.125, delta: 9.125 }],
  }],
}] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('server-owned measure preview', () => {
  beforeEach(() => vi.mocked(previewMeasures).mockReset());
  afterEach(cleanup);

  it('keeps catalog metadata and editing available while awaiting authoritative effects', async () => {
    const pending = deferred<MeasuresPreview>();
    vi.mocked(previewMeasures).mockReturnValue(pending.promise);
    const onChange = vi.fn();
    render(<MeasureCatalog plan={[]} districtId="Нура" onDistrict={vi.fn()} onChange={onChange} onClose={vi.fn()} />);
    expect(screen.getAllByRole('article')).toHaveLength(14);
    const school = screen.getByRole('article', { name: /^M7 / });
    expect(within(school).getByText('24 ед.')).toBeTruthy();
    expect(within(school).getByText('Район: Нура · Лаг 3 кв.')).toBeTruthy();
    expect(screen.getByText('Сервер рассчитывает предпросмотр…')).toBeTruthy();
    expect(screen.queryByText(/S1: 38/)).toBeNull();
    fireEvent.click(within(school).getByRole('button', { name: 'Добавить M7' }));
    expect(onChange).toHaveBeenCalledWith([{ measureId: 'M7', districtId: 'Нура' }]);
    await act(async () => pending.resolve(preview));
    // This deliberately differs from the local catalog arithmetic (+10).
    expect(within(school).getByText('S1: 38 → 47,125 (+9,125)')).toBeTruthy();
    expect(screen.queryByText('Сервер рассчитывает предпросмотр…')).toBeNull();
    expect(previewMeasures).toHaveBeenCalledWith([], 'Нура', expect.any(AbortSignal));
  });

  it('offers retry without deriving local effects after a provider/network error', async () => {
    vi.mocked(previewMeasures).mockRejectedValueOnce(new Error('Предпросмотр временно недоступен.')).mockResolvedValueOnce(preview);
    render(<MeasureCatalog plan={[]} districtId="Нура" onDistrict={vi.fn()} onChange={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Предпросмотр временно недоступен.');
    expect(screen.queryByText(/S1: 38/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить предпросмотр' }));
    expect(await screen.findByText('S1: 38 → 47,125 (+9,125)')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(previewMeasures).toHaveBeenCalledTimes(2);
  });

  it('aborts and discards late effects when the plan or target changes', async () => {
    const first = deferred<MeasuresPreview>();
    const second = deferred<MeasuresPreview>();
    const third = deferred<MeasuresPreview>();
    vi.mocked(previewMeasures).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    const callbacks = { onDistrict: vi.fn(), onChange: vi.fn(), onClose: vi.fn() };
    const { rerender, unmount } = render(<MeasureCatalog plan={[]} districtId="Нура" {...callbacks} />);
    const firstSignal = vi.mocked(previewMeasures).mock.calls[0][2]!;
    rerender(<MeasureCatalog plan={[]} districtId="Есиль" {...callbacks} />);
    expect(firstSignal.aborted).toBe(true);
    await act(async () => first.resolve(preview));
    expect(screen.queryByText(/S1: 38/)).toBeNull();
    const secondSignal = vi.mocked(previewMeasures).mock.calls[1][2]!;
    rerender(<MeasureCatalog plan={[{ measureId: 'M12', districtId: null }]} districtId="Есиль" {...callbacks} />);
    expect(secondSignal.aborted).toBe(true);
    await act(async () => second.resolve(preview));
    expect(screen.queryByText(/S1: 38/)).toBeNull();
    const thirdSignal = vi.mocked(previewMeasures).mock.calls[2][2]!;
    unmount();
    expect(thirdSignal.aborted).toBe(true);
    await act(async () => third.resolve(preview));
  });
});
