import { useCallback, useEffect, useMemo, useState } from 'react';
import CityMap from './CityMap';
import MeasureCatalog from './MeasureCatalog';
import { DistrictSilhouette } from './DistrictSilhouette';
import UiIcon from './UiIcon';
import { districtById, districts } from './data';
import type { DistrictId, Mode } from './data';
import { BASELINE, validatePlan } from './model';
import { DIRECTION_LABELS, INDICATORS, POPULATION_SHARES, measureById } from './modelData';
import type { PlanItem } from './modelData';
import { useSavedPlan } from './useSavedPlan';
import { delta, number } from './format';
import { useScenario } from './useScenario';
import ScenarioInsights from './ScenarioInsights';
import { DISTRICT_API_IDS } from './api';

const EXAMPLE_PLAN: PlanItem[] = [
  { measureId: 'M7', districtId: 'Нура' }, { measureId: 'M8', districtId: 'Нура' },
  { measureId: 'M10', districtId: 'Нура' }, { measureId: 'M12', districtId: null },
  { measureId: 'M5', districtId: 'Сарыарка' },
];

export default function App() {
  const [mode, setMode] = useState<Mode>('before');
  const [selectedId, setSelectedId] = useState<DistrictId | null>(null);
  const [resetVersion, setResetVersion] = useState(0);
  const [catalogDistrict, setCatalogDistrict] = useState<DistrictId | null>(null);
  const [districtsOpen, setDistrictsOpen] = useState(true);
  const [planOpen, setPlanOpen] = useState(false);
  const [recalculateKey, setRecalculateKey] = useState<string | null>(null);
  const { plan, setPlan, storageStatus, storageMessage } = useSavedPlan();
  const validation = useMemo(() => validatePlan(plan), [plan]);
  const scenario = useScenario(plan);
  const result = scenario.response?.result ?? null;
  const simulation = scenario.response?.simulation ?? null;
  const after = mode === 'after' && result !== null;
  const displayed = after ? result : BASELINE;
  const selected = selectedId ? districtById.get(selectedId) : null;
  const selectedResult = selectedId ? simulation?.districts.find((item) => item.district_id === DISTRICT_API_IDS[selectedId]) : undefined;
  const closeCatalog = useCallback(() => setCatalogDistrict(null), []);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (catalogDistrict) setCatalogDistrict(null);
      else if (planOpen) setPlanOpen(false);
      else setSelectedId(null);
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [catalogDistrict, planOpen]);

  function changePlan(next: PlanItem[]) { setRecalculateKey(null); scenario.reset(); setPlan(next); setMode('before'); }
  function applyRecommendation(next: PlanItem[]) {
    changePlan(next);
    setPlanOpen(true);
    setRecalculateKey(JSON.stringify(next));
  }
  useEffect(() => {
    if (recalculateKey === null || recalculateKey !== JSON.stringify(plan)) return;
    setRecalculateKey(null);
    if (!validation.valid) return;
    void scenario.calculate().then((calculated) => { if (calculated) setMode('after'); });
  }, [recalculateKey, plan, validation.valid, scenario.calculate]);
  async function showScenario() {
    if (!validation.valid || scenario.loading) return;
    if (!result) {
      setPlanOpen(true);
      closeCatalog();
      if (!await scenario.calculate()) return;
    }
    closeCatalog();
    setPlanOpen(false);
    setMode('after');
  }
  function pickDistrict(id: DistrictId | null) {
    setSelectedId(id);
    setPlanOpen(false);
    if (id) setDistrictsOpen(true);
    if (catalogDistrict && id) setCatalogDistrict(id);
  }
  function openCatalog(id: DistrictId = selectedId ?? 'Нура') {
    setPlanOpen(false);
    setCatalogDistrict(id);
  }
  function resetCity() {
    setSelectedId(null);
    closeCatalog();
    setPlanOpen(false);
    setResetVersion((value) => value + 1);
  }

  return <div className="atlas-shell" data-districts-open={districtsOpen}>
    <header className="topbar">
      <button className="panels-menu" type="button" aria-label={districtsOpen ? 'Скрыть меню районов' : 'Открыть меню районов'} aria-expanded={districtsOpen} aria-controls="district-navigation" onClick={() => setDistrictsOpen(!districtsOpen)}><UiIcon name="menu" /></button>
      <button className="identity" type="button" aria-label="Астана — весь город" onClick={resetCity}>
        <span className="identity-mark" aria-hidden="true"><i /><i /><i /></span>
        <span><strong>Астана</strong><small>Игровая карта города</small></span>
      </button>
      <div className="comparison">
        <div className="mode-switch" role="group" aria-label="Сравнение сценариев">
          <button type="button" aria-label="До — сейчас" aria-pressed={!after} onClick={() => { if (scenario.loading) scenario.reset(); setMode('before'); }}>До<small>сейчас</small></button>
          <button type="button" aria-label="После — сценарий" aria-pressed={after} disabled={!validation.valid || scenario.loading} onClick={showScenario}>После<small>сценарий</small></button>
        </div>
        <div className="city-result" aria-label="Расчёт Score">
          <span>{after ? 'ИТОГОВЫЙ SCORE' : 'Базовый Score'}</span>
          <strong>{displayed.score.toFixed(5)}</strong>
          {after && <small>{delta(simulation!.score.score_delta, 2)}</small>}
        </div>
      </div>
      <button className="plan-toggle" type="button" aria-label="Мой план" aria-expanded={planOpen} aria-controls="plan-panel" onClick={() => { setPlanOpen(!planOpen); closeCatalog(); }}><UiIcon name="plan" /><span>Мой план<small>{validation.cost} / 100 бюджета</small></span><b>{plan.length}<i>/5</i></b></button>
      <button type="button" className="city-reset" aria-label="Показать всю Астану" onClick={resetCity}><UiIcon name="city" /><span>Весь город</span></button>
    </header>

    <main className="atlas-workspace">
      <section className="map-stage" aria-label="Карта Астаны">
        <CityMap mode={after ? 'after' : 'before'} plan={plan} districtsOpen={districtsOpen} selectedId={selectedId} onSelect={pickDistrict} resetVersion={resetVersion} />
        <div className="map-caption"><span className="keyline" /><span>{after ? <>Сценарий через 8 кварталов.<br /><strong>Сравните изменения в районах.</strong></> : <>Выберите район на карте,<br /><strong>чтобы составить план изменений.</strong></>}</span></div>
        {after && <details className="legend"><summary>На карте <span aria-hidden="true">⌃</span></summary><div><span><i className="legend-building" />Школы</span><span><i className="legend-green" />Парки</span><span><i className="legend-service" />Другие меры</span></div><p>Только мероприятия вашего плана</p></details>}
        <p className="demo-note">Игровые границы и размещение объектов — демонстрационные.</p>

        {selected && districtsOpen && !catalogDistrict && <article className="district-card" data-id={selected.districtId} aria-labelledby="district-title">
          <div className="card-top"><span className="card-kicker">{after ? 'Сценарий через 8 кварталов' : 'Выбранный район'}</span><button type="button" className="card-close" aria-label="Закрыть карточку" onClick={() => setSelectedId(null)}><UiIcon name="close" /></button></div>
          <div className="card-title-row"><div><h1 id="district-title">{selected.name}</h1><span className="card-small">{number(POPULATION_SHARES[selected.districtId] * 100)}% населения города</span></div><DistrictSilhouette districtId={selected.districtId} /></div>
          <p className="card-description">{selected.description}</p>
          <div className="index-label">Индекс района · {after ? 'после изменений' : 'исходный'}</div>
          <div className="district-score"><strong>{number(displayed.districtIndices[selected.districtId], 2)}</strong>{after && <span className="positive">{delta(selectedResult!.score_delta, 2)}</span>}</div>
          <div className="score-track"><i style={{ width: displayed.districtIndices[selected.districtId] + '%' }} /><b style={{ left: (after ? selectedResult!.score_before : BASELINE.districtIndices[selected.districtId]) + '%' }} /></div>
          <p className="score-baseline">{after ? <>{number(selectedResult!.score_before, 5)} → {number(result.districtIndices[selected.districtId], 5)}</> : 'Исходные показатели учебного датасета'}</p>
          <button type="button" className="primary-action" onClick={() => openCatalog(selected.districtId)}>Подобрать меры<UiIcon name="arrow" /></button>
          <p className="indicator-note">T1 — «Разгрузка дорог» по ТЗ (0–100). Он не равен текущему баллу пробок 2ГИС.</p>
          <table className="indicator-table"><caption>Показатели района · чем выше, тем лучше</caption><thead><tr><th>Показатель</th><th>{after ? 'До → после' : 'До'}</th>{after && <th>Δ</th>}</tr></thead><tbody>
            {INDICATORS.map(({ key, name }) => {
              const serverMetric = selectedResult?.indicators.find((item) => item.code === key);
              const before = after ? serverMetric!.before : BASELINE.indicators[selected.districtId][key];
              const value = displayed.indicators[selected.districtId][key];
              return <tr key={key} className={value < 40 ? 'critical-indicator' : ''}><th scope="row"><b>{key}</b> {name}</th><td>{number(before)}{after && <> → {number(value)}</>}</td>{after && <td className={value < before ? 'negative' : value > before ? 'positive' : ''}>{delta(serverMetric!.delta)}</td>}</tr>;
            })}
          </tbody></table>
          <p className="indicator-note">Значения ниже 40 дают штраф в Score.</p>
          <div className="card-foot">ГРАНИЦЫ И РАЗМЕЩЕНИЕ ДЕМОНСТРАЦИОННЫЕ</div>
        </article>}

        <aside className="plan-panel" id="plan-panel" aria-label="Мой план" hidden={!planOpen}>
          <div className="panel-heading"><div><span className="card-kicker">Горизонт · 8 кварталов</span><h2>Мой план</h2></div><button type="button" className="card-close" aria-label="Закрыть план" onClick={() => setPlanOpen(false)}><UiIcon name="close" /></button></div>
          <div className="plan-content">
            <p className="intro">Выберите 5 мероприятий, чтобы увидеть, как изменится город.</p>
            <div className="plan-totals" aria-label="Бюджет и количество решений"><div><span>Потрачено</span><strong className={validation.cost > 100 ? 'negative' : ''}>{validation.cost}<small> / 100</small></strong></div><div><span>Решения</span><strong>{plan.length}<small> / 5</small></strong></div></div>
            <meter className="budget-meter" min="0" max="100" value={Math.min(100, validation.cost)} aria-label="Потраченный бюджет" />
            <section className="user-plan" aria-labelledby="plan-title">
              <h3 id="plan-title">Выбранные мероприятия</h3>
              {plan.length === 0 ? <div className="empty-plan"><p>План пока пуст. Начните с района или каталога мер.</p><button type="button" className="text-action" onClick={() => changePlan(EXAMPLE_PLAN)}>Загрузить пример из ТЗ</button></div> : <ol className="plan-items">
                {plan.map((item, index) => {
                  const measure = measureById.get(item.measureId)!;
                  return <li key={item.measureId + '-' + index}><div className="plan-item-heading"><strong><b>{item.measureId}</b>{measure.name}</strong><button type="button" className="remove-measure" aria-label={'Удалить ' + item.measureId + ' из плана'} onClick={() => changePlan(plan.filter((_, i) => i !== index))}><UiIcon name="close" /></button></div>
                    <div className="plan-item-detail"><span>{measure.cost} ед. · {DIRECTION_LABELS[measure.direction]}</span>{measure.scope === 'district' ? <select aria-label={item.measureId + ': целевой район'} value={item.districtId ?? ''} onChange={(e) => changePlan(plan.map((p, i) => i === index ? { ...p, districtId: e.target.value as DistrictId } : p))}><option value="" disabled>Выберите район</option>{districts.map((district) => <option key={district.districtId}>{district.districtId}</option>)}</select> : <span>Весь город{item.districtId !== null && <button type="button" className="text-action" onClick={() => changePlan(plan.map((p, i) => i === index ? { ...p, districtId: null } : p))}>Убрать целевой район</button>}</span>}</div>
                  </li>;
                })}
              </ol>}
              <button type="button" className="secondary-action" onClick={() => openCatalog()}>Добавить мероприятие<UiIcon name="arrow" /></button>
              <div className="plan-validation" aria-live="polite">{validation.valid ? <p className="valid-plan">План допустим. Можно рассчитать сценарий.</p> : <ul>{validation.issues.map((issue, index) => <li key={issue.code + '-' + index}>{issue.message}</li>)}</ul>}</div>
              <button type="button" className="primary-action calculate-button" disabled={!validation.valid || scenario.loading} aria-busy={scenario.loading} onClick={showScenario}>{scenario.loading ? 'Рассчитываем…' : 'Рассчитать сценарий'}</button>
              {scenario.loading && <p className="save-status" role="status">Проверяем план и рассчитываем изменения районов…</p>}
              {scenario.error && <p className="save-status save-warning" role="alert">{scenario.error} Нажмите «Рассчитать сценарий», чтобы повторить.</p>}
              <p className={'save-status' + (storageStatus === 'saved' ? '' : ' save-warning')} role="status">{storageMessage ?? (storageStatus === 'saved' ? 'План сохранён в этом браузере.' : 'Сохраняем план…')}</p>
            </section>
            <div className="score-summary">{after ? <details className="score-explanation"><summary>Как получен результат</summary><p>0,7 × средний индекс по населению + 0,3 × минимальный индекс − число критических показателей.</p><dl><div><dt>Средневзвешенный D</dt><dd>{number(result.weightedIndex, 5)}</dd></div><div><dt>Минимальный D</dt><dd>{number(result.minIndex, 5)}</dd></div><div><dt>Значений строго ниже 40</dt><dd>{simulation!.score.critical_count_before} → {result.criticalCount}</dd></div></dl></details> : <p className="score-pending">Итоговый Score появится после расчёта допустимого плана из 5 мер.</p>}</div>
            {scenario.response && <ScenarioInsights key={JSON.stringify(plan)} plan={plan} simulation={scenario.response.simulation} analysis={scenario.analysis} analysisLoading={scenario.analysisLoading} analysisError={scenario.analysisError} onRetryAnalysis={scenario.retryAnalysis} onApply={applyRecommendation} />}
          </div>
        </aside>
        {catalogDistrict && <MeasureCatalog plan={plan} districtId={catalogDistrict} onDistrict={(id) => { setCatalogDistrict(id); setSelectedId(id); }} onChange={changePlan} onClose={closeCatalog} />}
      </section>
    </main>

    <footer className="district-navigation" id="district-navigation" hidden={!districtsOpen}>
      <div className="dock-heading"><strong>Выберите район</strong><span>Сравните, что изменится</span><button type="button" className="text-action" onClick={() => openCatalog()}>Каталог мероприятий<UiIcon name="arrow" /></button></div>
      <nav className="district-list" aria-label="Игровые районы">{districts.map((district) => <button type="button" className="district-choice" data-id={district.districtId} key={district.districtId} aria-pressed={selectedId === district.districtId} onClick={() => pickDistrict(district.districtId)}><DistrictSilhouette districtId={district.districtId} /><span><strong>{district.name}</strong><small>Индекс {number(displayed.districtIndices[district.districtId], 2)}{after && <b>{delta(simulation!.districts.find((item) => item.district_id === DISTRICT_API_IDS[district.districtId])!.score_delta, 2)}</b>}</small></span></button>)}</nav>
    </footer>
    {!districtsOpen && <button className="drawer-edge" type="button" aria-label="Развернуть районы" onClick={() => setDistrictsOpen(true)}><span /></button>}
  </div>;
}
