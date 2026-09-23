import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { cityIndex, decisions, districtById, districts, metricFor, projects, zones } from './data';
import type { DistrictId, Mode } from './data';

maplibregl.setWorkerUrl(workerUrl);

const CITY_BOUNDS: maplibregl.LngLatBoundsLike = [[71.20, 51.035], [71.63, 51.275]];
const GAME_BOUNDS: maplibregl.LngLatBoundsLike = [[71.27, 51.065], [71.56, 51.22]];
const AFTER_LAYERS = [
  'decision-green', 'decision-buildings', 'decision-transport',
  'decision-services', 'decision-service-labels', 'project-points', 'project-labels',
];
const DECISION_HIT_LAYERS = ['project-points', 'decision-services', 'decision-buildings', 'decision-green', 'decision-transport'];

function viewPadding(): maplibregl.PaddingOptions {
  if (window.matchMedia('(max-width: 560px)').matches) return { top: 90, right: 25, bottom: 90, left: 25 };
  return { top: 100, right: 45, bottom: 75, left: window.matchMedia('(max-width: 960px)').matches ? 345 : 400 };
}

async function getMapStyle(): Promise<string | maplibregl.StyleSpecification> {
  if (!import.meta.env.DEV) return 'https://tiles.openfreemap.org/styles/positron';
  const [style, planet] = await Promise.all([
    fetch('/style.json').then((response) => response.json()),
    fetch('/planet.json').then((response) => response.json()),
  ]) as [
    { sprite?: string; glyphs?: string; sources: Record<string, { tiles?: string[]; [key: string]: unknown }>; [key: string]: unknown },
    { tiles: string[]; minzoom: number; maxzoom: number; attribution: string },
  ];
  const absolute = (path: string) => path.startsWith('/') ? `${location.origin}${path}` : path;
  if (style.sprite) style.sprite = absolute(style.sprite);
  if (style.glyphs) style.glyphs = absolute(style.glyphs);
  Object.values(style.sources).forEach((source) => {
    if (source.tiles) source.tiles = source.tiles.map(absolute);
  });
  style.sources.openmaptiles = {
    type: 'vector', tiles: planet.tiles.map(absolute),
    minzoom: planet.minzoom, maxzoom: planet.maxzoom, attribution: planet.attribution,
  };
  return style as unknown as maplibregl.StyleSpecification;
}

function addLayers(map: maplibregl.Map) {
  map.addSource('districts', { type: 'geojson', data: zones });
  map.addLayer({
    id: 'district-fills', type: 'fill', source: 'districts',
    paint: {
      'fill-color': ['get', 'color'],
      'fill-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.57, 0.29],
    },
  });
  map.addLayer({
    id: 'district-outlines', type: 'line', source: 'districts',
    paint: {
      'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#213b39', '#ffffff'],
      'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3.5, 1.6],
    },
  });

  map.addSource('projects', { type: 'geojson', data: projects });
  map.addSource('decisions', { type: 'geojson', data: decisions });
  map.addLayer({
    id: 'decision-green', type: 'fill', source: 'decisions',
    filter: ['==', ['get', 'kind'], 'green'], layout: { visibility: 'none' },
    paint: { 'fill-color': '#5b9f64', 'fill-opacity': 0.6, 'fill-outline-color': '#286b46' },
  });
  map.addLayer({
    id: 'decision-buildings', type: 'fill', source: 'decisions',
    filter: ['==', ['get', 'kind'], 'building'], layout: { visibility: 'none' },
    paint: { 'fill-color': '#bd724e', 'fill-opacity': 0.82, 'fill-outline-color': '#864c32' },
  });
  map.addLayer({
    id: 'decision-transport', type: 'line', source: 'decisions',
    filter: ['==', ['get', 'kind'], 'transport'], layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#316e88', 'line-width': 4, 'line-dasharray': [1.3, 1.3] },
  });
  map.addLayer({
    id: 'decision-services', type: 'circle', source: 'decisions',
    filter: ['==', ['get', 'kind'], 'service'], layout: { visibility: 'none' },
    paint: { 'circle-radius': 13, 'circle-color': '#395f89', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
  });
  map.addLayer({
    id: 'decision-service-labels', type: 'symbol', source: 'decisions',
    filter: ['==', ['get', 'kind'], 'service'], layout: { visibility: 'none', 'text-field': ['get', 'symbol'], 'text-size': 13, 'text-allow-overlap': true },
    paint: { 'text-color': '#ffffff' },
  });
  map.addLayer({
    id: 'project-points', type: 'circle', source: 'projects', layout: { visibility: 'none' },
    paint: {
      'circle-radius': 12,
      'circle-color': ['match', ['get', 'kind'], 'school', '#a95f40', 'park', '#367b50', '#4d6670'],
      'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2,
    },
  });
  map.addLayer({
    id: 'project-labels', type: 'symbol', source: 'projects',
    layout: { visibility: 'none', 'text-field': ['get', 'symbol'], 'text-size': 12, 'text-allow-overlap': true },
    paint: { 'text-color': '#ffffff' },
  });
}

