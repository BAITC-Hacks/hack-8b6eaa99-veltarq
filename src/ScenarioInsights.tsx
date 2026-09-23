import { useEffect, useRef, useState } from 'react';
import { comparePlans, recommendPlans } from './api';
import type { AnalysisResult, BackendSimulation } from './api';
import { delta, number } from './format';
import { measureById } from './modelData';
import type { PlanItem } from './modelData';

type Recommendations = Awaited<ReturnType<typeof recommendPlans>>;
type Comparison = Awaited<ReturnType<typeof comparePlans>>;
type RequestState<T> = { key: string; loading: boolean; data?: T; error?: string };
type ComparisonState = RequestState<Comparison> & { candidateIndex: number };

type Props = {
  plan: readonly PlanItem[];
  simulation: BackendSimulation;
  analysis: AnalysisResult | null;
  analysisLoading?: boolean;
  analysisError?: string | null;
  onRetryAnalysis?: () => void;
  onApply: (plan: PlanItem[]) => void;
};

function fallbackReason(reason?: string | null) {
  const reasons: Record<string, string> = {
    not_configured: 'ИИ пока не настроен на сервере.',
    disabled: 'ИИ выключен в настройках сервера.',
    timeout: 'Сервис ИИ не ответил вовремя.',
    provider_error: 'Сервис ИИ временно недоступен.',
    invalid_response: 'Ответ ИИ не прошёл проверку достоверности.',
    request_failed: 'Не удалось получить объяснение от сервера.',
  };
  return reasons[reason ?? ''] ?? 'Сервис ИИ недоступен. Показаны данные серверного расчёта.';
}

