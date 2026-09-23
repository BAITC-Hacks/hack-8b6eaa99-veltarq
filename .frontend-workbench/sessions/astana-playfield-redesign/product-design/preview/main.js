import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import zonesRaw from '../../../../../src/data/districts.geojson?raw';
import projectsRaw from '../../../../../src/data/projects.geojson?raw';
import decisionsRaw from '../../../../../src/data/decisions.geojson?raw';
import metrics from '../../../../../src/data/metrics.json';

const zones=JSON.parse(zonesRaw),projects=JSON.parse(projectsRaw),decisions=JSON.parse(decisionsRaw);
const $=(selector)=>document.querySelector(selector);
const score=(value)=>value.toFixed(1).replace('.',',');
const mobile=()=>window.innerWidth<=760;
const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const icons={school:'<path d="m3 10 9-6 9 6M5 9v11h14V9M10 20v-6h4v6M8 11h.01M16 11h.01M12 4V2h5"/>',park:'<path d="m12 3-6 8h3l-4 5h14l-4-5h3L12 3Zm0 13v5m-4 0h8"/>',service:'<path d="M12 5v14M5 12h14"/>'};
const icon=(kind)=>`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[kind]}</svg>`;
let selectedId=null,mode='after',loaded=false,popup=null;
let panelMode='closed',leaveTimer,keyboardNavigation=false;
const districtClicks=new WeakSet();
const hoverSurfaces=[$('.drawer-edge'),$('.district-navigation'),$('#district-detail')];
const canHover=window.matchMedia('(hover: hover) and (pointer: fine)');
function syncPanels(){
  const open=panelMode!=='closed';
  document.body.dataset.panelsOpen=String(open);
  $('.district-navigation').inert=!open;
  $('.district-navigation').setAttribute('aria-hidden',String(!open));
  $('#district-detail').inert=!open||!selectedId;
  $('#district-detail').setAttribute('aria-hidden',String(!open||!selectedId));
  $('#panels-menu').setAttribute('aria-expanded',String(open));
  $('#panels-menu').setAttribute('aria-label',open?'Скрыть меню районов':'Открыть меню районов');
}
function setPanels(next){clearTimeout(leaveTimer);panelMode=next;if(next==='closed')popup?.remove();syncPanels()}
function leavePanels(){
  clearTimeout(leaveTimer);
  leaveTimer=setTimeout(()=>{
    const hovered=canHover.matches&&hoverSurfaces.some(el=>el.matches(':hover'));
    const focused=keyboardNavigation&&hoverSurfaces.some(el=>el.contains(document.activeElement));
    if(panelMode==='peek'&&!hovered&&!focused)setPanels('closed');
  },160);
}
hoverSurfaces.forEach(el=>{
  el.addEventListener('pointerenter',event=>{if(event.pointerType==='mouse'&&canHover.matches){clearTimeout(leaveTimer);if(panelMode!=='pinned')setPanels('peek')}});
  el.addEventListener('pointerleave',leavePanels);
  el.addEventListener('focusin',()=>{if(keyboardNavigation&&panelMode!=='pinned')setPanels('peek')});
  el.addEventListener('focusout',leavePanels);
});
$('#panels-menu').onclick=()=>setPanels(panelMode==='closed'?'pinned':'closed');
document.addEventListener('pointerdown',()=>keyboardNavigation=false);
document.addEventListener('keydown',event=>{
  if(event.key==='Tab')keyboardNavigation=true;
  if(event.key==='Escape'&&panelMode!=='closed'){setPanels('closed');$('#panels-menu').focus()}
});
document.addEventListener('click',event=>{
  const withinControls=event.composedPath().some(node=>node instanceof Element&&node.matches('.district-navigation,.district-detail,.comparison,#panels-menu,.drawer-edge,.maplibregl-popup,.project-marker'));
  if(districtClicks.has(event)||withinControls)return;
  setPanels('closed');
});
const markers=[],labels=[];
maplibregl.setWorkerUrl(workerUrl);
const map=new maplibregl.Map({container:'map',style:'https://tiles.openfreemap.org/styles/positron',center:[71.412,51.148],zoom:10.9,minZoom:8.5,maxZoom:15,maxBounds:[[71.20,51.035],[71.63,51.275]],dragRotate:false,pitchWithRotate:false,touchPitch:false,attributionControl:{compact:true}});
// Bound camera movement to the city without forcing a crop on wide or short screens.
map.setTransformConstrain((center,zoom)=>({center:new maplibregl.LngLat(Math.max(71.20,Math.min(71.63,center.lng)),Math.max(51.035,Math.min(51.275,center.lat))),zoom:Math.max(8.5,Math.min(15,zoom))}));

