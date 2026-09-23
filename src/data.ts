import type { FeatureCollection, LineString, Point, Polygon } from 'geojson';
import zonesRaw from './data/districts.geojson?raw';
import projectsRaw from './data/projects.geojson?raw';
import decisionsRaw from './data/decisions.geojson?raw';

export type Mode = 'before' | 'after';
export type DistrictId = 'Есиль' | 'Алматы' | 'Сарыарка' | 'Байконур' | 'Нура';
export type District = {
  districtId: DistrictId;
  name: string;
  short: string;
  description: string;
  color: string;
};

type ZoneProperties = { districtId: DistrictId; color: string };
type ProjectProperties = { districtId: DistrictId; kind: 'school' | 'park'; name: string; symbol: string; demo: true };
type DecisionProperties = { districtId?: DistrictId; kind: 'building' | 'green' | 'transport' | 'service'; name: string; symbol?: string; demo: true };

// Display metadata only. All indicators and calculated indices live in the model.
export const districts: District[] = [
  { districtId: 'Есиль', name: 'Есиль', short: 'ЕС', color: '#667f90', description: 'Пробки на мостах и переполненные школы.' },
  { districtId: 'Алматы', name: 'Алматы', short: 'АЛ', color: '#bf806a', description: 'Старые сети ЖКХ и загруженные дороги.' },
  { districtId: 'Сарыарка', name: 'Сарыарка', short: 'СА', color: '#baa167', description: 'Смог от частного сектора и недостаточное озеленение.' },
  { districtId: 'Байконур', name: 'Байконур', short: 'БА', color: '#779b89', description: 'Район без выраженных перекосов показателей.' },
  { districtId: 'Нура', name: 'Нура', short: 'НУ', color: '#9391af', description: 'Низкая обеспеченность социальной инфраструктурой и транспортом.' },
];
export const zones = JSON.parse(zonesRaw) as FeatureCollection<Polygon, ZoneProperties>;
export const projects = JSON.parse(projectsRaw) as FeatureCollection<Point, ProjectProperties>;
export const decisions = JSON.parse(decisionsRaw) as FeatureCollection<Polygon | LineString | Point, DecisionProperties>;
export const districtById = new Map<DistrictId, District>(districts.map((district) => [district.districtId, district]));
