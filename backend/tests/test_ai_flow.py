from __future__ import annotations

import json
from collections.abc import Callable

import httpx
import pytest
from fastapi.testclient import TestClient

from app.api import routes
from app.main import app
from app.services.llm import FallbackAnalyst, OpenAICompatibleAnalyst
from tests.test_simulation import example_decisions


def example_plan() -> dict:
    return {"decisions": [item.model_dump() for item in example_decisions()]}


def install_provider(monkeypatch, handler: Callable[[httpx.Request], httpx.Response]) -> None:
    """Exercise the actual provider adapter without contacting an external service."""
    provider = OpenAICompatibleAnalyst(
        "https://llm.example/v1",
        "test-model",
        api_key="test-only-server-key",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    monkeypatch.setattr(routes, "analyst", FallbackAnalyst(provider))


def completion(content: dict | str) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "choices": [
                {
                    "message": {
                        "content": json.dumps(content, ensure_ascii=False)
                        if isinstance(content, dict)
                        else content,
                    }
                }
            ]
        },
    )


def assert_control_result(simulation: dict) -> None:
    assert simulation["score"]["score_before"] == 52.55768
    assert simulation["score"]["score_after"] == 56.54307
    assert simulation["score"]["score_delta"] == 3.98539
    assert simulation["budget_used"] == 95
    assert simulation["activated_synergies"] == ["M10+M12"]


def test_five_measure_ai_recommend_compare_apply_flow(monkeypatch) -> None:
    provider_inputs: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/chat/completions"
        body = json.loads(request.content)
        payload = json.loads(body["messages"][1]["content"])
        provider_inputs.append(payload)
        # The model selects references; every displayed word and value is server-owned.
        return completion(payload["required_fact_ids"])

    install_provider(monkeypatch, handler)
    with TestClient(app) as client:
        plan = example_plan()
        assert len(plan["decisions"]) == 5
        validation = client.post("/api/v1/scenarios/validate", json=plan)
        assert validation.status_code == 200
        assert validation.json()["valid"] is True

        response = client.post("/api/v1/scenarios/simulate", json=plan)
        assert response.status_code == 200
        calculated = response.json()
        assert_control_result(calculated)
        assert not provider_inputs

        response = client.post("/api/v1/scenarios/analyze", json=plan)
        assert response.status_code == 200
        analyzed = response.json()
        assert analyzed["simulation"] == calculated
        assert analyzed["analysis"]["provider"] == "llm"
        assert analyzed["analysis"]["fallback_reason"] is None
        assert provider_inputs[0]["mode"] == "scenario"
        assert provider_inputs[0]["simulations"] == {"current": calculated}
        for section, fact_ids in analyzed["analysis"]["fact_refs"].items():
            assert fact_ids == provider_inputs[0]["required_fact_ids"][section]
            rendered = analyzed["analysis"][section]
            for fact_id in fact_ids:
                assert provider_inputs[0]["facts"][fact_id]["text"] in rendered

        response = client.post("/api/v1/scenarios/recommend?limit=3", json=plan)
        assert response.status_code == 200
        recommendations = response.json()
        assert recommendations["current_score"] == calculated["score"]["score_after"]
        assert recommendations["candidates"]
        assert len(provider_inputs) == 1

        # Independently calculate every returned recommendation through the public API.
        for candidate in recommendations["candidates"]:
            candidate_plan = {"decisions": candidate["decisions"]}
            checked = client.post("/api/v1/scenarios/validate", json=candidate_plan)
            assert checked.status_code == 200
            assert checked.json()["valid"] is True
            simulated = client.post("/api/v1/scenarios/simulate", json=candidate_plan)
            assert simulated.status_code == 200
            actual = simulated.json()
            assert actual["score"]["score_after"] == candidate["score"]
            assert actual["budget_used"] == candidate["budget_used"]
            assert actual["budget_remaining"] == candidate["budget_remaining"]
            assert candidate["improvement"] == pytest.approx(
                actual["score"]["score_after"] - calculated["score"]["score_after"],
                abs=0.000001,
            )
            assert candidate["improvement"] > 0

        candidate = recommendations["candidates"][0]
        alternative = {"decisions": candidate["decisions"]}
        response = client.post(
            "/api/v1/scenarios/compare",
            json={"first": plan, "second": alternative},
        )
        assert response.status_code == 200
        compared = response.json()
        assert compared["first"] == calculated
        assert compared["second"]["score"]["score_after"] == candidate["score"]
        assert compared["better_scenario"] == "second"
        assert compared["score_difference"] == candidate["improvement"]
        assert compared["analysis"]["provider"] == "llm"
        assert compared["explanation"] == compared["analysis"]["summary"]
        assert len(provider_inputs) == 2
        assert provider_inputs[1]["mode"] == "comparison"
        assert provider_inputs[1]["simulations"] == {
            "current": compared["first"],
            "alternative": compared["second"],
        }

        # Applying uses the same editable decisions and repeats validation/calculation.
        validation = client.post("/api/v1/scenarios/validate", json=alternative)
        applied = client.post("/api/v1/scenarios/simulate", json=alternative)
        assert validation.status_code == applied.status_code == 200
        assert validation.json()["valid"] is True
        assert applied.json() == compared["second"]
        assert len(provider_inputs) == 2


