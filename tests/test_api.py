from __future__ import annotations

from fastapi.testclient import TestClient

from app.api import routes
from app.main import app
from app.services.repository import ScenarioRepository

client = TestClient(app)

EXAMPLE = {
    "decisions": [
        {"measure_id": "M7", "district_id": "nura"},
        {"measure_id": "M8", "district_id": "nura"},
        {"measure_id": "M10", "district_id": "nura"},
        {"measure_id": "M12"},
        {"measure_id": "M5", "district_id": "saryarka"},
    ]
}


def test_health_and_catalog() -> None:
    health = client.get("/health")
    catalog = client.get("/api/v1/catalog")

    assert health.status_code == 200
    assert health.json()["status"] == "ok"
    assert catalog.status_code == 200
    assert len(catalog.json()["districts"]) == 5
    assert len(catalog.json()["measures"]) == 14


def test_simulate_and_analyze() -> None:
    simulation = client.post("/api/v1/scenarios/simulate", json=EXAMPLE)
    analysis = client.post("/api/v1/scenarios/analyze", json=EXAMPLE)

    assert simulation.status_code == 200
    assert simulation.json()["score"]["score_after"] == 56.54307
    assert analysis.status_code == 200
    assert analysis.json()["analysis"]["facts"]["critical_count"] == 0


def test_invalid_scenario_returns_structured_422() -> None:
    response = client.post(
        "/api/v1/scenarios/simulate",
        json={"decisions": [{"measure_id": "M12"}]},
    )

    assert response.status_code == 422
    assert response.json()["detail"][0]["code"] == "decision_count"


def test_compare_and_recommend_endpoints() -> None:
    comparison = client.post(
        "/api/v1/scenarios/compare",
        json={"first": EXAMPLE, "second": EXAMPLE},
    )
    recommendations = client.post(
        "/api/v1/scenarios/recommend?limit=2",
        json=EXAMPLE,
    )

    assert comparison.status_code == 200
    assert comparison.json()["better_scenario"] == "equal"
    assert recommendations.status_code == 200
    assert len(recommendations.json()["candidates"]) <= 2


def test_save_read_and_leaderboard_endpoints(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(routes, "repository", ScenarioRepository(tmp_path / "api.db"))
    saved = client.post(
        "/api/v1/scenarios/save",
        json={"team_name": "VELTARQ", "scenario": EXAMPLE},
    )

    assert saved.status_code == 200
    scenario_id = saved.json()["id"]
    loaded = client.get(f"/api/v1/scenarios/{scenario_id}")
    leaderboard = client.get("/api/v1/leaderboard")

    assert loaded.status_code == 200
    assert loaded.json()["team_name"] == "VELTARQ"
    assert leaderboard.status_code == 200
    assert leaderboard.json()[0]["scenario_id"] == scenario_id


def test_blank_team_name_is_rejected() -> None:
    response = client.post(
        "/api/v1/scenarios/save",
        json={"team_name": "   ", "scenario": EXAMPLE},
    )

    assert response.status_code == 422