function Explanation({ analysis }: { analysis: AnalysisResult }) {
  const sections = [
    { title: 'Сильные стороны', items: analysis.strengths },
    { title: 'Риски', items: analysis.risks },
    { title: 'Компромиссы', items: analysis.tradeoffs },
    { title: 'Рекомендации', items: analysis.recommendations },
  ];
  return <>
    <p className="save-status">{analysis.provider === 'llm' ? 'Объяснение подготовлено языковой моделью (LLM) на основе расчёта сервера.' : 'Автоматическое объяснение без ИИ'}</p>
    {analysis.provider !== 'llm' && <p className="save-status save-warning">{fallbackReason(analysis.fallback_reason)}</p>}
    <p>{analysis.summary}</p>
    {sections.map(({ title, items }) => <section key={title} aria-label={title}>
      <h3>{title}</h3>
      {items.length > 0 ? <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>Не отмечены.</p>}
    </section>)}
  </>;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function ScenarioInsights({ plan, simulation, analysis, analysisLoading = false, analysisError, onRetryAnalysis, onApply }: Props) {
  const planKey = JSON.stringify(plan);
  const [search, setSearch] = useState<RequestState<Recommendations> | null>(null);
  const [comparison, setComparison] = useState<ComparisonState | null>(null);
  const searchRequest = useRef<AbortController | null>(null);
  const compareRequest = useRef<AbortController | null>(null);
  const currentKey = useRef(planKey);
  currentKey.current = planKey;
  const revision = useRef(0);
  const currentSearch = search?.key === planKey ? search : null;
  const currentComparison = comparison?.key === planKey ? comparison : null;

  useEffect(() => {
    setSearch(null);
    setComparison(null);
    return () => {
      revision.current += 1;
      searchRequest.current?.abort();
      compareRequest.current?.abort();
    };
  }, [planKey]);

  async function findImprovements() {
    searchRequest.current?.abort();
    compareRequest.current?.abort();
    const controller = new AbortController();
    const id = ++revision.current;
    searchRequest.current = controller;
    setSearch({ key: planKey, loading: true });
    setComparison(null);
    try {
      const data = await recommendPlans(plan, controller.signal);
      if (!controller.signal.aborted && id === revision.current && currentKey.current === planKey) setSearch({ key: planKey, loading: false, data });
    } catch (error) {
      if (!controller.signal.aborted && id === revision.current && currentKey.current === planKey) {
        setSearch({ key: planKey, loading: false, error: errorMessage(error, 'Не удалось найти улучшения. Попробуйте снова.') });
      }
    }
  }

  async function compareCandidate(candidate: Recommendations['candidates'][number], candidateIndex: number) {
    compareRequest.current?.abort();
    const controller = new AbortController();
    const id = ++revision.current;
    compareRequest.current = controller;
    setComparison({ key: planKey, candidateIndex, loading: true });
    try {
      const data = await comparePlans(plan, candidate.plan, controller.signal);
      if (!controller.signal.aborted && id === revision.current && currentKey.current === planKey) setComparison({ key: planKey, candidateIndex, loading: false, data });
    } catch (error) {
      if (!controller.signal.aborted && id === revision.current && currentKey.current === planKey) {
        setComparison({ key: planKey, candidateIndex, loading: false, error: errorMessage(error, 'Не удалось сравнить сценарии. Попробуйте снова.') });
      }
    }
  }

  return <details className="score-explanation">
    <summary>Анализ и улучшение плана</summary>
    {analysisLoading && <p className="save-status" role="status">Готовим объяснение по рассчитанному сценарию…</p>}
    {analysisError && <p className="save-status save-warning" role="alert">{analysisError} Расчёт сценария сохранён.</p>}
    {analysis && <Explanation analysis={analysis} />}
    {onRetryAnalysis && <button className="text-action" type="button" disabled={analysisLoading} onClick={onRetryAnalysis}>{analysisLoading ? 'Готовим объяснение…' : 'Повторить запрос объяснения'}</button>}

    <details className="score-explanation">
      <summary>Синергии и вклад мероприятий</summary>
      <p>Активированные синергии: {simulation.activated_synergies.length ? simulation.activated_synergies.join(', ') : 'нет'}.</p>
      <p className="indicator-note">Вклад показан с учётом лага за {simulation.horizon_quarters} кварталов, до ограничения итоговых показателей диапазоном 0–100.</p>
      <table className="indicator-table">
        <caption>Вклад в показатели районов</caption>
        <thead><tr><th>Источник и район</th><th>Показатель</th><th>Вклад</th></tr></thead>
        <tbody>{simulation.contributions.map((contribution, index) => <tr key={index}>
          <th scope="row">{contribution.source}{contribution.source_type === 'synergy' ? ' · синергия' : ''}<br />{simulation.districts.find((district) => district.district_id === contribution.district_id)?.district_name ?? contribution.district_id}</th>
          <td>{contribution.indicator_code}</td>
          <td className={contribution.delta < 0 ? 'negative' : contribution.delta > 0 ? 'positive' : ''}>{delta(contribution.delta)}</td>
        </tr>)}</tbody>
      </table>
    </details>

    <h3>Найденные улучшения</h3>
    <p>Поиск проверяет замену одной меры или перенос одной меры в другой район и ранжирует допустимые планы по Score. Это локальный поиск; глобальный максимум не гарантируется.</p>
    <button className="text-action" type="button" disabled={currentSearch?.loading} onClick={() => void findImprovements()}>
      {currentSearch?.loading ? 'Ищем улучшения…' : currentSearch?.error ? 'Повторить поиск' : 'Найти улучшения'}
    </button>
    {currentSearch?.loading && <p className="save-status" role="status">Сервер проверяет допустимые варианты.</p>}
    {currentSearch?.error && <p className="save-status save-warning" role="alert">{currentSearch.error}</p>}
    {currentSearch?.data && <>
      <p>Score текущего плана: {number(currentSearch.data.currentScore, 5)}.</p>
      {currentSearch.data.candidates.length === 0 ? <p role="status">Улучшений среди проверенных вариантов с одним изменением не найдено.</p> : <ol className="plan-items">
        {currentSearch.data.candidates.slice(0, 3).map((candidate, index) => {
          const candidateComparison = currentComparison?.candidateIndex === index ? currentComparison : null;
          return <li key={JSON.stringify(candidate.plan)}>
            <div className="plan-item-heading"><strong>Вариант {index + 1} · Score {number(candidate.score, 5)}</strong></div>
            <p>Изменение Score: {delta(candidate.improvement, 5)}. Бюджет: {candidate.budgetUsed} / 100; остаток: {candidate.budgetRemaining}.</p>
            <p>{candidate.plan.map((item) => `${item.measureId} ${measureById.get(item.measureId)?.name ?? ''} — ${item.districtId ?? 'весь город'}`).join('; ')}.</p>
            <p><button className="text-action" type="button" disabled={currentComparison?.loading} aria-label={`Сравнить вариант ${index + 1}`} onClick={() => void compareCandidate(candidate, index)}>
              {candidateComparison?.loading ? 'Сравниваем…' : candidateComparison?.error ? 'Повторить сравнение' : 'Сравнить с текущим планом'}
            </button></p>
            {candidateComparison?.loading && <p className="save-status" role="status">Сервер сравнивает два плана.</p>}
            {candidateComparison?.error && <p className="save-status save-warning" role="alert">{candidateComparison.error}</p>}
            {candidateComparison?.data && <div role="status">
              <p>Текущий план: Score {number(candidateComparison.data.first.score, 5)}. Альтернатива: Score {number(candidateComparison.data.second.score, 5)}.</p>
              <p>Разница Score: {number(candidateComparison.data.scoreDifference, 5)}. {candidateComparison.data.betterScenario === 'second' ? 'Предложенный вариант лучше по Score.' : candidateComparison.data.betterScenario === 'first' ? 'Текущий план лучше по Score.' : 'Score планов одинаков.'}</p>
              <Explanation analysis={candidateComparison.data.analysis} />
              <button className="text-action" type="button" onClick={() => void compareCandidate(candidate, index)}>Повторить запрос сравнения</button>
            </div>}
            <button className="text-action" type="button" aria-label={`Применить вариант ${index + 1}`} onClick={() => onApply(candidate.plan.map((item) => ({ ...item })))}>Применить вариант</button>
          </li>;
        })}
      </ol>}
    </>}
  </details>;
}
