import { useEffect, useRef, useState } from 'react';
import { load } from '@2gis/mapgl';
import type * as MapGL from '@2gis/mapgl/types';
import { zones } from './data';
import type { DistrictId, Mode } from './data';
import { createDistrictOverlays, createScenarioOverlays } from './mapOverlays';
import { useTraffic } from './useTraffic';
import type { PlanItem } from './modelData';

const CITY_BOUNDS = { southWest: [71.20, 51.035], northEast: [71.63, 51.275] };
const GAME_BOUNDS = { southWest: [71.27, 51.065], northEast: [71.56, 51.22] };
const MAP_WAIT_MS = 30_000;
type MapSession = { api: typeof MapGL; map: MapGL.Map };
type MapState = { status: 'loading' | 'ready' } | { status: 'error'; message: string };
type Props = {
  mode: Mode;
  selectedId: DistrictId | null;
  onSelect: (id: DistrictId | null) => void;
  resetVersion: number;
  plan?: readonly PlanItem[];
  scenarioScore?: number;
  districtsOpen?: boolean;
};

function viewPadding(selected = false) {
  if (window.matchMedia('(max-width: 760px)').matches) return { top: 150, right: 30, bottom: 160, left: 30 };
  return selected
    ? { top: 90, right: 400, bottom: 160, left: 55 }
    : { top: 100, right: 55, bottom: 170, left: 55 };
}

const EMPTY_PLAN: readonly PlanItem[] = [];

