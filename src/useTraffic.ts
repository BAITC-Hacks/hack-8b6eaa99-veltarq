import { useEffect, useState } from 'react';
import type { Map, TrafficScoreEvent } from '@2gis/mapgl/types';

export const SCORE_WAIT_MS = 15_000;
export const SCORE_STALE_MS = 5 * 60_000;
export type TrafficState =
  | { status: 'off' | 'loading' | 'unavailable' | 'stale' }
  | { status: 'error'; message: string }
  | { status: 'ready'; score: number; receivedAt: number };

// A missing, sentinel or malformed score must never become an apparent zero.
export function validTrafficScore(score: unknown): score is number {
  return typeof score === 'number' && Number.isInteger(score) && score >= 1 && score <= 10;
}

export function useTraffic(map: Map | null, enabled: boolean, mapFailed: boolean, retry: number) {
  const [state, setState] = useState<TrafficState>({ status: 'loading' });

  useEffect(() => {
    if (!enabled) {
      map?.hideTraffic();
      setState({ status: 'off' });
      return;
    }
    if (mapFailed) {
      setState({ status: 'error', message: 'Пробки недоступны из-за ошибки карты.' });
      return;
    }
    if (!map) {
      setState({ status: 'loading' });
      return;
    }

    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const update = (next: TrafficState) => { if (active) setState(next); };
    const waitForScore = () => {
      clearTimeout(timer);
      update({ status: 'loading' });
      timer = setTimeout(() => update({ status: 'unavailable' }), SCORE_WAIT_MS);
    };
    const onScore = ({ score }: TrafficScoreEvent) => {
      if (!active || !navigator.onLine) return;
      clearTimeout(timer);
      if (!validTrafficScore(score)) {
        update({ status: 'unavailable' });
        return;
      }
      update({ status: 'ready', score, receivedAt: Date.now() });
      // This is a local freshness limit, not the provider's measurement time.
      timer = setTimeout(() => update({ status: 'stale' }), SCORE_STALE_MS);
    };
    const offline = () => {
      clearTimeout(timer);
      update({ status: 'error', message: 'Нет подключения. Обновление пробок недоступно.' });
    };
    const online = () => {
      waitForScore();
      map.hideTraffic();
      map.showTraffic();
    };
    map.on('trafficscore', onScore);
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    waitForScore();
    if (retry > 0) map.hideTraffic();
    map.showTraffic();
    if (!navigator.onLine) offline();

    return () => {
      active = false;
      clearTimeout(timer);
      map.off('trafficscore', onScore);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
    };
  }, [map, enabled, mapFailed, retry]);

  return state;
}