@pytest.mark.parametrize(
    ("failure", "reason"),
    [
        ("timeout", "timeout"),
        ("unavailable", "provider_error"),
        ("refusal", "invalid_response"),
        ("malformed_json", "invalid_response"),
        ("invented_fact", "invalid_response"),
    ],
)
def test_provider_failure_preserves_simulation_recommendation_and_comparison(
    monkeypatch, failure: str, reason: str,
) -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if failure == "timeout":
            raise httpx.ReadTimeout("Provider timed out", request=request)
        if failure == "unavailable":
            return httpx.Response(503)
        if failure == "refusal":
            return httpx.Response(
                200, json={"choices": [{"message": {"refusal": "Cannot answer", "content": None}}]},
            )
        if failure == "malformed_json":
            return completion("{invalid JSON")
        payload = json.loads(json.loads(request.content)["messages"][1]["content"])
        references = payload["required_fact_ids"]
        references["summary"].append("fabricated_score_999")
        return completion(references)

    install_provider(monkeypatch, handler)
    with TestClient(app) as client:
        plan = example_plan()
        response = client.post("/api/v1/scenarios/analyze", json=plan)
        assert response.status_code == 200
        analyzed = response.json()
        assert_control_result(analyzed["simulation"])
        assert analyzed["analysis"]["provider"] == "deterministic_fallback"
        assert analyzed["analysis"]["fallback_reason"] == reason
        assert analyzed["analysis"]["summary"]
        assert "fabricated_score_999" not in json.dumps(analyzed)

        simulation = client.post("/api/v1/scenarios/simulate", json=plan)
        assert simulation.status_code == 200
        assert simulation.json() == analyzed["simulation"]
        recommendations = client.post("/api/v1/scenarios/recommend?limit=1", json=plan)
        assert recommendations.status_code == 200
        candidate = recommendations.json()["candidates"][0]
        assert candidate["score"] > simulation.json()["score"]["score_after"]
        assert calls == 1

        comparison = client.post(
            "/api/v1/scenarios/compare",
            json={"first": plan, "second": {"decisions": candidate["decisions"]}},
        )
        assert comparison.status_code == 200
        compared = comparison.json()
        assert compared["analysis"]["provider"] == "deterministic_fallback"
        assert compared["analysis"]["fallback_reason"] == reason
        assert compared["first"] == simulation.json()
        assert compared["second"]["score"]["score_after"] == candidate["score"]
        assert compared["better_scenario"] == "second"
        assert calls == 2


def test_invalid_plan_never_reaches_llm(monkeypatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        pytest.fail("An invalid plan must not reach the LLM provider")

    install_provider(monkeypatch, handler)
    with TestClient(app) as client:
        incomplete = {"decisions": example_plan()["decisions"][:4]}
        response = client.post("/api/v1/scenarios/analyze", json=incomplete)
        assert response.status_code == 422
        assert response.json()["detail"][0]["code"] == "decision_count"
