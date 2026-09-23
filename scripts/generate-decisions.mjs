import fs from 'node:fs';

const projects = JSON.parse(fs.readFileSync(new URL('../src/data/projects.geojson', import.meta.url), 'utf8'));
const rectangle = ([lng, lat], halfWidth, halfHeight) => [[
  [lng - halfWidth, lat - halfHeight],
  [lng + halfWidth, lat - halfHeight],
  [lng + halfWidth, lat + halfHeight],
  [lng - halfWidth, lat + halfHeight],
  [lng - halfWidth, lat - halfHeight],
]];

const features = projects.features.map((project) => ({
  type: 'Feature',
  properties: {
    districtId: project.properties.districtId,
    kind: project.properties.kind === 'school' ? 'building' : 'green',
    name: project.properties.name,
    demo: true,
  },
  geometry: {
    type: 'Polygon',
    coordinates: rectangle(project.geometry.coordinates, project.properties.kind === 'school' ? 0.0028 : 0.004, project.properties.kind === 'school' ? 0.0018 : 0.0025),
  },
}));

features.push(
  { type: 'Feature', properties: { kind: 'transport', name: 'Маршрут связи районов', demo: true }, geometry: { type: 'LineString', coordinates: [[71.328, 51.125], [71.369, 51.148], [71.409, 51.145], [71.451, 51.151], [71.493, 51.174], [71.52, 51.116]] } },
  { type: 'Feature', properties: { kind: 'transport', name: 'Южный маршрут', demo: true }, geometry: { type: 'LineString', coordinates: [[71.355, 51.181], [71.391, 51.16], [71.42, 51.125], [71.478, 51.114], [71.526, 51.096]] } },
  { type: 'Feature', properties: { districtId: 'Алматы', kind: 'service', name: 'Сервисный пункт · Алматы', symbol: 'С', demo: true }, geometry: { type: 'Point', coordinates: [71.521, 51.119] } },
  { type: 'Feature', properties: { districtId: 'Сарыарка', kind: 'service', name: 'Сервисный пункт · Сарыарка', symbol: 'С', demo: true }, geometry: { type: 'Point', coordinates: [71.366, 51.189] } },
);

fs.writeFileSync(new URL('../src/data/decisions.geojson', import.meta.url), `${JSON.stringify({ type: 'FeatureCollection', features }, null, 2)}\n`);
