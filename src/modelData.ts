import type { DistrictId } from './data';

export const INDICATOR_KEYS = ['T1', 'T2', 'E1', 'E2', 'S1', 'S2', 'B1', 'B2', 'C1', 'C2'] as const;
export type IndicatorKey = (typeof INDICATOR_KEYS)[number];
export type Direction = 'T' | 'E' | 'S' | 'B' | 'C';
export type MeasureId = `M${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14}`;
export type Indicators = Record<IndicatorKey, number>;
export type CityIndicators = Record<DistrictId, Indicators>;
export const SOURCE_URL = 'https://docs.google.com/document/d/1Uc-GdGoKhDY-spu8V50-ZMm33t2CjYLP/edit';

export const DISTRICT_IDS: readonly DistrictId[] = ['Есиль', 'Алматы', 'Сарыарка', 'Байконур', 'Нура'];
export const DIRECTION_LABELS: Record<Direction, string> = {
  T: 'Транспорт', E: 'Экология', S: 'Социальная сфера', B: 'Безопасность', C: 'Сервисы',
};

export type Indicator = { key: IndicatorKey; name: string; direction: Direction; weight: number };
/** Weights are integer percentages, summing to 100. */
export const INDICATORS: readonly Indicator[] = [
  { key: 'T1', name: 'Разгрузка дорог', direction: 'T', weight: 10 },
  { key: 'T2', name: 'Доступность общественного транспорта', direction: 'T', weight: 10 },
  { key: 'E1', name: 'Озеленение', direction: 'E', weight: 9 },
  { key: 'E2', name: 'Качество воздуха', direction: 'E', weight: 11 },
  { key: 'S1', name: 'Школы и детсады', direction: 'S', weight: 11 },
  { key: 'S2', name: 'Поликлиники и первичная медпомощь', direction: 'S', weight: 11 },
  { key: 'B1', name: 'Безопасность улиц', direction: 'B', weight: 9 },
  { key: 'B2', name: 'Безопасность дорожного движения', direction: 'B', weight: 9 },
  { key: 'C1', name: 'Надёжность ЖКХ', direction: 'C', weight: 10 },
  { key: 'C2', name: 'Скорость решения обращений жителей', direction: 'C', weight: 10 },
];
export const INDICATOR_LABELS = Object.fromEntries(INDICATORS.map((indicator) => [indicator.key, indicator.name])) as Record<IndicatorKey, string>;

export const BASE_INDICATORS: CityIndicators = {
  Есиль: { T1: 45, T2: 62, E1: 68, E2: 72, S1: 48, S2: 55, B1: 78, B2: 60, C1: 75, C2: 70 },
  Алматы: { T1: 40, T2: 75, E1: 50, E2: 55, S1: 60, S2: 65, B1: 62, B2: 52, C1: 50, C2: 60 },
  Сарыарка: { T1: 50, T2: 70, E1: 42, E2: 40, S1: 62, S2: 68, B1: 58, B2: 55, C1: 45, C2: 55 },
  Байконур: { T1: 52, T2: 68, E1: 55, E2: 50, S1: 58, S2: 60, B1: 52, B2: 58, C1: 55, C2: 58 },
  Нура: { T1: 55, T2: 40, E1: 45, E2: 65, S1: 38, S2: 35, B1: 55, B2: 50, C1: 60, C2: 50 },
};

/** Population fractions from the supplied synthetic dataset, not live demographics. */
export const POPULATION_SHARES: Record<DistrictId, number> = {
  Есиль: 0.27, Алматы: 0.24, Сарыарка: 0.20, Байконур: 0.13, Нура: 0.16,
};

export type Measure = {
  id: MeasureId;
  name: string;
  direction: Direction;
  cost: number;
  lag: number;
  scope: 'district' | 'city';
  /** Full effects before applying the eight-quarter lag multiplier. */
  effects: Partial<Record<IndicatorKey, number>>;
};
export type PlanItem = { measureId: MeasureId; districtId: DistrictId | null };

export const MEASURES: readonly Measure[] = [
  { id: 'M1', name: 'Выделенные полосы для автобусов', direction: 'T', cost: 18, lag: 2, scope: 'district', effects: { T1: 6, T2: 9 } },
  { id: 'M2', name: 'Умные светофоры (адаптивное управление)', direction: 'T', cost: 22, lag: 2, scope: 'city', effects: { T1: 4, B2: 3 } },
  { id: 'M3', name: 'Линия ЛРТ / расширение', direction: 'T', cost: 30, lag: 4, scope: 'district', effects: { T1: 16, T2: 20, E2: 4 } },
  { id: 'M4', name: 'Парк / сквер', direction: 'E', cost: 15, lag: 2, scope: 'district', effects: { E1: 12, E2: 3, B1: 2 } },
  { id: 'M5', name: 'Перевод частного сектора на чистое топливо', direction: 'E', cost: 25, lag: 3, scope: 'district', effects: { E2: 14, C1: 4 } },
  { id: 'M6', name: 'Городская программа озеленения и ветрозащитных полос', direction: 'E', cost: 20, lag: 4, scope: 'city', effects: { E1: 5, E2: 3 } },
  { id: 'M7', name: 'Школа + детсад (модульное строительство)', direction: 'S', cost: 24, lag: 3, scope: 'district', effects: { S1: 16 } },
  { id: 'M8', name: 'Центр семейного здоровья / поликлиника', direction: 'S', cost: 20, lag: 3, scope: 'district', effects: { S2: 14 } },
  { id: 'M9', name: 'Дворовые спорт-хабы', direction: 'S', cost: 10, lag: 1, scope: 'district', effects: { S1: 3, S2: 3, B1: 3 } },
  { id: 'M10', name: 'Освещение и камеры (расширение Safe City)', direction: 'B', cost: 12, lag: 1, scope: 'district', effects: { B1: 12, B2: 2 } },
  { id: 'M11', name: 'Безопасные переходы и школьные зоны', direction: 'B', cost: 10, lag: 1, scope: 'district', effects: { B2: 12, T1: -2 } },
  { id: 'M12', name: 'Единая цифровая платформа обращений', direction: 'C', cost: 14, lag: 1, scope: 'city', effects: { C2: 5 } },
  { id: 'M13', name: 'Модернизация тепло- и водосетей', direction: 'C', cost: 28, lag: 4, scope: 'district', effects: { C1: 18, E2: 2 } },
  { id: 'M14', name: 'Аварийные бригады ЖКХ + раннее оповещение', direction: 'C', cost: 16, lag: 1, scope: 'city', effects: { C1: 5, C2: 2 } },
];
export const measureById: ReadonlyMap<MeasureId, Measure> = new Map(MEASURES.map((measure) => [measure.id, measure]));
