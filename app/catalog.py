from __future__ import annotations

from app.domain import (
    Conflict,
    ConflictScope,
    Direction,
    District,
    Indicator,
    Measure,
    MeasureScope,
    Synergy,
    readonly,
)

BUDGET = 100
DECISION_COUNT = 5
HORIZON_QUARTERS = 8
CRITICAL_THRESHOLD = 40.0

INDICATORS = (
    Indicator("T1", Direction.TRANSPORT, "Разгрузка дорог", 0.10, "Нет пробок в час пик"),
    Indicator(
        "T2",
        Direction.TRANSPORT,
        "Доступность общественного транспорта",
        0.10,
        "Все жители в 500 м от остановки с интервалом не более 10 минут",
    ),
    Indicator("E1", Direction.ECOLOGY, "Озеленение", 0.09, "Не менее 20 м² зелени на жителя"),
    Indicator("E2", Direction.ECOLOGY, "Качество воздуха", 0.11, "Зимой AQI не выше 50"),
    Indicator(
        "S1",
        Direction.SOCIAL,
        "Школы и детсады",
        0.11,
        "Нормативная потребность выполнена без второй смены",
    ),
    Indicator(
        "S2",
        Direction.SOCIAL,
        "Поликлиники и первичная медицинская помощь",
        0.11,
        "Норматив на жителя выполнен полностью",
    ),
    Indicator(
        "B1",
        Direction.SAFETY,
        "Безопасность улиц",
        0.09,
        "Освещение и камеры установлены везде, число происшествий минимально",
    ),
    Indicator(
        "B2",
        Direction.SAFETY,
        "Безопасность дорожного движения",
        0.09,
        "Минимум ДТП с пострадавшими",
    ),
    Indicator(
        "C1",
        Direction.SERVICES,
        "Надёжность ЖКХ",
        0.10,
        "За год не было аварий отопления и водоснабжения",
    ),
    Indicator(
        "C2",
        Direction.SERVICES,
        "Скорость решения обращений жителей",
        0.10,
        "Все обращения закрыты в срок",
    ),
)

INDICATORS_BY_CODE = {indicator.code: indicator for indicator in INDICATORS}

DISTRICTS = (
    District(
        "esil",
        "Есиль",
        0.27,
        readonly(
            {"T1": 45, "T2": 62, "E1": 68, "E2": 72, "S1": 48, "S2": 55,
             "B1": 78, "B2": 60, "C1": 75, "C2": 70}
        ),
        "Благополучный район с пробками на мостах и перегруженными школами.",
    ),
    District(
        "almaty",
        "Алматы",
        0.24,
        readonly(
            {"T1": 40, "T2": 75, "E1": 50, "E2": 55, "S1": 60, "S2": 65,
             "B1": 62, "B2": 52, "C1": 50, "C2": 60}
        ),
        "Район со старой коммунальной инфраструктурой и пробками.",
    ),
    District(
        "saryarka",
        "Сарыарка",
        0.20,
        readonly(
            {"T1": 50, "T2": 70, "E1": 42, "E2": 40, "S1": 62, "S2": 68,
             "B1": 58, "B2": 55, "C1": 45, "C2": 55}
        ),
        "Район со смогом от частного сектора и недостаточным озеленением.",
    ),
    District(
        "baikonur",
        "Байконур",
        0.13,
        readonly(
            {"T1": 52, "T2": 68, "E1": 55, "E2": 50, "S1": 58, "S2": 60,
             "B1": 52, "B2": 58, "C1": 55, "C2": 58}
        ),
        "Сбалансированный район без выраженных перекосов.",
    ),
    District(
        "nura",
        "Нура",
        0.16,
        readonly(
            {"T1": 55, "T2": 40, "E1": 45, "E2": 65, "S1": 38, "S2": 35,
             "B1": 55, "B2": 50, "C1": 60, "C2": 50}
        ),
        "Наиболее слабый район по социальной сфере и общественному транспорту.",
    ),
)

DISTRICTS_BY_ID = {district.id: district for district in DISTRICTS}

MEASURES = (
    Measure("M1", Direction.TRANSPORT, "Выделенные полосы для автобусов", MeasureScope.DISTRICT,
            18, 2, readonly({"T1": 6, "T2": 9})),
    Measure("M2", Direction.TRANSPORT, "Умные светофоры", MeasureScope.CITY,
            22, 2, readonly({"T1": 4, "B2": 3})),
    Measure("M3", Direction.TRANSPORT, "Линия ЛРТ или расширение", MeasureScope.DISTRICT,
            30, 4, readonly({"T1": 16, "T2": 20, "E2": 4})),
    Measure("M4", Direction.ECOLOGY, "Парк или сквер", MeasureScope.DISTRICT,
            15, 2, readonly({"E1": 12, "E2": 3, "B1": 2})),
    Measure("M5", Direction.ECOLOGY, "Перевод частного сектора на чистое топливо",
            MeasureScope.DISTRICT, 25, 3, readonly({"E2": 14, "C1": 4})),
    Measure("M6", Direction.ECOLOGY, "Городская программа озеленения и ветрозащитных полос",
            MeasureScope.CITY, 20, 4, readonly({"E1": 5, "E2": 3})),
    Measure("M7", Direction.SOCIAL, "Школа и детсад", MeasureScope.DISTRICT,
            24, 3, readonly({"S1": 16})),
    Measure("M8", Direction.SOCIAL, "Центр семейного здоровья или поликлиника",
            MeasureScope.DISTRICT, 20, 3, readonly({"S2": 14})),
    Measure("M9", Direction.SOCIAL, "Дворовые спортивные хабы", MeasureScope.DISTRICT,
            10, 1, readonly({"S1": 3, "S2": 3, "B1": 3})),
    Measure("M10", Direction.SAFETY, "Освещение и камеры Safe City", MeasureScope.DISTRICT,
            12, 1, readonly({"B1": 12, "B2": 2})),
    Measure("M11", Direction.SAFETY, "Безопасные переходы и школьные зоны",
            MeasureScope.DISTRICT, 10, 1, readonly({"B2": 12, "T1": -2})),
    Measure("M12", Direction.SERVICES, "Единая цифровая платформа обращений",
            MeasureScope.CITY, 14, 1, readonly({"C2": 5})),
    Measure("M13", Direction.SERVICES, "Модернизация тепло- и водосетей",
            MeasureScope.DISTRICT, 28, 4, readonly({"C1": 18, "E2": 2})),
    Measure("M14", Direction.SERVICES, "Аварийные бригады ЖКХ и раннее оповещение",
            MeasureScope.CITY, 16, 1, readonly({"C1": 5, "C2": 2})),
)

MEASURES_BY_ID = {measure.id: measure for measure in MEASURES}

SYNERGIES = (
    Synergy("M1", "M2", "T1", 2),
    Synergy("M10", "M12", "B1", 2),
    Synergy("M5", "M6", "E2", 2),
)

CONFLICTS = (
    Conflict("M1", "M3", ConflictScope.GLOBAL),
    Conflict("M4", "M7", ConflictScope.SAME_DISTRICT),
    Conflict("M5", "M13", ConflictScope.SAME_DISTRICT),
)
