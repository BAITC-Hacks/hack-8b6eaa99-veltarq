import type * as MapGL from '@2gis/mapgl/types';
import { zones } from './data';
import type { DistrictId } from './data';
import type { PlanItem } from './modelData';
import { getScenarioFeatures } from './scenarioGeometry';

type OverlayGroup = { destroy(): void };
type MapGLApi = typeof MapGL;
const DISTRICT_COLORS: Record<DistrictId, string> = {
  Есиль: '#92bfd5',
  Алматы: '#bb7548',
  Сарыарка: '#97c75a',
  Байконур: '#353a45',
  Нура: '#abbba6',
};

function overlayGroup() {
  const cleanups: (() => void)[] = [];
  return {
    add(cleanup: () => void) { cleanups.push(cleanup); },
    destroy() {
      for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    },
  };
}

function bindShape(
  shape: MapGL.Polygon | MapGL.Polyline,
  map: MapGL.Map,
  open: (coordinates: number[]) => void,
) {
  const canvas = map.getCanvas();
  const click = (event: { lngLat: number[] }) => open(event.lngLat);
  const enter = () => { canvas.style.cursor = 'pointer'; };
  const leave = () => { canvas.style.cursor = ''; };
  shape.on('click', click);
  shape.on('mouseover', enter);
  shape.on('mouseout', leave);
  return () => {
    shape.off('click', click);
    shape.off('mouseover', enter);
    shape.off('mouseout', leave);
    shape.destroy();
    leave();
  };
}

export function createDistrictOverlays(
  api: MapGLApi,
  map: MapGL.Map,
  selectedId: DistrictId | null,
  onSelect: (id: DistrictId) => void,
): OverlayGroup {
  const group = overlayGroup();
  try {
    for (const feature of zones.features) {
      const { districtId } = feature.properties;
      const color = DISTRICT_COLORS[districtId];
      const selected = districtId === selectedId;
      const polygon = new api.Polygon(map, {
        coordinates: feature.geometry.coordinates,
        // Keep the official traffic colors visible through the district fill.
        color: `${color}${selected ? '24' : '0d'}`,
        strokeColor: selected ? color : '#73878f80',
        strokeWidth: selected ? 3 : 1.5,
        zIndex: selected ? 11 : 10,
        interactive: true,
      });
      group.add(bindShape(polygon, map, () => onSelect(districtId)));
    }
    return group;
  } catch (error) {
    group.destroy();
    throw error;
  }
}

export function createScenarioOverlays(
  api: MapGLApi,
  map: MapGL.Map,
  plan: readonly PlanItem[],
  onOpenProject: (name: string, coordinates: number[]) => void,
): OverlayGroup {
  const group = overlayGroup();

  function addPoint(name: string, symbol: string, kind: string, coordinates: number[]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `map-project-marker map-project-marker--${kind}`;
    button.textContent = symbol;
    button.setAttribute('aria-label', `${name}. Условное размещение мероприятия`);
    button.title = `${name}. Условное размещение`;
    const click = (event: MouseEvent) => {
      event.stopPropagation();
      onOpenProject(name, coordinates);
    };
    button.addEventListener('click', click);
    const marker = new api.HtmlMarker(map, {
      coordinates,
      html: button,
      anchor: [14, 14],
      zIndex: 30,
      interactive: true,
      preventMapInteractions: true,
      labeling: { type: 'none' },
    });
    group.add(() => {
      button.removeEventListener('click', click);
      marker.destroy();
    });
  }

  try {
    for (const feature of getScenarioFeatures(plan).features) {
      const { geometry, properties } = feature;
      const { name, kind } = properties;
      if (geometry.type === 'Polygon') {
        const green = kind === 'park';
        const polygon = new api.Polygon(map, {
          coordinates: geometry.coordinates,
          color: green ? '#5b9f6499' : '#bd724ed1',
          strokeColor: green ? '#286b46' : '#864c32',
          strokeWidth: 1.5,
          zIndex: 20,
          interactive: true,
        });
        group.add(bindShape(polygon, map, (coordinates) => onOpenProject(name, coordinates)));
        const ring = geometry.coordinates[0].slice(0, -1);
        const center = ring.reduce((sum, position) => [sum[0] + position[0] / ring.length, sum[1] + position[1] / ring.length], [0, 0]);
        addPoint(name, properties.symbol, kind, center);
      } else if (geometry.type === 'LineString') {
        const line = new api.Polyline(map, {
          coordinates: geometry.coordinates,
          color: '#316e88',
          width: 4,
          dashLength: 6,
          gapLength: 6,
          zIndex: 21,
          interactive: true,
        });
        group.add(bindShape(line, map, (coordinates) => onOpenProject(name, coordinates)));
      } else {
        addPoint(name, properties.symbol, kind, geometry.coordinates);
      }
    }
    return group;
  } catch (error) {
    group.destroy();
    throw error;
  }
}
