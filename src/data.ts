import type { FeatureCollection, LineString, Point, Polygon } from 'geojson';
import metricsJson from './data/metrics.json';
import zonesRaw from './data/districts.geojson?raw';
import projectsRaw from './data/projects.geojson?raw';
import decisionsRaw from './data/decisions.geojson?raw';

export type Mode = 'before' | 'after';
export type DistrictId = 'Есиль' | 'Алматы' | 'Сарыарка' | 'Байконур' | 'Нура';
export type DistrictMetric = {
  index: number;
  newSchools: number;
  newParks: number;
};
export type District = {
  districtId: DistrictId;
  name: string;
  short: string;
  description: string;
  color: string;
  before: DistrictMetric;
  after: DistrictMetric;
};

type ZoneProperties = { districtId: DistrictId; color: string };
type ProjectProperties = { districtId: DistrictId; kind: 'school' | 'park'; name: string; symbol: string; demo: true };
type DecisionProperties = { districtId?: DistrictId; kind: 'building' | 'green' | 'transport' | 'service'; name: string; symbol?: string; demo: true };

export const districts = metricsJson as District[];
export const zones = JSON.parse(zonesRaw) as FeatureCollection<Polygon, ZoneProperties>;
export const projects = JSON.parse(projectsRaw) as FeatureCollection<Point, ProjectProperties>;
export const decisions = JSON.parse(decisionsRaw) as FeatureCollection<Polygon | LineString | Point, DecisionProperties>;
export const districtById = new Map<DistrictId, District>(districts.map((district) => [district.districtId, district]));

export function metricFor(district: District, mode: Mode): DistrictMetric {
  return district[mode];
}

export function cityIndex(mode: Mode): number {
  return districts.reduce((sum, district) => sum + metricFor(district, mode).index, 0) / districts.length;
}
