import fs from 'node:fs';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const zones = read('districts.geojson');
const projects = read('projects.geojson');
const decisions = read('decisions.geojson');
const ids = ['Есиль', 'Алматы', 'Сарыарка', 'Байконур', 'Нура'];

function validateCollection(collection, name) {
  if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) throw new Error(`${name} is not a FeatureCollection`);
  for (const feature of collection.features) {
    if (feature.type !== 'Feature' || !feature.properties || !feature.geometry) throw new Error(`Invalid feature in ${name}`);
    const { type, coordinates } = feature.geometry;
    const validPosition = (position) => Array.isArray(position) && position.length >= 2
      && position.every(Number.isFinite) && Math.abs(position[0]) <= 180 && Math.abs(position[1]) <= 90;
    const validLine = (line, minimum) => Array.isArray(line) && line.length >= minimum && line.every(validPosition);
    if (type === 'Point') {
      if (!validPosition(coordinates)) throw new Error(`Invalid point in ${name}`);
    } else if (type === 'LineString') {
      if (!validLine(coordinates, 2)) throw new Error(`Invalid line in ${name}`);
    } else if (type === 'Polygon') {
      if (!Array.isArray(coordinates) || coordinates.length === 0 || !coordinates.every((ring) =>
        validLine(ring, 4) && ring[0].every((value, index) => value === ring[ring.length - 1][index]))) {
        throw new Error(`Invalid polygon rings in ${name}`);
      }
    } else throw new Error(`Unsupported geometry ${type} in ${name}`);
  }
}

validateCollection(zones, 'districts.geojson');
validateCollection(projects, 'projects.geojson');
validateCollection(decisions, 'decisions.geojson');

function insideRing(point, ring) {
  const [x, y] = point;
  let contained = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) contained = !contained;
  }
  return contained;
}

function inside(point, polygon) {
  return insideRing(point, polygon.coordinates[0]) && !polygon.coordinates.slice(1).some((ring) => insideRing(point, ring));
}

if (zones.features.length !== 5 || new Set(zones.features.map((zone) => zone.properties.districtId)).size !== 5) throw new Error('Expected five unique zone polygons');
for (const zone of zones.features) {
  if (!ids.includes(zone.properties.districtId) || zone.id !== zone.properties.districtId) throw new Error(`Unknown zone ID: ${zone.id}`);
  if (zone.geometry.type !== 'Polygon') throw new Error(`Zone is not a polygon: ${zone.id}`);
}
if (projects.features.length !== 10) throw new Error('Expected ten project anchor points');
for (const project of projects.features) {
  if (!ids.includes(project.properties.districtId) || project.geometry.type !== 'Point' || project.properties.demo !== true) throw new Error('Invalid project anchor or district');
}
for (const districtId of ids) {
  const districtProjects = projects.features.filter((item) => item.properties.districtId === districtId);
  if (districtProjects.filter((item) => item.properties.kind === 'school').length !== 1 || districtProjects.filter((item) => item.properties.kind === 'park').length !== 1) {
    throw new Error(`Expected one school and one park in ${districtId}`);
  }
  const polygon = zones.features.find((zone) => zone.id === districtId).geometry;
  for (const project of districtProjects) {
    if (!inside(project.geometry.coordinates, polygon)) throw new Error(`${project.properties.name} falls outside its game zone`);
  }
}
for (const decision of decisions.features) {
  if ((decision.properties.districtId !== undefined && !ids.includes(decision.properties.districtId)) || decision.properties.demo !== true) throw new Error('Invalid decision district or demo flag');
}
for (const kind of ['building', 'green', 'transport', 'service']) {
  if (!decisions.features.some((item) => item.properties.kind === kind)) throw new Error(`Missing decision layer: ${kind}`);
}
console.log('Five district polygons, ten contained project anchors and four demo decision types validated.');