function showFeaturePopup(map: maplibregl.Map, event: maplibregl.MapLayerMouseEvent, popupRef: React.MutableRefObject<maplibregl.Popup | null>) {
  const feature = event.features?.[0];
  if (!feature) return;
  const title = document.createElement('strong');
  title.textContent = String(feature.properties?.name ?? 'Демонстрационный проект');
  const note = document.createElement('span');
  note.textContent = 'Демонстрационное размещение';
  const container = document.createElement('div');
  container.className = 'project-popup';
  container.append(title, note);
  popupRef.current?.remove();
  popupRef.current = new maplibregl.Popup({ offset: 14, closeButton: true, maxWidth: '190px' })
    .setLngLat(event.lngLat).setDOMContent(container).addTo(map);
}

export default function App() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const selectedRef = useRef<DistrictId | null>(null);
  const modeRef = useRef<Mode>('before');
  const [mode, setMode] = useState<Mode>('before');
  const [selectedId, setSelectedId] = useState<DistrictId | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  modeRef.current = mode;

  useEffect(() => {
    let cancelled = false;
    let map: maplibregl.Map | null = null;
    getMapStyle().then((style) => {
      if (cancelled || !mapContainer.current) return;
      map = new maplibregl.Map({
        container: mapContainer.current,
        style, center: [71.415, 51.151], zoom: 11,
        minZoom: 8.5, maxZoom: 15, maxBounds: CITY_BOUNDS,
        pitchWithRotate: false, dragRotate: false, touchPitch: false,
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      map.on('load', () => {
        if (!map || cancelled) return;
        addLayers(map);
        map.fitBounds(GAME_BOUNDS, { padding: viewPadding(), duration: 0 });
        AFTER_LAYERS.forEach((id) => map?.setLayoutProperty(id, 'visibility', modeRef.current === 'after' ? 'visible' : 'none'));
        setMapReady(true);
        map.on('click', 'district-fills', (event) => {
          if (modeRef.current === 'after' && map?.queryRenderedFeatures(event.point, { layers: DECISION_HIT_LAYERS }).length) return;
          const districtId = event.features?.[0]?.properties?.districtId as DistrictId | undefined;
          if (districtId && districtById.has(districtId)) setSelectedId(districtId);
        });
        for (const layer of DECISION_HIT_LAYERS) {
          map.on('click', layer, (event) => {
            if (modeRef.current !== 'after' || !map) return;
            const topFeature = map.queryRenderedFeatures(event.point, { layers: DECISION_HIT_LAYERS })[0];
            if (topFeature?.layer.id !== layer) return;
            setSelectedId(null);
            showFeaturePopup(map, event, popupRef);
          });
          map.on('mouseenter', layer, () => { if (map) map.getCanvas().style.cursor = 'pointer'; });
          map.on('mouseleave', layer, () => { if (map) map.getCanvas().style.cursor = ''; });
        }
        map.on('mouseenter', 'district-fills', () => { if (map) map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'district-fills', () => { if (map) map.getCanvas().style.cursor = ''; });
      });
      map.on('error', (event) => {
        console.error('MapLibre:', event.error);
        if (!map?.loaded()) setMapError('Не удалось загрузить карту. Проверьте подключение к интернету.');
      });
    }).catch((error) => {
      console.error(error);
      if (!cancelled) setMapError('Не удалось загрузить карту. Проверьте подключение к интернету.');
    });
    return () => {
      cancelled = true;
      popupRef.current?.remove();
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    for (const id of AFTER_LAYERS) mapRef.current.setLayoutProperty(id, 'visibility', mode === 'after' ? 'visible' : 'none');
    if (mode === 'before') popupRef.current?.remove();
  }, [mode, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    if (selectedRef.current) map.setFeatureState({ source: 'districts', id: selectedRef.current }, { selected: false });
    if (selectedId) {
      map.setFeatureState({ source: 'districts', id: selectedId }, { selected: true });
      const feature = zones.features.find((zone) => zone.properties.districtId === selectedId);
      if (feature) {
        const bounds = feature.geometry.coordinates[0].reduce((acc, point) => acc.extend(point as [number, number]), new maplibregl.LngLatBounds());
        map.fitBounds(bounds, { padding: viewPadding(), maxZoom: 12.4, duration: 600 });
      }
    }
    selectedRef.current = selectedId;
  }, [selectedId, mapReady]);

  function resetView() {
    setSelectedId(null);
    popupRef.current?.remove();
    mapRef.current?.fitBounds(GAME_BOUNDS, { padding: viewPadding(), duration: 600 });
  }

  const selected = selectedId ? districtById.get(selectedId) : null;
  const selectedMetric = selected ? metricFor(selected, mode) : null;

  return (
    <div className="atlas-shell">
      <main className="atlas-workspace">
        <aside className="guide" aria-label="Районы Астаны">
          <header className="guide-head">
            <div className="brand"><span className="brand-symbol">▦</span><span>ASTANA <b>ATLAS</b></span></div>
            <span className="edition">SYS / AST-05</span>
          </header>
          <div className="guide-content">
            <div className="eyebrow"><span className="eyebrow-line" /> 01 / ИНТЕРАКТИВНАЯ КАРТА</div>
            <h1>Астана.<br /><em>Район за районом.</em></h1>
            <p className="intro">Выберите район на карте или в списке и сравните показатели игрового сценария.</p>
            <div className="scenario-stat"><span>СРЕДНИЙ ИГРОВОЙ ИНДЕКС</span><strong>{cityIndex(mode).toFixed(1)}</strong></div>
            <div className="list-heading"><span>02 / ИГРОВЫЕ ЗОНЫ</span><span>01 — 05</span></div>
            <div className="district-list">
              {districts.map((district, index) => (
                <button type="button" className={`district-row${selectedId === district.districtId ? ' active' : ''}`}
                  key={district.districtId} aria-pressed={selectedId === district.districtId}
                  onClick={() => setSelectedId(district.districtId)}>
                  <span className="district-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="district-color" style={{ '--district-color': district.color } as React.CSSProperties} />
                  <span className="district-name">{district.name}</span>
                  <span className="district-row-score">{metricFor(district, mode).index.toFixed(1)}</span>
                </button>
              ))}
            </div>
            {mode === 'after' && (
              <div className="scenario-key" aria-label="Условные обозначения решений">
                <span><i className="key-building" /> Здание</span><span><i className="key-green" /> Зелёный участок</span>
                <span><i className="key-transport" /> Транспорт</span><span><i className="key-service" /> Сервис</span>
              </div>
            )}
          </div>
          <div className="guide-note"><span className="note-mark">i</span><p>Границы зон и размещение проектов демонстрационные. Они не обозначают официальные районы или утверждённые стройки.</p></div>
        </aside>

        <section className="map-stage" aria-label="Карта Астаны">
          <div ref={mapContainer} className="map" />
          <div className="map-top">
            <div className="city-tag"><span className="city-tag-mark">▦</span><span>АСТАНА <small>GRID / 51.16</small></span></div>
            <div className="mode-switch" role="group" aria-label="Сравнение сценариев">
              <button type="button" className={mode === 'before' ? 'selected' : ''} aria-pressed={mode === 'before'} onClick={() => setMode('before')}>До</button>
              <button type="button" className={mode === 'after' ? 'selected' : ''} aria-pressed={mode === 'after'} onClick={() => setMode('after')}>После</button>
            </div>
            <button type="button" className="reset-button" onClick={resetView} aria-label="Показать всю Астану"><span>Весь город</span><span aria-hidden="true">↗</span></button>
          </div>
          <div className="map-footer"><span>51°10′ N / 71°26′ E</span><span className="map-footer-line" /><span>MAPLIBRE · OPENFREEMAP</span></div>
          {!mapReady && <div className="map-status" role="status">{mapError ?? 'Загружаем карту…'}</div>}
          {selected && selectedMetric && (
            <article className="district-card" style={{ '--district-color': selected.color } as React.CSSProperties} aria-live="polite">
              <div className="card-top"><span className="card-kicker"><span className="card-kicker-dot" /> {mode === 'before' ? 'ИСХОДНОЕ СОСТОЯНИЕ' : 'СЦЕНАРИЙ ПОСЛЕ'}</span><button type="button" className="card-close" aria-label="Закрыть карточку" onClick={() => setSelectedId(null)}>×</button></div>
              <div className="card-title-row"><span className="card-icon">{selected.short}</span><div><span className="card-small">АСТАНА / {String(districts.indexOf(selected) + 1).padStart(2, '0')}</span><h2>{selected.name}</h2></div></div>
              <p className="card-description">{selected.description}</p>
              <div className="card-divider" />
              <div className="card-metrics"><div><span>ИГРОВОЙ ИНДЕКС</span><strong>{selectedMetric.index.toFixed(2)}<small> / 100</small></strong></div><div><span>DISTRICT ID</span><strong className="card-id">{selected.districtId}</strong></div></div>
              <div className="card-project-metrics"><span>НОВЫЕ ШКОЛЫ <b>{selectedMetric.newSchools}</b></span><span>НОВЫЕ ПАРКИ <b>{selectedMetric.newParks}</b></span></div>
              <div className="card-foot">ПОКАЗАТЕЛИ И РАЗМЕЩЕНИЕ ДЕМОНСТРАЦИОННЫЕ</div>
            </article>
          )}
        </section>
      </main>
    </div>
  );
}
