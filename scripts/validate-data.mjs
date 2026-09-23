import fs from 'node:fs';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const zones = read('districts.geojson');
const projects = read('projects.geojson');
const decisions = read('decisions.geojson');
const metrics = read('metrics.json');

function inside(point, polygon) {
  const [x, y] = point;
  const ring = polygon.coordinates[0];
  let contained = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) contained = !contained;
  }
  return contained;
}

const ids = metrics.map((item) => item.districtId);
if (ids.length !== 5 || new Set(ids).size !== 5) throw new Error('Expected five unique district IDs');
if (zones.features.length !== 5) throw new Error('Expected five zone polygons');
for (const zone of zones.features) {
  if (!ids.includes(zone.properties.districtId) || zone.id !== zone.properties.districtId) throw new Error(`Unknown zone ID: ${zone.id}`);
  if (zone.geometry.type !== 'Polygon') throw new Error(`Zone is not a polygon: ${zone.id}`);
}
for (const district of metrics) {
  const districtProjects = projects.features.filter((item) => item.properties.districtId === district.districtId);
  if (districtProjects.filter((item) => item.properties.kind === 'school').length !== 1 || districtProjects.filter((item) => item.properties.kind === 'park').length !== 1) {
    throw new Error(`Expected one school and one park in ${district.districtId}`);
  }
  if (district.after.index < district.before.index || district.before.newSchools !== 0 || district.after.newSchools !== 1 || district.before.newParks !== 0 || district.after.newParks !== 1) {
    throw new Error(`Invalid scenario metrics in ${district.districtId}`);
  }
  const polygon = zones.features.find((zone) => zone.id === district.districtId).geometry;
  for (const project of districtProjects) {
    if (!inside(project.geometry.coordinates, polygon)) throw new Error(`${project.properties.name} falls outside its game zone`);
  }
}
for (const kind of ['building', 'green', 'transport', 'service']) {
  if (!decisions.features.some((item) => item.properties.kind === kind)) throw new Error(`Missing decision layer: ${kind}`);
}
console.log('Five districts, ten project points, four decision types and scenario metrics validated.');