function silhouette(id,className=''){
  const pts=zones.features.find(f=>f.properties.districtId===id).geometry.coordinates[0];
  const xs=pts.map(p=>p[0]*Math.cos(51.15*Math.PI/180)),ys=pts.map(p=>-p[1]);
  const minX=Math.min(...xs),minY=Math.min(...ys),w=Math.max(...xs)-minX,h=Math.max(...ys)-minY,s=42/Math.max(w,h);
  const d=pts.map((_,i)=>`${i?'L':'M'}${((xs[i]-minX)*s+(50-w*s)/2).toFixed(2)} ${((ys[i]-minY)*s+(50-h*s)/2).toFixed(2)}`).join(' ')+'Z';
  return `<svg viewBox="0 0 50 50" class="${className}" aria-hidden="true"><path d="${d}"/></svg>`;
}
$('#district-list').innerHTML=metrics.map(d=>`<button class="district-choice" data-id="${d.districtId}" aria-pressed="false">${silhouette(d.districtId)}<span><strong>${d.name}</strong><small>Индекс <b></b></small></span></button>`).join('');
function districtPalette(id){
  const button=Array.from(document.querySelectorAll('.district-choice')).find(el=>el.dataset.id===id);
  if(!button)return {fill:'#43567a',edge:'#536484'};
  const style=getComputedStyle(button);
  return {fill:style.getPropertyValue('--district-fill').trim(),edge:style.getPropertyValue('--district-edge').trim()};
}
function render(){
  const avg=metrics.reduce((s,d)=>s+d[mode].index,0)/metrics.length;
  const beforeAvg=metrics.reduce((s,d)=>s+d.before.index,0)/metrics.length;
  $('#city-index').textContent=score(avg);
  $('#city-change').textContent=mode==='after'?`+${score(avg-beforeAvg)}`:'';
  $('#before').setAttribute('aria-pressed',String(mode==='before'));$('#after').setAttribute('aria-pressed',String(mode==='after'));
  document.body.dataset.scenario=mode;
  document.querySelectorAll('.district-choice').forEach(el=>{el.setAttribute('aria-pressed',String(el.dataset.id===selectedId));el.querySelector('b').textContent=score(metrics.find(d=>d.districtId===el.dataset.id)[mode].index)});
  const d=metrics.find(d=>d.districtId===selectedId),detail=$('#district-detail');
  const colors=districtPalette(selectedId);
  detail.style.setProperty('--district-fill',colors.fill);
  detail.style.setProperty('--district-edge',colors.edge);
  detail.hidden=!d;
  if(d){
    const delta=d.after.index-d.before.index;
    detail.innerHTML=`<button class="detail-heading" aria-expanded="${detail.classList.contains('expanded')}" aria-controls="detail-body"><span><small>Выбранный район</small><h1>${d.name}</h1></span>${silhouette(d.districtId,'mini-silhouette')}<span class="mobile-score">${score(d[mode].index)}<small>${mode==='after'?'+'+score(delta):''}</small></span><svg class="fold-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 14 6-6 6 6"/></svg></button><div class="detail-body" id="detail-body"><p class="detail-description">${d.description}</p><div class="index-label">Индекс района · ${mode==='after'?'после изменений':'до изменений'}</div><div class="district-score"><strong>${score(d[mode].index)}</strong>${mode==='after'?`<span class="delta">+${score(delta)}</span>`:''}</div><div class="score-track" style="--before:${d.before.index}%"><i style="width:${d[mode].index}%"></i><b></b></div><p class="score-baseline">${mode==='after'?`Было ${score(d.before.index)} · стало ${score(d.after.index)}`:'Исходный сценарий'}</p><p class="projects-title">${mode==='after'?'Появится в районе':'Новые проекты'}</p><button class="project-row school" data-kind="school" ${mode==='before'?'disabled':''}><span class="project-icon">${icon('school')}</span><span>${d[mode].newSchools} ${mode==='after'?'школа':'школ'}</span><span class="row-arrow" aria-hidden="true">↗</span></button><button class="project-row park" data-kind="park" ${mode==='before'?'disabled':''}><span class="project-icon">${icon('park')}</span><span>${d[mode].newParks} ${mode==='after'?'парк':'парков'}</span><span class="row-arrow" aria-hidden="true">↗</span></button><p class="detail-footnote">${mode==='after'?'Выберите проект, чтобы увидеть его на карте. Размещение условное.':'Включите «После», чтобы увидеть условные проекты района.'}</p></div>`;
    detail.querySelector('.detail-heading').onclick=()=>{if(!mobile())return;detail.classList.toggle('expanded');detail.querySelector('.detail-heading').setAttribute('aria-expanded',String(detail.classList.contains('expanded')))};
    detail.querySelectorAll('.project-row').forEach(el=>el.onclick=()=>{const f=projects.features.find(f=>f.properties.districtId===selectedId&&f.properties.kind===el.dataset.kind);inspectProject(f,true)});
  }
  $('.legend').hidden=mode!=='after';
  if(loaded){
    map.setFilter('selected-outline',['==',['get','districtId'],selectedId||'']);
    map.setPaintProperty('selected-outline','line-color',colors.fill);
    map.setFilter('selected-fill',['==',['get','districtId'],selectedId||'']);
    ['decision-green','decision-building','decision-transport-casing','decision-transport'].forEach(id=>map.setLayoutProperty(id,'visibility',mode==='after'?'visible':'none'));
  }
  markers.forEach(({element,feature})=>{element.hidden=mode!=='after';element.style.display=mode==='after'?'':'none';element.classList.toggle('selected',feature.properties.districtId===selectedId)});
  labels.forEach(({element,id})=>element.classList.toggle('selected',id===selectedId));
  const heading=$('.detail-heading');
  if(heading&&!mobile()){const title=document.createElement('div');title.className='detail-heading';title.innerHTML=heading.innerHTML;heading.replaceWith(title)}
  syncPanels();
}
function padding(selected=false){const dock=panelMode==='closed'?0:$('.district-navigation').getBoundingClientRect().height;return mobile()?{top:35,bottom:Math.min(dock+(selected?100:35),Math.max(35,$('.workspace').clientHeight*.6)),left:28,right:28}:{top:70,bottom:dock+55,left:55,right:selected?360:55}}
function cityFit(duration=500){map.fitBounds([[71.27,51.065],[71.56,51.22]],{padding:padding(),duration:reduced?0:duration})}
function select(id,fly=false){selectedId=id;popup?.remove();$('#district-detail').classList.remove('expanded');setPanels('pinned');render();if(fly&&loaded){const f=zones.features.find(f=>f.properties.districtId===id);const b=f.geometry.coordinates[0].reduce((acc,p)=>acc.extend(p),new maplibregl.LngLatBounds());map.fitBounds(b,{padding:padding(true),maxZoom:12,duration:reduced?0:550})}}
function inspectProject(feature,fly=false){
  if(!feature||mode!=='after')return;
  setPanels('pinned');
  if(feature.properties.districtId)select(feature.properties.districtId);
  popup?.remove();
  if(fly)map.easeTo({center:feature.geometry.coordinates,zoom:Math.max(map.getZoom(),12),offset:mobile()?[0,-35]:[-140,25],duration:reduced?0:500});
  const content=document.createElement('div'),title=document.createElement('b'),text=document.createElement('p');
  title.textContent=feature.properties.name;text.textContent='Демонстрационное размещение';content.append(title,text);
  popup=new maplibregl.Popup({offset:23,maxWidth:'260px'}).setLngLat(feature.geometry.coordinates).setDOMContent(content).addTo(map);
}
map.on('load',()=>{
  loaded=true;$('#map-status').hidden=true;
  map.getStyle().layers.filter(l=>l.type==='fill'&&/^water$|^water_/.test(l.id)).forEach(l=>map.setPaintProperty(l.id,'fill-color','#bfd5db'));
  map.getStyle().layers.filter(l=>l.type==='symbol'&&/city/.test(l.id)).forEach(l=>map.setLayoutProperty(l.id,'text-size',11));
  const firstLabel=map.getStyle().layers.find(l=>l.type==='symbol')?.id;
  map.addSource('zones',{type:'geojson',data:zones});
  map.addLayer({id:'zone-fills',type:'fill',source:'zones',paint:{'fill-color':'#a1afb8','fill-opacity':.08}},firstLabel);
  map.addLayer({id:'zone-borders',type:'line',source:'zones',paint:{'line-color':'#73878f','line-width':1.2,'line-opacity':.5,'line-dasharray':[4,3]}},firstLabel);
  map.addLayer({id:'selected-fill',type:'fill',source:'zones',filter:['==',['get','districtId'],selectedId||''],paint:{'fill-color':'#c7cfe0','fill-opacity':.23}},firstLabel);
  map.addLayer({id:'selected-outline',type:'line',source:'zones',filter:['==',['get','districtId'],selectedId||''],paint:{'line-color':districtPalette(selectedId).fill,'line-width':2.5,'line-opacity':.9}});
  map.addSource('decisions',{type:'geojson',data:decisions});
  map.addLayer({id:'decision-green',type:'fill',source:'decisions',filter:['==',['get','kind'],'green'],paint:{'fill-color':'#789f69','fill-opacity':.72,'fill-outline-color':'#557b4c'}});
  map.addLayer({id:'decision-building',type:'fill',source:'decisions',filter:['==',['get','kind'],'building'],paint:{'fill-color':'#c2946b','fill-opacity':.85,'fill-outline-color':'#a3704c'}});
  map.addLayer({id:'decision-transport-casing',type:'line',source:'decisions',filter:['==',['get','kind'],'transport'],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#fff','line-width':5,'line-opacity':.8}});
  map.addLayer({id:'decision-transport',type:'line',source:'decisions',filter:['==',['get','kind'],'transport'],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#637b9a','line-width':2.5}});
  const labelPositions={'Есиль':[71.417,51.15],'Алматы':[71.511,51.134],'Сарыарка':[71.348,51.201],'Байконур':[71.479,51.201],'Нура':[71.319,51.152]};
  Object.entries(labelPositions).forEach(([id,lnglat])=>{const el=document.createElement('span');el.className='zone-label';el.textContent=id;new maplibregl.Marker({element:el}).setLngLat(lnglat).addTo(map);labels.push({element:el,id})});
  [...projects.features,...decisions.features.filter(f=>f.properties.kind==='service')].forEach(feature=>{const el=document.createElement('button');el.type='button';el.className=`project-marker ${feature.properties.kind}`;el.setAttribute('aria-label',feature.properties.name);el.innerHTML=icon(feature.properties.kind)+`<span>${feature.properties.kind==='school'?'Новая школа':feature.properties.kind==='park'?'Новый парк':'Сервис'}</span>`;el.onclick=e=>{e.stopPropagation();inspectProject(feature)};new maplibregl.Marker({element:el}).setLngLat(feature.geometry.coordinates).addTo(map);markers.push({element:el,feature})});
  map.on('click',e=>{
    const decision=mode==='after'?map.queryRenderedFeatures(e.point,{layers:['decision-building','decision-green','decision-transport']})[0]:null;
    if(decision){districtClicks.add(e.originalEvent);inspectProject({...decision,geometry:{type:'Point',coordinates:e.lngLat.toArray()}});return}
    const zone=map.queryRenderedFeatures(e.point,{layers:['zone-fills']})[0];
    if(zone&&(zone.properties.districtId!==selectedId||panelMode==='closed')){districtClicks.add(e.originalEvent);select(zone.properties.districtId)}
  });
  map.on('mouseenter','zone-fills',()=>map.getCanvas().style.cursor='pointer');map.on('mouseleave','zone-fills',()=>map.getCanvas().style.cursor='');
  cityFit(0);render();
});
map.on('resize',()=>{if(loaded){cityFit(0);render()}});
map.on('error',()=>{if(!loaded){$('#map-status').hidden=false;$('#map-status').innerHTML='Карта не загрузилась.<button id="retry-map">Попробовать ещё раз</button>';$('#retry-map').onclick=()=>location.reload()}});
$('#district-list').addEventListener('click',e=>{const b=e.target.closest('[data-id]');if(b)select(b.dataset.id,true)});
['before','after'].forEach(id=>$('#'+id).onclick=()=>{mode=id;popup?.remove();render()});
function reset(){selectedId=null;popup?.remove();$('#district-detail').classList.remove('expanded');setPanels('closed');render();if(loaded)cityFit()}
$('#city-reset').onclick=reset;$('.identity').onclick=e=>{e.preventDefault();reset()};
$('#zoom-in').onclick=()=>map.zoomIn({duration:reduced?0:200});$('#zoom-out').onclick=()=>map.zoomOut({duration:reduced?0:200});
if(mobile())$('.legend').open=false;
render();
