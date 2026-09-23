from __future__ import annotations

import json
import math
import os
from typing import Protocol
from urllib.parse import urlsplit

import httpx

from app.schemas import AnalysisResult, ExplanationSelection, SimulationResult
from app.services.analysis import (
    FactCatalog,
    GroundedScenarioAnalyst,
    comparison_catalog,
    scenario_catalog,
)

SYSTEM_PROMPT = """Ты аналитик городского симулятора VELTARQ.
Backend уже рассчитал планы, показатели, вклады и сравнения. Не вычисляй числа.
Выбери и упорядочи проверенные факты для краткого понятного объяснения.
Верни только JSON с пятью массивами ID фактов: summary, strengths, risks, tradeoffs,
recommendations. Никакого произвольного текста, чисел, новых ключей или вложенных объектов.
Каждый ID должен существовать в facts и принадлежать соответствующему section.
Включи ВСЕ required_fact_ids в соответствующие массивы. Не повторяй ID.
Лимиты: summary 3, strengths 8, risks 4, tradeoffs 6, recommendations 3.
Дополнительно выбери до двух наиболее полезных изменений показателей или вкладов мер.
Отрази, что улучшилось, какие районы получили пользу, какие проблемы и компромиссы остались.
Для comparison объясняй только рассчитанные различия двух планов. Рекомендация — найденное
улучшение, а не лучший возможный план. Приложение само подставит проверенные русские фразы.
"""


class ScenarioAnalyst(Protocol):
    def analyze(self, result: SimulationResult) -> AnalysisResult: ...

    def compare(self, first: SimulationResult, second: SimulationResult) -> AnalysisResult: ...


class OpenAICompatibleAnalyst:
    """Server-only provider access; an untrusted response is only a fact selection."""

    def __init__(
        self, base_url: str, model: str, api_key: str | None = None,
        timeout_seconds: float = 20.0, client: httpx.Client | None = None,
        api_mode: str = "chat_completions",
    ):
        if api_mode not in {"chat_completions", "responses"}:
            raise ValueError("Unsupported provider API mode")
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key = api_key
        self.api_mode = api_mode
        self.timeout_seconds = timeout_seconds
        self.client = client or httpx.Client(timeout=timeout_seconds)

    def _request(self, catalog: FactCatalog) -> tuple[str, dict]:
        content = json.dumps(catalog.payload(), ensure_ascii=False)
        if self.api_mode == "responses":
            return "responses", {
                "model": self.model,
                "instructions": SYSTEM_PROMPT,
                "input": content,
                "store": False,
                "reasoning": {"effort": "low"},
                # The allowance includes reasoning as well as the short fact selection.
                "max_output_tokens": 4096,
                "text": {"format": {
                    "type": "json_schema", "name": "explanation_selection", "strict": True,
                    "schema": ExplanationSelection.model_json_schema(),
                }},
            }
        # Preserve existing compatible providers, including their JSON-object mode.
        generation = (
            {"reasoning_effort": "low", "max_completion_tokens": 4096}
            if self.model.startswith("gpt-6-")
            else {"temperature": 0.1, "max_tokens": 1200}
        )
        return "chat/completions", {
            "model": self.model, **generation,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": content},
            ],
        }

    def _response_content(self, payload: dict) -> str:
        if self.api_mode == "responses":
            if payload.get("status") != "completed" or payload.get("error"):
                raise ValueError("Incomplete provider response")
            output = payload["output"]
            if not isinstance(output, list) or payload.get("incomplete_details"):
                raise ValueError("Invalid provider output")
            messages = []
            for item in output:
                if item["type"] == "message":
                    messages.append(item)
                elif item["type"] != "reasoning":
                    raise ValueError("Unexpected provider output")
            if len(messages) != 1:
                raise ValueError("Missing or ambiguous provider message")
            message = messages[0]
            if message.get("role") != "assistant" or message.get("status") != "completed":
                raise ValueError("Invalid provider message")
            parts = message["content"]
            if not isinstance(parts, list) or not parts:
                raise ValueError("Missing provider content")
            if any(part["type"] != "output_text" for part in parts):
                # Refusals and unexpected content must never reach the renderer.
                raise ValueError("Provider did not return an explanation")
            return "".join(part["text"] for part in parts)
        choice = payload["choices"][0]
        if choice.get("finish_reason") not in (None, "stop"):
            raise ValueError("Incomplete provider response")
        message = choice["message"]
        if message.get("refusal"):
            raise ValueError("Provider refused the explanation")
        return message["content"]

    def _explain(self, catalog: FactCatalog) -> AnalysisResult:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        endpoint, body = self._request(catalog)
        response = self.client.post(
            f"{self.base_url}/{endpoint}", headers=headers, timeout=self.timeout_seconds, json=body,
        )
        response.raise_for_status()
        if len(response.content) > 131_072:
            raise ValueError("Oversized provider response")
        content = self._response_content(response.json())
        selection = ExplanationSelection.model_validate_json(content)
        return catalog.render(selection, provider="llm")

    def analyze(self, result: SimulationResult) -> AnalysisResult:
        return self._explain(scenario_catalog(result))

    def compare(self, first: SimulationResult, second: SimulationResult) -> AnalysisResult:
        return self._explain(comparison_catalog(first, second))


