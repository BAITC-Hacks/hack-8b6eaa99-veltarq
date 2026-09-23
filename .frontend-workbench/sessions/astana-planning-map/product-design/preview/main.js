import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import zonesRaw from '../../../../../src/data/districts.geojson?raw';
import projectsRaw from '../../../../../src/data/projects.geojson?raw';
import decisionsRaw from '../../../../../src/data/decisions.geojson?raw';
import metrics from '../../../../../src/data/metrics.json';

const zones = JSON.parse(zonesRaw);
const projects = JSON.parse(projectsRaw);
const decisions = JSON.parse(decisionsRaw);
maplibregl.setWorkerUrl(workerUrl);
const style = 'https://tiles.openfreemap.org/styles/positron';
const map = new maplibregl.Map({ container: 'map', style, center: [71.42, 51.15], zoom: 11, minZoom: 8.5, maxZoom: 15, maxBounds: [[71.20, 51.035], [71.63, 51.275]], dragRotate: false, pitchWithRotate: false, touchPitch: false });
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
let selectedId = 'Есиль';
let mode = 'after';

function score(value) { return value.toFixed(1).replace('.', ','); }
function render() {
  document.querySelector('#district-list').innerHTML = metrics.map((district, index) => {
    const current = district[mode].index;
    return `<button type="button" class="district-row ${district.districtId === selectedId ? 'selected' : ''}" data-id="${district.districtId}" aria-pressed="${district.districtId === selectedId}"><span class="row-number">${String(index + 1).padStart(2, '0')}</span><span class="zone-swatch" style="background:${district.color}"></span><span class="row-name">${district.name}</span><strong>${score(current)}</strong></button>`;
  }).join('');
  const district = metrics.find((entry) => entry.districtId === selectedId);
  const delta = district.after.index - district.before.index;
  document.querySelector('#district-detail').innerHTML = `<div class="detail-head"><span class="section-label">02 / ВЫБРАННАЯ ЗОНА</span><span class="detail-id">ID: ${district.districtId}</span></div><h2>${district.name}</h2><p class="detail-description">${district.description}</p><div class="detail-score"><span><small>ДО</small><b>${score(district.before.index)}</b></span><span class="score-arrow">→</span><span><small>ПОСЛЕ</small><b>${score(district.after.index)}</b></span><span class="score-delta">+${score(delta)}</span></div><div class="detail-projects"><span>Условные проекты</span><strong>1 школа <em>·</em> 1 парк</strong></div>`;
  document.querySelectorAll('.district-row').forEach((button) => button.addEventListener('click', () => { selectedId = button.dataset.id; render(); highlight(); }));
  document.querySelector('#before').classList.toggle('active', mode === 'before');
  document.querySelector('#after').classList.toggle('active', mode === 'after');
  document.querySelectorAll('.after-item').forEach((item) => item.hidden = mode !== 'after');
  if (map.isStyleLoaded()) setAfterVisibility();
}
function setAfterVisibility() {
  ['green', 'building', 'transport', 'service', 'project-points'].forEach((id) => map.setLayoutProperty(id, 'visibility', mode === 'after' ? 'visible' : 'none'));
}
function highlight() {
  if (!map.isStyleLoaded()) return;
  map.setFilter('selected-outline', ['==', ['get', 'districtId'], selectedId]);
  const feature = zones.features.find((item) => item.properties.districtId === selectedId);
  if (!feature) return;
  const bounds = feature.geometry.coordinates[0].reduce((acc, point) => acc.extend(point), new maplibregl.LngLatBounds());
  map.fitBounds(bounds, { padding: window.innerWidth < 700 ? 55 : 120, maxZoom: 11.8, duration: 500 });
}
map.on('load', () => {
  map.addSource('zones', { type: 'geojson', data: zones });
  map.addLayer({ id: 'zone-fills', type: 'fill', source: 'zones', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.26 } });
  map.addLayer({ id: 'zone-borders', type: 'line', source: 'zones', paint: { 'line-color': '#ffffff', 'line-width': 1.7 } });
  map.addLayer({ id: 'selected-outline', type: 'line', source: 'zones', filter: ['==', ['get', 'districtId'], selectedId], paint: { 'line-color': '#263d3c', 'line-width': 3 } });
  map.addSource('decisions', { type: 'geojson', data: decisions });
  map.addLayer({ id: 'green', type: 'fill', source: 'decisions', filter: ['==', ['get', 'kind'], 'green'], paint: { 'fill-color': '#53866c', 'fill-opacity': 0.68, 'fill-outline-color': '#326a4b' } });
  map.addLayer({ id: 'building', type: 'fill', source: 'decisions', filter: ['==', ['get', 'kind'], 'building'], paint: { 'fill-color': '#d36d42', 'fill-opacity': 0.78, 'fill-outline-color': '#a14a2b' } });
  map.addLayer({ id: 'transport', type: 'line', source: 'decisions', filter: ['==', ['get', 'kind'], 'transport'], paint: { 'line-color': '#3c7180', 'line-width': 3 } });
  map.addLayer({ id: 'service', type: 'circle', source: 'decisions', filter: ['==', ['get', 'kind'], 'service'], paint: { 'circle-radius': 7, 'circle-color': '#3c7180', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
  map.addSource('projects', { type: 'geojson', data: projects });
  map.addLayer({ id: 'project-points', type: 'circle', source: 'projects', paint: { 'circle-radius': 8, 'circle-color': ['match', ['get', 'kind'], 'school', '#d36d42', 'park', '#53866c', '#3c7180'], 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' } });
  map.on('click', 'zone-fills', (event) => { const id = event.features?.[0]?.properties?.districtId; if (id) { selectedId = id; render(); highlight(); } });
  map.on('mouseenter', 'zone-fills', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'zone-fills', () => map.getCanvas().style.cursor = '');
  map.fitBounds([[71.27, 51.065], [71.56, 51.22]], { padding: 45, duration: 0 });
  setAfterVisibility();
});
document.querySelector('#before').addEventListener('click', () => { mode = 'before'; render(); });
document.querySelector('#after').addEventListener('click', () => { mode = 'after'; render(); });
document.querySelectorAll('.font-review button').forEach((button) => button.addEventListener('click', () => { document.body.dataset.font = button.dataset.font; document.querySelectorAll('.font-review button').forEach((entry) => entry.classList.toggle('active', entry === button)); }));
render();
