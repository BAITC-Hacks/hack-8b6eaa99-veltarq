from __future__ import annotations

import pytest

from app.schemas import Decision
from app.services.analysis import GroundedScenarioAnalyst
from app.services.recommendation import RecommendationEngine
from app.services.simulation import SimulationEngine


def example_decisions() -> list[Decision]:
    return [
        Decision(measure_id="M7", district_id="nura"),
        Decision(measure_id="M8", district_id="nura"),
        Decision(measure_id="M10", district_id="nura"),
        Decision(measure_id="M12"),
        Decision(measure_id="M5", district_id="saryarka"),
    ]


def find_district(result, district_id: str):
    return next(item for item in result.districts if item.district_id == district_id)


def find_indicator(district, code: str):
    return next(item for item in district.indicators if item.code == code)


def test_document_control_values() -> None:
    result = SimulationEngine().simulate(example_decisions())

    assert result.score.city_average_before == pytest.approx(56.8624)
    assert result.score.score_before == pytest.approx(52.55768)
    assert result.score.score_after == pytest.approx(56.54307)
    assert result.score.score_delta == pytest.approx(3.98539)
    assert result.score.critical_count_before == 2
    assert result.score.critical_count_after == 0


def test_lags_city_effects_and_synergy_are_applied() -> None:
    result = SimulationEngine().simulate(example_decisions())
    nura = find_district(result, "nura")
    saryarka = find_district(result, "saryarka")
    esil = find_district(result, "esil")

    assert find_indicator(nura, "S1").after == 48.0
    assert find_indicator(nura, "S2").after == 43.75
    assert find_indicator(nura, "B1").after == 67.5
    assert find_indicator(saryarka, "E2").after == 48.75
    assert find_indicator(esil, "C2").after == 74.375
    assert result.activated_synergies == ["M10+M12"]


def test_decision_order_does_not_change_result() -> None:
    engine = SimulationEngine()
    forward = engine.simulate(example_decisions())
    reverse = engine.simulate(list(reversed(example_decisions())))

    assert forward.score == reverse.score
    assert forward.districts == reverse.districts


def test_analysis_uses_only_simulation_facts() -> None:
    result = SimulationEngine().simulate(example_decisions())
    analysis = GroundedScenarioAnalyst().analyze(result)

    assert "52.55768" in analysis.summary
    assert "56.54307" in analysis.summary
    assert analysis.facts["critical_count"] == 0
    assert analysis.facts["activated_synergies"] == ["M10+M12"]


def test_recommendations_are_valid_and_improve_score() -> None:
    result = RecommendationEngine().recommend(example_decisions(), limit=3)

    assert result.candidates
    assert len(result.candidates) <= 3
    assert all(candidate.improvement > 0 for candidate in result.candidates)
    assert all(candidate.score > result.current_score for candidate in result.candidates)