class FallbackAnalyst:
    def __init__(self, primary: ScenarioAnalyst, fallback: ScenarioAnalyst | None = None):
        self.primary = primary
        self.fallback = fallback or GroundedScenarioAnalyst()

    def _call(self, method: str, *results: SimulationResult) -> AnalysisResult:
        try:
            return getattr(self.primary, method)(*results)
        except httpx.TimeoutException:
            reason = "timeout"
        except httpx.HTTPError:
            reason = "provider_error"
        except (KeyError, IndexError, TypeError, ValueError, AttributeError):
            reason = "invalid_response"
        except Exception:
            # A provider integration must never break the independent simulation path.
            reason = "provider_error"
        # Never expose provider responses, exception messages, headers or credentials.
        analysis = getattr(self.fallback, method)(*results)
        analysis.provider = "deterministic_fallback"
        analysis.fallback_reason = reason
        return analysis

    def analyze(self, result: SimulationResult) -> AnalysisResult:
        return self._call("analyze", result)

    def compare(self, first: SimulationResult, second: SimulationResult) -> AnalysisResult:
        return self._call("compare", first, second)


def create_analyst_from_environment() -> ScenarioAnalyst:
    base_url = os.getenv("VELTARQ_LLM_BASE_URL", "").strip()
    model = os.getenv("VELTARQ_LLM_MODEL", "").strip()
    api_key = os.getenv("VELTARQ_LLM_API_KEY", "").strip()
    api_mode = os.getenv("VELTARQ_LLM_API_MODE", "chat_completions").strip()
    try:
        timeout = float(os.getenv("VELTARQ_LLM_TIMEOUT_SECONDS", "20"))
        urlsplit(base_url)  # Reject malformed bracketed hosts before building a client.
        url = httpx.URL(base_url)
        valid_url = (
            url.scheme in {"http", "https"} and bool(url.host)
            and not url.userinfo and not url.query and not url.fragment
        )
    except (ValueError, httpx.InvalidURL):
        timeout, valid_url = 0, False
    if (
        not valid_url or not model or not api_key or not math.isfinite(timeout)
        or not 1 <= timeout <= 30 or api_mode not in {"chat_completions", "responses"}
    ):
        return GroundedScenarioAnalyst(fallback_reason="not_configured")
    return FallbackAnalyst(
        OpenAICompatibleAnalyst(
            base_url=base_url, model=model, api_key=api_key, timeout_seconds=timeout,
            api_mode=api_mode,
        )
    )
