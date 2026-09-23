import type { Feature, FeatureCollection, LineString, Point, Polygon, Position } from 'geojson';
import { decisions, projects, zones } from './data';
import type { DistrictId } from './data';
import { MEASURES, measureById } from './modelData';
import type { Measure, MeasureId, PlanItem } from './modelData';

export type ScenarioProperties = {
  measureId: MeasureId;
  districtId: DistrictId;
  kind: string;
  name: string;
  symbol: string;
  demo: true;
};
export type ScenarioGeometry = Polygon | LineString | Point;
export type ScenarioFeatures = FeatureCollection<ScenarioGeometry, ScenarioProperties>;

const districtZones = new Map(zones.features.map((feature) => [feature.properties.districtId, feature.geometry]));

function insideRing([x, y]: Position, ring: Position[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function insideDistrict(point: Position, polygon: Polygon) {
  return insideRing(point, polygon.coordinates[0]) && !polygon.coordinates.slice(1).some((ring) => insideRing(point, ring));
}

/** Stable illustrative placements, unrelated to road geometry or live traffic. */
function markerPosition(measure: Measure, districtId: DistrictId): Position | undefined {
  const anchor = projects.features.find((feature) => feature.properties.districtId === districtId && feature.properties.kind === 'school');
  const polygon = districtZones.get(districtId);
  if (!anchor || !polygon || !insideDistrict(anchor.geometry.coordinates, polygon)) return undefined;
  const [lng, lat] = anchor.geometry.coordinates;
  const angle = (MEASURES.findIndex((item) => item.id === measure.id) / MEASURES.length) * Math.PI * 2;
  // Offsets distinguish measures without implying an actual construction location.
  // Shrink toward the existing interior anchor if the dataset boundary changes.
  for (const scale of [1, 0.5, 0.25, 0]) {
    const candidate = [lng + Math.cos(angle) * 0.014 * scale, lat + Math.sin(angle) * 0.009 * scale];
    if (insideDistrict(candidate, polygon)) return candidate;
  }
  return undefined;
}

function geometryFor(measure: Measure, districtId: DistrictId): ScenarioGeometry | undefined {
  const kind = measure.id === 'M4' ? 'green' : measure.id === 'M7' ? 'building' : null;
  if (kind) {
    const footprint = decisions.features.find((feature) => feature.properties.districtId === districtId && feature.properties.kind === kind && feature.geometry.type === 'Polygon');
    if (footprint?.geometry.type === 'Polygon') {
      return { type: 'Polygon', coordinates: footprint.geometry.coordinates.map((ring) => ring.map((position) => [...position])) };
    }
  }
  const coordinates = markerPosition(measure, districtId);
  return coordinates ? { type: 'Point', coordinates } : undefined;
}

/**
 * Each selected measure owns exactly one feature per affected game district.
 * City programmes use generic coverage markers, not fictional infrastructure.
 * Plan completeness/budget validation belongs to the model; malformed identities
 * and targets are rejected here so they cannot produce unrelated map objects.
 */
export function getScenarioFeatures(plan: readonly PlanItem[]): ScenarioFeatures {
  const features: Feature<ScenarioGeometry, ScenarioProperties>[] = [];
  const seen = new Set<MeasureId>();
  for (const item of plan) {
    const measure = measureById.get(item.measureId);
    if (!measure || seen.has(measure.id)) continue;
    if (measure.scope === 'city' ? item.districtId !== null : !districtZones.has(item.districtId as DistrictId)) continue;
    seen.add(measure.id);
    const targets = measure.scope === 'city' ? [...districtZones.keys()] : [item.districtId as DistrictId];
    for (const districtId of targets) {
      const geometry = geometryFor(measure, districtId);
      if (!geometry) continue;
      features.push({
        type: 'Feature',
        id: `${measure.id}:${districtId}`,
        geometry,
        properties: {
          measureId: measure.id,
          districtId,
          kind: measure.id === 'M4' ? 'park' : measure.id === 'M7' ? 'school' : 'service',
          name: `${measure.id} · ${measure.name} · ${districtId}`,
          symbol: measure.id === 'M4' ? 'П' : measure.id === 'M7' ? 'Ш' : measure.id,
          demo: true,
        },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}
