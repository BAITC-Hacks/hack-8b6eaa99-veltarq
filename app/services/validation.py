from __future__ import annotations

from collections import Counter

from app.catalog import (
    BUDGET,
    CONFLICTS,
    DECISION_COUNT,
    DISTRICTS_BY_ID,
    MEASURES_BY_ID,
)
from app.domain import ConflictScope, MeasureScope
from app.schemas import Decision, ValidationIssue, ValidationResult


def normalize_decision(decision: Decision) -> Decision:
    return Decision(
        measure_id=decision.measure_id.upper(),
        district_id=decision.district_id.lower() if decision.district_id else None,
    )


class ScenarioValidator:
    def validate(self, decisions: list[Decision]) -> ValidationResult:
        normalized = [normalize_decision(decision) for decision in decisions]
        issues: list[ValidationIssue] = []

        if len(normalized) != DECISION_COUNT:
            issues.append(
                ValidationIssue(
                    code="decision_count",
                    message=f"Необходимо выбрать ровно {DECISION_COUNT} мероприятий.",
                )
            )

        ids = [decision.measure_id for decision in normalized]
        duplicate_ids = sorted(
            measure_id for measure_id, count in Counter(ids).items() if count > 1
        )
        if duplicate_ids:
            issues.append(
                ValidationIssue(
                    code="duplicate_measure",
                    message="Мероприятия нельзя выбирать повторно: " + ", ".join(duplicate_ids),
                )
            )

        known_decisions: list[tuple[int, Decision]] = []
        for index, decision in enumerate(normalized):
            measure = MEASURES_BY_ID.get(decision.measure_id)
            if measure is None:
                issues.append(
                    ValidationIssue(
                        code="unknown_measure",
                        message=f"Мероприятие {decision.measure_id} не найдено.",
                        decision_index=index,
                    )
                )
                continue

            known_decisions.append((index, decision))
            if measure.scope is MeasureScope.DISTRICT:
                if decision.district_id is None:
                    issues.append(
                        ValidationIssue(
                            code="district_required",
                            message=f"Для мероприятия {measure.id} необходимо выбрать район.",
                            decision_index=index,
                        )
                    )
                elif decision.district_id not in DISTRICTS_BY_ID:
                    issues.append(
                        ValidationIssue(
                            code="unknown_district",
                            message=f"Район {decision.district_id} не найден.",
                            decision_index=index,
                        )
                    )
            elif decision.district_id is not None:
                issues.append(
                    ValidationIssue(
                        code="district_not_allowed",
                        message=f"Для городского мероприятия {measure.id} район не указывается.",
                        decision_index=index,
                    )
                )

        budget_used = sum(
            MEASURES_BY_ID[decision.measure_id].cost
            for _, decision in known_decisions
        )
        if budget_used > BUDGET:
            issues.append(
                ValidationIssue(
                    code="budget_exceeded",
                    message=f"Бюджет превышен на {budget_used - BUDGET} единиц.",
                )
            )

        direction_counts = Counter(
            MEASURES_BY_ID[decision.measure_id].direction
            for _, decision in known_decisions
        )
        for direction, count in sorted(direction_counts.items(), key=lambda item: item[0].value):
            if count > 2:
                issues.append(
                    ValidationIssue(
                        code="direction_limit",
                        message=(
                            f"В направлении {direction.value} выбрано {count} мероприятий; "
                            "разрешено не более двух."
                        ),
                    )
                )

        decisions_by_id = {decision.measure_id: decision for _, decision in known_decisions}
        selected_ids = set(decisions_by_id)
        for conflict in CONFLICTS:
            if {conflict.first_measure_id, conflict.second_measure_id} - selected_ids:
                continue
            if conflict.scope is ConflictScope.GLOBAL:
                issues.append(
                    ValidationIssue(
                        code="global_conflict",
                        message=(
                            f"Мероприятия {conflict.first_measure_id} и "
                            f"{conflict.second_measure_id} несовместимы."
                        ),
                    )
                )
                continue

            first = decisions_by_id[conflict.first_measure_id]
            second = decisions_by_id[conflict.second_measure_id]
            if first.district_id is not None and first.district_id == second.district_id:
                issues.append(
                    ValidationIssue(
                        code="district_conflict",
                        message=(
                            f"Мероприятия {conflict.first_measure_id} и "
                            f"{conflict.second_measure_id} нельзя проводить в одном районе."
                        ),
                    )
                )

        return ValidationResult(
            valid=not issues,
            budget_used=budget_used,
            budget_remaining=BUDGET - budget_used,
            issues=issues,
        )
