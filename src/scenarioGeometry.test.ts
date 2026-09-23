import type { Polygon, Position } from 'geojson';
import { describe, expect, it } from 'vitest';
import { decisions, zones } from './data';
import type { DistrictId } from './data';
import { DISTRICT_IDS, MEASURES } from './modelData';
import type { PlanItem } from './modelData';
import { getScenarioFeatures } from './scenarioGeometry';

function pointInside([x, y]: Position, polygon: Polygon) {
  const ring = polygon.coordinates[0];
  let contained = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) contained = !contained;
  }
  return contained;
}

describe('scenario geometry', () => {
  it('has no objects until measures are selected', () => {
    expect(getScenarioFeatures([])).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('includes only selected measure identities and their targets', () => {
    const { features } = getScenarioFeatures([
      { measureId: 'M4', districtId: 'Алматы' },
      { measureId: 'M7', districtId: 'Нура' },
      { measureId: 'M12', districtId: null },
    ]);
    expect(features).toHaveLength(7);
    expect(new Set(features.map((feature) => feature.properties.measureId))).toEqual(new Set(['M4', 'M7', 'M12']));
    expect(features.filter((feature) => feature.properties.measureId === 'M4').map((feature) => feature.properties.districtId)).toEqual(['Алматы']);
    expect(features.filter((feature) => feature.properties.measureId === 'M7').map((feature) => feature.properties.districtId)).toEqual(['Нура']);
    expect(features.every((feature) => feature.properties.demo)).toBe(true);
  });

  it('reassigns existing park and school geometry when the target changes', () => {
    for (const [measureId, kind] of [['M4', 'green'], ['M7', 'building']] as const) {
      const first = getScenarioFeatures([{ measureId, districtId: 'Есиль' }]).features[0];
      const reassigned = getScenarioFeatures([{ measureId, districtId: 'Нура' }]).features[0];
      expect(first.id).not.toBe(reassigned.id);
      expect(first.geometry).not.toEqual(reassigned.geometry);
      expect(reassigned.geometry).toEqual(decisions.features.find((feature) => feature.properties.districtId === 'Нура' && feature.properties.kind === kind)!.geometry);
      expect(reassigned.properties.districtId).toBe('Нура');
    }
  });

  it('gives every city measure one generic coverage marker in every district', () => {
    for (const measure of MEASURES.filter((item) => item.scope === 'city')) {
      const { features } = getScenarioFeatures([{ measureId: measure.id, districtId: null }]);
      expect(features).toHaveLength(5);
      expect(new Set(features.map((feature) => feature.properties.districtId))).toEqual(new Set(DISTRICT_IDS));
      expect(new Set(features.map((feature) => feature.id)).size).toBe(5);
      for (const feature of features) {
        expect(feature.geometry.type).toBe('Point');
        expect(feature.properties.kind).toBe('service');
        expect(feature.properties.symbol).toBe(measure.id);
        expect(feature.properties.name).toContain(measure.name);
      }
    }
  });

  it('deduplicates repeated measure identities, including conflicting targets', () => {
    const { features } = getScenarioFeatures([
      { measureId: 'M2', districtId: null },
      { measureId: 'M2', districtId: null },
      { measureId: 'M4', districtId: 'Есиль' },
      { measureId: 'M4', districtId: 'Нура' },
    ]);
    expect(features).toHaveLength(6);
    expect(new Set(features.map((feature) => feature.id)).size).toBe(6);
    expect(features.find((feature) => feature.properties.measureId === 'M4')!.properties.districtId).toBe('Есиль');
  });

  it('ignores unknown identities, missing district targets and city measures with district targets', () => {
    const malformed = [
      { measureId: 'M99', districtId: 'Нура' },
      { measureId: 'M4', districtId: null },
      { measureId: 'M7', districtId: 'unknown' },
      { measureId: 'M2', districtId: 'Алматы' },
    ] as unknown as PlanItem[];
    expect(getScenarioFeatures(malformed).features).toEqual([]);
  });

  it('keeps all 14 measure geometries inside each assigned game district', () => {
    const represented = new Set<string>();
    for (const measure of MEASURES) {
      const targets: readonly (DistrictId | null)[] = measure.scope === 'city' ? [null] : DISTRICT_IDS;
      for (const districtId of targets) {
        const { features } = getScenarioFeatures([{ measureId: measure.id, districtId }]);
        expect(features).toHaveLength(measure.scope === 'city' ? 5 : 1);
        for (const feature of features) {
          represented.add(feature.properties.measureId);
          const zone = zones.features.find((item) => item.properties.districtId === feature.properties.districtId)!.geometry;
          const geometry = feature.geometry;
          const coordinates = geometry.type === 'Point' ? [geometry.coordinates] : geometry.type === 'Polygon' ? geometry.coordinates.flat() : geometry.coordinates;
          for (const position of coordinates) {
            expect(position.every(Number.isFinite)).toBe(true);
            expect(pointInside(position, zone), `${feature.id} vertex inside its district`).toBe(true);
          }
          // Check edge interiors as well as vertices, including concave zones.
          if (geometry.type !== 'Point') {
            for (let i = 1; i < coordinates.length; i++) {
              const previous = coordinates[i - 1];
              const current = coordinates[i];
              for (let part = 1; part < 10; part++) {
                const fraction = part / 10;
                const position = [previous[0] + (current[0] - previous[0]) * fraction, previous[1] + (current[1] - previous[1]) * fraction];
                expect(pointInside(position, zone), `${feature.id} edge inside its district`).toBe(true);
              }
            }
          }
        }
      }
    }
    expect(represented.size).toBe(14);
  });

  it('removes geometry when its measure is removed and keeps remaining placements stable', () => {
    const plan: PlanItem[] = [{ measureId: 'M1', districtId: 'Нура' }, { measureId: 'M10', districtId: 'Нура' }];
    const original = getScenarioFeatures(plan);
    const remaining = getScenarioFeatures(plan.slice(1));
    expect(remaining.features).toEqual([original.features[1]]);
  });
});
