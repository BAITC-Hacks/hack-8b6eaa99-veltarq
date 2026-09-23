from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas import Decision
from app.services.preview import PartialScenarioValidator, PreviewEngine
from app.services.simulation import SimulationEngine
from app.services.validation import ScenarioValidator
from tests.test_simulation import example_decisions


def test_server_preview_uses_lags_and_does_not_publish_a_partial_score() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/scenarios/preview", json={"decisions": [], "district_id": "nura"},
        )
    assert response.status_code == 200
    result = response.json()
    assert result["budget_used"] == 0
    assert result["budget_remaining"] == 100
    assert len(result["current"]) == 5
    assert len(result["candidates"]) == 14
    assert "score" not in response.text
    school = next(item for item in result["candidates"] if item["measure_id"] == "M7")
    assert school["district_id"] == "nura"
    assert school["districts"] == [{
        "district_id": "nura", "district_name": "Нура",
        "indicators": [{"code": "S1", "before": 38, "after": 48, "delta": 10}],
    }]


def test_preview_includes_city_effects_and_new_synergy_relative_to_current_plan() -> None:
    result = PreviewEngine().preview([Decision(measure_id="M10", district_id="nura")], "nura")
    platform = next(item for item in result.candidates if item.measure_id == "M12")
    assert platform.district_id is None
    assert len(platform.districts) == 5
    nura = next(item for item in platform.districts if item.district_id == "nura")
    indicators = {item.code: item for item in nura.indicators}
    assert indicators["B1"].before == 65.5
    assert indicators["B1"].after == 67.5
    assert indicators["B1"].delta == 2
    assert indicators["C2"].delta == 4.375
    assert all(item.measure_id != "M10" for item in result.candidates)


def test_preview_keeps_constraints_and_does_not_offer_invalid_additions() -> None:
    result = PreviewEngine().preview([Decision(measure_id="M1", district_id="nura")], "esil")
    assert "M3" not in {item.measure_id for item in result.candidates}
    result = PreviewEngine().preview([Decision(measure_id="M4", district_id="nura")], "nura")
    assert "M7" not in {item.measure_id for item in result.candidates}
    result = PreviewEngine().preview([Decision(measure_id="M4", district_id="nura")], "esil")
    assert "M7" in {item.measure_id for item in result.candidates}


def test_complete_plan_preview_matches_engine_without_offering_a_sixth_measure() -> None:
    result = PreviewEngine().preview(example_decisions(), "nura")
    calculated = SimulationEngine().simulate(example_decisions())
    assert result.candidates == []
    assert result.budget_used == calculated.budget_used
    for preview, actual in zip(result.current, calculated.districts, strict=True):
        assert preview.district_id == actual.district_id
        assert preview.indicators == actual.indicators
    assert calculated.score.score_before == 52.55768
    assert calculated.score.score_after == 56.54307


@pytest.mark.parametrize("decisions", [
    [Decision(measure_id="M12"), Decision(measure_id="M12")],
    [Decision(measure_id="M7")],
    [Decision(measure_id="M15", district_id="nura")],
    [Decision(measure_id="M1", district_id="nura"), Decision(measure_id="M3", district_id="esil")],
    [*example_decisions(), Decision(measure_id="M14")],
])
def test_partial_validator_removes_only_the_incomplete_count_issue(decisions) -> None:
    regular = ScenarioValidator().validate(decisions)
    partial = PartialScenarioValidator().validate(decisions)
    expected = [
        issue for issue in regular.issues
        if not (issue.code == "decision_count" and len(decisions) <= 5)
    ]
    assert partial.issues == expected
    assert partial.valid is False
    with TestClient(app) as client:
        response = client.post("/api/v1/scenarios/preview", json={
            "decisions": [item.model_dump() for item in decisions], "district_id": "nura",
        })
    assert response.status_code == 422
    assert response.json()["detail"] == [item.model_dump() for item in expected]


def test_preview_normalizes_input_and_rejects_unknown_target() -> None:
    result = PreviewEngine().preview([Decision(measure_id="m7", district_id="NURA")], " ESIL ")
    assert result.district_id == "esil"
    assert result.decisions == [Decision(measure_id="M7", district_id="nura")]
    with TestClient(app) as client:
        response = client.post("/api/v1/scenarios/preview", json={
            "decisions": [], "district_id": "missing",
        })
    assert response.status_code == 422
    assert response.json()["detail"][0]["code"] == "unknown_district"
