from __future__ import annotations

from app.schemas import Decision
from app.services.validation import ScenarioValidator


def codes(result) -> set[str]:
    return {issue.code for issue in result.issues}


def test_document_example_is_valid() -> None:
    result = ScenarioValidator().validate(
        [
            Decision(measure_id="M7", district_id="nura"),
            Decision(measure_id="M8", district_id="nura"),
            Decision(measure_id="M10", district_id="nura"),
            Decision(measure_id="M12"),
            Decision(measure_id="M5", district_id="saryarka"),
        ]
    )

    assert result.valid
    assert result.budget_used == 95
    assert result.budget_remaining == 5


def test_rejects_wrong_decision_count_and_duplicates() -> None:
    result = ScenarioValidator().validate(
        [
            Decision(measure_id="M12"),
            Decision(measure_id="M12"),
        ]
    )

    assert {"decision_count", "duplicate_measure"} <= codes(result)


def test_rejects_invalid_scope_usage() -> None:
    result = ScenarioValidator().validate(
        [
            Decision(measure_id="M7"),
            Decision(measure_id="M12", district_id="nura"),
            Decision(measure_id="M10", district_id="missing"),
            Decision(measure_id="M9", district_id="nura"),
            Decision(measure_id="M4", district_id="esil"),
        ]
    )

    assert {
        "district_required",
        "district_not_allowed",
        "unknown_district",
    } <= codes(result)


def test_rejects_budget_overrun() -> None:
    result = ScenarioValidator().validate(
        [
            Decision(measure_id="M2"),
            Decision(measure_id="M3", district_id="esil"),
            Decision(measure_id="M5", district_id="saryarka"),
            Decision(measure_id="M7", district_id="nura"),
            Decision(measure_id="M13", district_id="almaty"),
        ]
    )

    assert "budget_exceeded" in codes(result)
    assert result.budget_used == 129


def test_rejects_global_and_same_district_conflicts() -> None:
    global_result = ScenarioValidator().validate(
        [
            Decision(measure_id="M1", district_id="esil"),
            Decision(measure_id="M3", district_id="nura"),
            Decision(measure_id="M9", district_id="nura"),
            Decision(measure_id="M10", district_id="nura"),
            Decision(measure_id="M12"),
        ]
    )
    district_result = ScenarioValidator().validate(
        [
            Decision(measure_id="M4", district_id="nura"),
            Decision(measure_id="M7", district_id="nura"),
            Decision(measure_id="M10", district_id="nura"),
            Decision(measure_id="M12"),
            Decision(measure_id="M14"),
        ]
    )

    assert "global_conflict" in codes(global_result)
    assert "district_conflict" in codes(district_result)


def test_rejects_more_than_two_measures_from_one_direction() -> None:
    result = ScenarioValidator().validate(
        [
            Decision(measure_id="M1", district_id="esil"),
            Decision(measure_id="M2"),
            Decision(measure_id="M3", district_id="nura"),
            Decision(measure_id="M10", district_id="nura"),
            Decision(measure_id="M12"),
        ]
    )

    assert "direction_limit" in codes(result)
