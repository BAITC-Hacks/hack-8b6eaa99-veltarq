from __future__ import annotations

import json

import httpx

from app.services.llm import FallbackAnalyst, OpenAICompatibleAnalyst
from app.services.simulation import SimulationEngine
from tests.test_simulation import example_decisions


def test_llm_receives_grounded_result_and_returns_structured_analysis() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert "56.54307" in body["messages"][1]["content"]
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "summary": "Проверенный результат.",
                                    "strengths": ["Есть улучшение."],
                                    "risks": [],
                                    "tradeoffs": ["Бюджет ограничен."],
                                    "recommendations": ["Проверить альтернативу через backend."],
                                },
                                ensure_ascii=False,
                            )
                        }
                    }
                ]
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    service = OpenAICompatibleAnalyst("https://llm.example/v1", "test-model", client=client)
    result = service.analyze(SimulationEngine().simulate(example_decisions()))

    assert result.provider == "llm"
    assert result.facts["score_after"] == 56.54307


def test_llm_failure_uses_deterministic_fallback() -> None:
    client = httpx.Client(
        transport=httpx.MockTransport(lambda request: httpx.Response(503))
    )
    primary = OpenAICompatibleAnalyst("https://llm.example/v1", "test-model", client=client)
    result = FallbackAnalyst(primary).analyze(
        SimulationEngine().simulate(example_decisions())
    )

    assert result.provider == "deterministic_fallback"
    assert result.facts["critical_count"] == 0
