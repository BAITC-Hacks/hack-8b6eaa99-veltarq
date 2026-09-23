import { useEffect, useRef, useState } from 'react';
import { districts } from './data';
import type { DistrictId } from './data';
import { validatePlan } from './model';
import { DIRECTION_LABELS, MEASURES } from './modelData';
import type { Direction, PlanItem } from './modelData';
import { delta, number } from './format';
import { previewMeasures } from './previewApi';
import type { MeasuresPreview } from './previewApi';
import UiIcon from './UiIcon';

type Props = {
  plan: PlanItem[];
  districtId: DistrictId;
  onDistrict: (district: DistrictId) => void;
  onChange: (plan: PlanItem[]) => void;
  onClose: () => void;
};

export default function MeasureCatalog({ plan, districtId, onDistrict, onChange, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [direction, setDirection] = useState<Direction | 'all'>('all');
  const [message, setMessage] = useState('');
  const [previewState, setPreviewState] = useState<{ key: string; data?: MeasuresPreview; error?: string }>({ key: '' });
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const previewKey = JSON.stringify({ plan, districtId });
  useEffect(() => {
    const controller = new AbortController();
    setPreviewState({ key: previewKey });
    void previewMeasures(plan, districtId, controller.signal).then((data) => {
      if (!controller.signal.aborted) setPreviewState({ key: previewKey, data });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setPreviewState({ key: previewKey, error: error instanceof Error ? error.message : 'Не удалось получить предпросмотр.' });
    });
    return () => controller.abort();
  }, [previewKey, previewAttempt]);
  const currentPreview = previewState.key === previewKey ? previewState : undefined;
  useEffect(() => {
    closeRef.current?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onClose]);

  return <section className="measure-catalog" aria-labelledby="catalog-title">
    <header className="catalog-head">
      <div><span className="card-kicker">14 МЕРОПРИЯТИЙ / ТЗ</span><h2 id="catalog-title">Подобрать меры</h2></div>
      <button ref={closeRef} type="button" className="card-close" aria-label="Закрыть каталог" onClick={onClose}><UiIcon name="close" /></button>
    </header>
    <div className="catalog-filters">
      <label>Целевой район<select value={districtId} onChange={(e) => onDistrict(e.target.value as DistrictId)}>
        {districts.map((d) => <option key={d.districtId} value={d.districtId}>{d.name}</option>)}
      </select></label>
      <label>Направление<select value={direction} onChange={(e) => setDirection(e.target.value as Direction | 'all')}>
        <option value="all">Все направления</option>
        {Object.entries(DIRECTION_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select></label>
      <p>Серверный предпросмотр через 8 кварталов относительно текущего плана. Учтены лаги, синергии и предел 100.</p>
      <div className="catalog-progress">Решений: {plan.length} / 5 · Бюджет: {validatePlan(plan).cost} / 100</div>
      <div className="catalog-feedback" role="status">{message}</div>
      {!currentPreview?.data && !currentPreview?.error && <p className="save-status" role="status">Сервер рассчитывает предпросмотр…</p>}
      {currentPreview?.error && <div className="save-status save-warning"><p role="alert">{currentPreview.error}</p><button type="button" className="text-action" onClick={() => setPreviewAttempt((attempt) => attempt + 1)}>Повторить предпросмотр</button></div>}
    </div>
    <div className="catalog-list">
      {MEASURES.filter((m) => direction === 'all' || m.direction === direction).map((measure) => {
        const existingIndex = plan.findIndex((item) => item.measureId === measure.id);
        const candidate: PlanItem = { measureId: measure.id, districtId: measure.scope === 'city' ? null : districtId };
        const proposed = [...plan, candidate];
        const validation = validatePlan(proposed, { complete: false });
        const preview = currentPreview?.data?.candidates.find((item) => item.measureId === measure.id);
        const changes = preview?.districts ?? [];
        return <article className="measure-option" key={measure.id} aria-label={`${measure.id} ${measure.name}`}>
          <div className="measure-meta"><span>{measure.id} · {DIRECTION_LABELS[measure.direction]}</span><strong>{measure.cost} ед.</strong></div>
          <h3>{measure.name}</h3>
          <p className="measure-scope">{measure.scope === 'city' ? 'Весь город · все 5 районов' : `Район: ${districtId}`} · Лаг {measure.lag} кв.</p>
          {existingIndex < 0 && changes.length > 0 && <div className="measure-preview">
            {changes.map(({ districtId: target, indicators }) => <div key={target}>
              <span className="preview-district">{districts.find((district) => district.districtId === target)?.name ?? target}</span>
              <span>{indicators.map((item) => `${item.code}: ${number(item.before)} → ${number(item.after)} (${delta(item.delta)})`).join(' · ')}</span>
            </div>)}
          </div>}
          {existingIndex >= 0 ? <>
            <p className="measure-scope">В плане: {plan[existingIndex].districtId ?? 'весь город'}</p>
            <button type="button" className="secondary-action" onClick={() => {
              onChange(plan.filter((_, index) => index !== existingIndex));
              setMessage(`${measure.id} удалено из плана.`);
            }}>Удалить {measure.id}</button>
          </> : <>
            <button type="button" className="primary-action" disabled={!validation.valid} aria-describedby={!validation.valid ? `reason-${measure.id}` : undefined} onClick={() => {
              onChange(proposed);
              setMessage(`${measure.id} добавлено: ${candidate.districtId ?? 'весь город'}.`);
            }}>Добавить {measure.id}</button>
            {!validation.valid && <p className="measure-reason" id={`reason-${measure.id}`}>{validation.issues.map((issue) => issue.message).join(' ')}</p>}
          </>}
        </article>;
      })}
    </div>
  </section>;
}
