from __future__ import annotations

import json
import os
from typing import Protocol

import httpx

from app.schemas import AnalysisResult, SimulationResult
from app.services.analysis import GroundedScenarioAnalyst

SYSTEM_PROMPT = """Ты аналитик городского симулятора VELTARQ.
Backend уже выполнил все вычисления. Не пересчитывай Score и не придумывай числа.
Используй только факты из JSON. Отвечай на русском языке.
Верни строго JSON с полями summary, strengths, risks, tradeoffs и recommendations.
Поля strengths, risks, tradeoffs и recommendations должны быть массивами строк.
В рекомендациях не утверждай, что альтернативный сценарий лучше, пока он не проверен backend.
"""


class ScenarioAnalyst(Protocol):
    def analyze(self, result: SimulationResult) -> AnalysisResult: ...


class OpenAICompatibleAnalyst:
    """Calls a configured OpenAI-compatible chat endpoint with grounded simulation data."""

    def __init__(
        self,
        base_url: str,
        model: str,
        api_key: str | None = None,
        timeout_seconds: float = 20.0,
        client: httpx.Client | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key = api_key
        self.client = client or httpx.Client(timeout=timeout_seconds)

    def analyze(self, result: SimulationResult) -> AnalysisResult:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        response = self.client.post(
            f"{self.base_url}/chat/completions",
            headers=headers,
            json={
                "model": self.model,
                "temperature": 0.1,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": (
                            "Объясни результат сценария. Вот единственный источник фактов:\n"
                            + result.model_dump_json()
                        ),
                    },
                ],
            },
        )
        response.raise_for_status()
        payload = response.json()
        content = payload["choices"][0]["message"]["content"]
        parsed = json.loads(content)
        parsed["provider"] = "llm"
        parsed.setdefault(
            "facts",
            {
                "score_before": result.score.score_before,
                "score_after": result.score.score_after,
                "score_delta": result.score.score_delta,
            },
        )
        return AnalysisResult.model_validate(parsed)


class FallbackAnalyst:
    def __init__(self, primary: ScenarioAnalyst, fallback: ScenarioAnalyst | None = None):
        self.primary = primary
        self.fallback = fallback or GroundedScenarioAnalyst()

    def analyze(self, result: SimulationResult) -> AnalysisResult:
        try:
            return self.primary.analyze(result)
        except (httpx.HTTPError, KeyError, TypeError, ValueError, json.JSONDecodeError):
            analysis = self.fallback.analyze(result)
            analysis.provider = "deterministic_fallback"
            return analysis


def create_analyst_from_environment() -> ScenarioAnalyst:
    base_url = os.getenv("VELTARQ_LLM_BASE_URL", "").strip()
    model = os.getenv("VELTARQ_LLM_MODEL", "").strip()
    if not base_url or not model:
        return GroundedScenarioAnalyst()
    return FallbackAnalyst(
        OpenAICompatibleAnalyst(
            base_url=base_url,
            model=model,
            api_key=os.getenv("VELTARQ_LLM_API_KEY"),
        )
    )
