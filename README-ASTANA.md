# Astana Atlas

## Последний вариант дизайна

Интерактивный макет сохранён в `.frontend-workbench/sessions/astana-playfield-redesign/product-design/preview/` этого проекта. После `npm ci` запустите:

```bash
npm run dev -- --port 5180 --open /.frontend-workbench/sessions/astana-playfield-redesign/product-design/preview/
```

Разбор дизайна находится в `DESIGN-NOTES.md` рядом с папкой `preview`. Макет сохранён для оценки; перенос в основное React-приложение и публикация нового дизайна ещё не выполнены.

Интерактивная игровая карта Астаны на React, TypeScript, MapLibre GL JS и OpenFreeMap. Пять полигонов, условные проекты и решения хранятся в репозитории. Размещение **демонстрационное** и не совпадает с официальными административными границами или утверждёнными планами строительства.

## Запуск

```bash
npm install
npm run dev
```

Для проверки данных и сборки: `npm run build`.

## Единая версия данных

- `src/data/districts.geojson` — пять игровых зон. `feature.id` и `properties.districtId` совпадают с `districtId` в `metrics.json`.
- `src/data/metrics.json` — показатели каждого района для режимов «До» и «После».
- `src/data/projects.geojson` — по одной условной школе и одному парку в каждом районе.
- `src/data/decisions.geojson` — контуры новых зданий и зелёных участков, линии транспорта и сервисные значки. Файл можно обновить через `node scripts/generate-decisions.mjs` после изменения точек проектов.

Сборка запускает `scripts/validate-data.mjs` и проверяет ID, число точек и их попадание в игровые зоны. Все команды получают одну и ту же версию данных из развёрнутой сборки. Картографическая подложка OpenFreeMap остаётся внешним фоном: игровые решения рисуются отдельными слоями MapLibre.
