import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { districtById, type DistrictId } from './data';
import { measureById, type MeasureId, type PlanItem } from './modelData';

export const PLAN_STORAGE_KEY = 'astana-atlas-plan-v1';
export type PlanStorageStatus = 'saved' | 'unavailable' | 'invalid-data' | 'loading';

type SavedPlanState = {
  plan: PlanItem[];
  storageStatus: PlanStorageStatus;
  storageMessage: string | null;
  revision: number;
};

const UNAVAILABLE_MESSAGE = 'Не удалось сохранить план в браузере. Расчёт доступен, но изменения могут потеряться после перезагрузки.';
const INVALID_DATA_MESSAGE = 'Сохранённый план повреждён или имеет неподдерживаемую версию. Создайте новый план; старые данные заменятся только после изменения плана.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate the storage schema only. Business-rule errors must remain editable in the UI. */
function readPlan(payload: unknown): PlanItem[] | null {
  if (!isRecord(payload) || payload.version !== 1 || !Array.isArray(payload.plan)) return null;

  const plan: PlanItem[] = [];
  for (const item of payload.plan) {
    if (!isRecord(item)
      || typeof item.measureId !== 'string'
      || !measureById.has(item.measureId as MeasureId)
      || !(item.districtId === null
        || (typeof item.districtId === 'string' && districtById.has(item.districtId as DistrictId)))) {
      return null;
    }
    // Keep null targets, city measures with a district, duplicates and other rule errors.
    // validatePlan in the scenario model reports these without losing the user's work.
    plan.push({ measureId: item.measureId as MeasureId, districtId: item.districtId as DistrictId | null });
  }
  return plan;
}

function loadPlan(): SavedPlanState {
  const initial: SavedPlanState = { plan: [], storageStatus: 'saved', storageMessage: null, revision: 0 };
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(PLAN_STORAGE_KEY);
  } catch {
    return { ...initial, storageStatus: 'unavailable', storageMessage: UNAVAILABLE_MESSAGE };
  }
  if (raw === null) return initial;

  try {
    const plan = readPlan(JSON.parse(raw));
    if (plan !== null) return { ...initial, plan };
  } catch {
    // Keep the original value intact until the user explicitly edits or clears the plan.
  }
  return { ...initial, storageStatus: 'invalid-data', storageMessage: INVALID_DATA_MESSAGE };
}

export function useSavedPlan(): {
  plan: PlanItem[];
  setPlan: Dispatch<SetStateAction<PlanItem[]>>;
  storageStatus: PlanStorageStatus;
  storageMessage: string | null;
} {
  const [state, setState] = useState<SavedPlanState>(loadPlan);

  const setPlan = useCallback<Dispatch<SetStateAction<PlanItem[]>>>((action) => {
    setState((previous) => ({
      plan: typeof action === 'function' ? action(previous.plan) : action,
      storageStatus: 'loading',
      storageMessage: null,
      revision: previous.revision + 1,
    }));
  }, []);

  useEffect(() => {
    // No mount-time write: it would overwrite unreadable data and breaks StrictMode recovery.
    if (state.revision === 0) return;
    let storageStatus: PlanStorageStatus = 'saved';
    let storageMessage: string | null = null;
    try {
      window.localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify({
        version: 1,
        plan: state.plan.map(({ measureId, districtId }) => ({ measureId, districtId })),
      }));
    } catch {
      storageStatus = 'unavailable';
      storageMessage = UNAVAILABLE_MESSAGE;
    }
    setState((current) => current.revision !== state.revision
      ? current
      : { ...current, storageStatus, storageMessage });
  }, [state.plan, state.revision]);

  return { plan: state.plan, setPlan, storageStatus: state.storageStatus, storageMessage: state.storageMessage };
}