export default function CityMap({ mode, selectedId, onSelect, resetVersion, plan = EMPTY_PLAN, districtsOpen = true }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const overlayCleanups = useRef(new Set<() => void>());
  const propsRef = useRef({ mode, selectedId, onSelect, districtsOpen });
  propsRef.current = { mode, selectedId, onSelect, districtsOpen };
  const [session, setSession] = useState<MapSession | null>(null);
  const [mapState, setMapState] = useState<MapState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [project, setProject] = useState<{ name: string; coordinates: number[] } | null>(null);
  const trafficActive = mode === 'before';
  const trafficActiveRef = useRef(trafficActive);
  trafficActiveRef.current = trafficActive;
  // Keep live road colors and reconnection handling without a score panel.
  useTraffic(session?.map ?? null, trafficActive, mapState.status === 'error', 0);

  useEffect(() => {
    const key = import.meta.env.VITE_2GIS_KEY?.trim();
    setSession(null);
    setMapState({ status: 'loading' });
    if (!key) {
      setMapState({ status: 'error', message: 'Ключ 2ГИС не настроен. Добавьте VITE_2GIS_KEY в .env.local и перезапустите приложение.' });
      return;
    }
    let disposed = false;
    let failed = false;
    let map: MapGL.Map | undefined;
    let styleLoaded = false;
    const fail = (message: string) => {
      if (disposed) return;
      failed = true;
      clearTimeout(timeout);
      setMapState({ status: 'error', message });
    };
    const timeout = setTimeout(() => fail('Карта не загрузилась вовремя. Проверьте подключение и доступ к 2ГИС.'), MAP_WAIT_MS);
    const styleError = () => fail('Не удалось загрузить карту 2ГИС. Проверьте подключение, ключ и его ограничения.');
    const mapError = (event: MapGL.MapEventTable['error']) => {
      if (event.type === 'invalidtilekey') fail('2ГИС отклонил ключ. Проверьте его активность и разрешённые адреса сайта.');
      else if (event.type === 'webglcontextlost') fail('Соединение с графическим модулем потеряно. Перезагрузите карту.');
      else if (event.type === 'styleloaderror') styleError();
      // A failed tile/resource does not invalidate the map or its overlays.
    };
    const styleReady = () => { styleLoaded = true; };
    const idle = () => {
      if (disposed || failed || !styleLoaded) return;
      clearTimeout(timeout);
      setMapState({ status: 'ready' });
    };

    load('https://mapgl.2gis.com/api/js/v1').then((api) => {
      if (disposed || failed || !container.current) return;
      if (!api.isSupported()) {
        fail('Для карты 2ГИС требуется браузер с поддержкой WebGL.');
        return;
      }
      map = new api.Map(container.current, {
        key, center: [71.415, 51.151], zoom: 11,
        minZoom: 8.5, maxZoom: 16, maxBounds: CITY_BOUNDS,
        lang: 'ru', trafficOn: trafficActiveRef.current,
        trafficControl: false, zoomControl: false, floorControl: false,
        copyright: 'bottomRight', controlsLayoutPadding: { bottom: propsRef.current.districtsOpen ? 148 : 4, right: 8 },
        enableTrackResize: true, disableRotationByUserInteraction: true,
        disablePitchByUserInteraction: true,
      });
      map.on('styleload', styleReady);
      map.on('styleloaderror', styleError);
      map.on('error', mapError);
      map.on('idle', idle);
      map.fitBounds(GAME_BOUNDS, { padding: viewPadding(), animation: { duration: 0 } });
      setSession({ api, map });
    }).catch(() => styleError());

    return () => {
      disposed = true;
      clearTimeout(timeout);
      if (map) {
        map.off('styleload', styleReady);
        map.off('styleloaderror', styleError);
        map.off('error', mapError);
        map.off('idle', idle);
        for (const cleanup of overlayCleanups.current) cleanup();
        map.destroy();
      }
    };
  }, [attempt]);

  const ready = mapState.status === 'ready';
  useEffect(() => {
    if (!session || !ready) return;
    const updatePadding = () => {
      const shell = container.current?.closest('.atlas-shell');
      const cssHeight = shell ? Number.parseFloat(window.getComputedStyle(shell).getPropertyValue('--dock-height')) : NaN;
      const dockHeight = districtsOpen ? (Number.isFinite(cssHeight) ? Math.max(0, cssHeight) : 144) : 0;
      session.map.setControlsLayoutPadding({ bottom: dockHeight + 4, right: 8 });
    };
    updatePadding();
    window.addEventListener('resize', updatePadding);
    return () => window.removeEventListener('resize', updatePadding);
  }, [session, ready, districtsOpen]);

  useEffect(() => {
    if (!session || !ready) return;
    const group = createDistrictOverlays(session.api, session.map, selectedId, (id) => propsRef.current.onSelect(id));
    const cleanup = () => { group.destroy(); overlayCleanups.current.delete(cleanup); };
    overlayCleanups.current.add(cleanup);
    return cleanup;
  }, [session, ready, selectedId]);

  useEffect(() => {
    if (!session || !ready || mode !== 'after') return;
    const group = createScenarioOverlays(session.api, session.map, plan, (name, coordinates) => {
      propsRef.current.onSelect(null);
      setProject({ name, coordinates });
    });
    const cleanup = () => { group.destroy(); overlayCleanups.current.delete(cleanup); };
    overlayCleanups.current.add(cleanup);
    return cleanup;
  }, [session, ready, mode, plan]);

  useEffect(() => { setProject(null); }, [mode, resetVersion, plan]);
  useEffect(() => { if (selectedId) setProject(null); }, [selectedId]);

  useEffect(() => {
    if (!session || !ready || !project || mode !== 'after') return;
    const content = document.createElement('div');
    content.className = 'project-popup';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'card-close';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Закрыть проект');
    close.onclick = () => setProject(null);
    const title = document.createElement('strong');
    title.textContent = project.name;
    const note = document.createElement('span');
    note.textContent = 'Демонстрационное размещение';
    content.append(close, title, note);
    const popup = new session.api.HtmlMarker(session.map, {
      coordinates: project.coordinates, html: content, anchor: [105, 115], zIndex: 40,
      interactive: true, preventMapInteractions: true,
    });
    let destroyed = false;
    const cleanup = () => {
      if (!destroyed) popup.destroy();
      destroyed = true;
      overlayCleanups.current.delete(cleanup);
    };
    overlayCleanups.current.add(cleanup);
    return cleanup;
  }, [session, ready, project, mode]);

  useEffect(() => {
    if (!session || !ready || !selectedId) return;
    const feature = zones.features.find((zone) => zone.properties.districtId === selectedId);
    if (!feature) return;
    const ring = feature.geometry.coordinates[0];
    session.map.fitBounds({
      southWest: [Math.min(...ring.map((p) => p[0])), Math.min(...ring.map((p) => p[1]))],
      northEast: [Math.max(...ring.map((p) => p[0])), Math.max(...ring.map((p) => p[1]))],
    }, { padding: viewPadding(true), maxZoom: 12.4, animation: { duration: 600 } });
  }, [session, ready, selectedId]);

  useEffect(() => {
    if (!session || !ready || propsRef.current.selectedId) return;
    session.map.fitBounds(GAME_BOUNDS, { padding: viewPadding(), animation: { duration: 600 } });
  }, [session, ready, resetVersion]);

  return <>
    <div ref={container} className="map" aria-label="Карта 2ГИС" />
    <div className="map-zoom" role="group" aria-label="Масштаб карты">
      <button type="button" disabled={!ready} aria-label="Приблизить" onClick={() => session?.map.setZoom(Math.min(16, session.map.getZoom() + 1))}>+</button>
      <button type="button" disabled={!ready} aria-label="Отдалить" onClick={() => session?.map.setZoom(Math.max(8.5, session.map.getZoom() - 1))}>−</button>
    </div>
    {mapState.status !== 'ready' && <div className="map-status" role={mapState.status === 'error' ? 'alert' : 'status'}>
      {mapState.status === 'error' ? mapState.message : 'Загружаем карту 2ГИС…'}
      {mapState.status === 'error' && <button type="button" className="traffic-retry" onClick={() => setAttempt((n) => n + 1)}>Повторить загрузку</button>}
    </div>}
  </>;
}
