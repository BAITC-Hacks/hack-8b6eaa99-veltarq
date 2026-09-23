from __future__ import annotations

import json

import httpx
import pytest

from app.schemas import Decision
from app.services.analysis import GroundedScenarioAnalyst
from app.services.llm import (
    SYSTEM_PROMPT,
    FallbackAnalyst,
    OpenAICompatibleAnalyst,
    create_analyst_from_environment,
)
from app.services.simulation import SimulationEngine
from tests.test_simulation import example_decisions

SECRET = "test-secret-never-display"


@pytest.fixture
def simulation():
    return SimulationEngine().simulate(example_decisions())


def provider(handler, *, api_mode="chat_completions", model="test-model"):
    return OpenAICompatibleAnalyst(
        "https://llm.example/v1", model, api_key=SECRET, api_mode=api_mode,
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )


def completion(content, **choice):
    return httpx.Response(200, json={"choices": [{"message": {"content": content}, **choice}]})


def response_envelope(content, **overrides):
    return {
        "status": "completed",
        "output": [
            {"type": "reasoning", "summary": []},
            {"type": "message", "role": "assistant", "status": "completed", "content": [
                {"type": "output_text", "text": content},
            ]},
        ],
        **overrides,
    }


def test_llm_receives_all_engine_facts_and_renders_only_verified_references(simulation):
    def handler(request):
        body = json.loads(request.content)
        payload = json.loads(body["messages"][1]["content"])
        assert request.headers["Authorization"] == f"Bearer {SECRET}"
        assert SECRET not in body["messages"][1]["content"]
        assert payload["simulations"]["current"] == simulation.model_dump()
        assert payload["mode"] == "scenario"
        assert body["response_format"] == {"type": "json_object"}
        assert request.extensions["timeout"]["read"] == 20
        contributions = [
            item for fact in payload["facts"].values() if fact["kind"] == "contribution"
            for item in fact["values"]
        ]
        assert contributions == [item.model_dump() for item in simulation.contributions]
        refs = payload["required_fact_ids"]
        refs["strengths"].append("current.contribution.measure.M7")
        refs["strengths"].reverse()  # The LLM may prioritize verified detail.
        return completion(json.dumps(refs))

    result = provider(handler).analyze(simulation)
    assert result.provider == "llm"
    assert result.fallback_reason is None
    assert result.facts["score_before"] == 52.55768
    assert result.facts["score_after"] == 56.54307
    assert "52.55768" in result.summary and "56.54307" in result.summary
    assert "Школа и детсад" in result.strengths[0]
    assert SECRET not in result.model_dump_json()


@pytest.mark.parametrize("api_mode", ["chat_completions", "responses"])
@pytest.mark.parametrize("status", [401, 429, 503])
def test_provider_errors_fall_back_without_exposing_secret_or_body(
    simulation, caplog, status, api_mode,
):
    service = FallbackAnalyst(provider(
        lambda request: httpx.Response(status, text=SECRET), api_mode=api_mode,
    ))
    result = service.analyze(simulation)
    assert result.provider == "deterministic_fallback"
    assert result.fallback_reason == "provider_error"
    assert result.facts["critical_count"] == 0
    assert SECRET not in result.model_dump_json()
    assert SECRET not in caplog.text


@pytest.mark.parametrize("api_mode", ["chat_completions", "responses"])
def test_timeout_uses_safe_fallback(simulation, api_mode):
    def handler(request):
        raise httpx.ReadTimeout(SECRET, request=request)

    result = FallbackAnalyst(provider(handler, api_mode=api_mode)).analyze(simulation)
    assert result.fallback_reason == "timeout"
    assert SECRET not in result.model_dump_json()


@pytest.mark.parametrize("api_mode", ["chat_completions", "responses"])
@pytest.mark.parametrize("attack", [
    "invented_text", "invented_number", "extra_field", "wrong_section", "omitted_fact",
    "duplicate_fact", "object_instead_of_id", "too_many_facts", "missing_section",
])
def test_malformed_or_hallucinated_selection_is_rejected(simulation, attack, api_mode):
    def handler(request):
        body = json.loads(request.content)
        payload = json.loads(
            body["input"] if api_mode == "responses" else body["messages"][1]["content"],
        )
        refs = payload["required_fact_ids"]
        if attack == "invented_text":
            refs["strengths"].append("Score увеличится до 99")
        elif attack == "invented_number":
            refs["summary"] = [999]
        elif attack == "extra_field":
            refs["facts"] = {"score_after": 999}
        elif attack == "wrong_section":
            refs["strengths"].append("current.budget")
        elif attack == "omitted_fact":
            refs["tradeoffs"] = ["current.budget"]
        elif attack == "duplicate_fact":
            refs["summary"].append(refs["summary"][0])
        elif attack == "object_instead_of_id":
            refs["summary"] = [{"id": "current.score", "text": SECRET}]
        elif attack == "too_many_facts":
            refs["strengths"] *= 10
        elif attack == "missing_section":
            del refs["risks"]
        content = json.dumps(refs)
        if api_mode == "responses":
            return httpx.Response(200, json=response_envelope(content))
        return completion(content)

    result = FallbackAnalyst(provider(handler, api_mode=api_mode)).analyze(simulation)
    assert result.fallback_reason == "invalid_response"
    assert result.facts["score_after"] == 56.54307
    assert "999" not in result.summary
    assert SECRET not in result.model_dump_json()


@pytest.mark.parametrize("response", [
    httpx.Response(200, content=b"not JSON"),
    httpx.Response(200, json={"choices": []}),
    httpx.Response(200, json={}),
    httpx.Response(200, json={"choices": [{"message": {"refusal": SECRET}}]}),
    completion(None),
    completion("{}", finish_reason="length"),
    completion("not JSON"),
    completion("x" * 140_000),
])
def test_bad_provider_envelope_is_rejected(simulation, response):
    result = FallbackAnalyst(provider(lambda request: response)).analyze(simulation)
    assert result.fallback_reason == "invalid_response"
    assert SECRET not in result.model_dump_json()


@pytest.mark.parametrize("model", ["gpt-6-luna", "gpt-6-astra"])
@pytest.mark.parametrize("mode", ["scenario", "comparison"])
def test_gpt6_responses_uses_strict_schema_and_verified_facts(simulation, model, mode):
    def handler(request):
        body = json.loads(request.content)
        assert request.url.path == "/v1/responses"
        assert request.headers["Authorization"] == f"Bearer {SECRET}"
        assert body["model"] == model
        assert body["instructions"] == SYSTEM_PROMPT
        assert body["store"] is False
        assert body["reasoning"] == {"effort": "low"}
        assert body["max_output_tokens"] == 4096
        assert "temperature" not in body and "max_tokens" not in body
        assert "messages" not in body and "response_format" not in body
        output_format = body["text"]["format"]
        assert output_format["type"] == "json_schema" and output_format["strict"] is True
        schema = output_format["schema"]
        sections = {"summary", "strengths", "risks", "tradeoffs", "recommendations"}
        assert schema["type"] == "object" and schema["additionalProperties"] is False
        assert set(schema["required"]) == set(schema["properties"]) == sections
        for field in schema["properties"].values():
            assert field["type"] == "array" and field["items"] == {"type": "string"}
        payload = json.loads(body["input"])
        assert SECRET not in body["input"]
        assert payload["mode"] == mode
        assert payload["simulations"]["current"] == simulation.model_dump()
        if mode == "comparison":
            assert payload["simulations"]["alternative"] == simulation.model_dump()
        return httpx.Response(200, json=response_envelope(json.dumps(payload["required_fact_ids"])))

    analyst = provider(handler, api_mode="responses", model=model)
    result = (
        analyst.analyze(simulation) if mode == "scenario"
        else analyst.compare(simulation, simulation)
    )
    assert result.provider == "llm"
    assert result.fallback_reason is None
    assert result.fact_refs
    assert SECRET not in result.model_dump_json()
    if mode == "scenario":
        assert result.facts["score_before"] == 52.55768
        assert result.facts["score_after"] == 56.54307
    else:
        assert result.facts["score_difference"] == 0


@pytest.mark.parametrize("model", ["gpt-6-luna", "gpt-6-astra"])
def test_gpt6_chat_mode_omits_unsupported_generation_parameters(simulation, model):
    def handler(request):
        body = json.loads(request.content)
        assert request.url.path == "/v1/chat/completions"
        assert "temperature" not in body and "max_tokens" not in body
        assert body["reasoning_effort"] == "low"
        assert body["max_completion_tokens"] == 4096
        payload = json.loads(body["messages"][1]["content"])
        return completion(json.dumps(payload["required_fact_ids"]), finish_reason="stop")

    assert provider(handler, model=model).analyze(simulation).provider == "llm"


@pytest.mark.parametrize("envelope", [
    {},
    response_envelope(
        "{}", status="incomplete", incomplete_details={"reason": "max_output_tokens"},
    ),
    response_envelope("{}", status="incomplete", incomplete_details={"reason": "content_filter"}),
    response_envelope("{}", status="failed", error={"message": SECRET}),
    response_envelope("{}", error={"message": SECRET}),
    response_envelope("{}", incomplete_details={"reason": "max_output_tokens"}),
    response_envelope("{}", output=[]),
    response_envelope("{}", output=None),
    response_envelope("{}", output=[{"type": "function_call", "arguments": SECRET}]),
    response_envelope("{}", output=[{
        "type": "message", "role": "assistant", "status": "completed", "content": [
            {"type": "refusal", "refusal": SECRET},
        ],
    }]),
    response_envelope("{}", output=[{
        "type": "message", "role": "assistant", "status": "incomplete", "content": [],
    }]),
    response_envelope("{}", output=[{
        "type": "message", "role": "user", "status": "completed", "content": [],
    }]),
    response_envelope("{}", output=[{
        "type": "message", "role": "assistant", "status": "completed", "content": [],
    }]),
    response_envelope("{}", output=[{
        "type": "message", "role": "assistant", "status": "completed", "content": SECRET,
    }]),
    response_envelope(None),
    response_envelope("not JSON"),
    response_envelope("x" * 140_000),
])
def test_bad_responses_envelope_uses_safe_fallback(simulation, envelope, caplog):
    result = FallbackAnalyst(provider(
        lambda request: httpx.Response(200, json=envelope), api_mode="responses",
    )).analyze(simulation)
    assert result.fallback_reason == "invalid_response"
    assert result.facts["score_after"] == 56.54307
    assert SECRET not in result.model_dump_json()
    assert SECRET not in caplog.text


def test_unexpected_provider_exception_is_contained(simulation):
    def handler(request):
        raise RuntimeError(SECRET)

    result = FallbackAnalyst(provider(handler)).analyze(simulation)
    assert result.fallback_reason == "provider_error"
    assert SECRET not in result.model_dump_json()


@pytest.mark.parametrize("override", [
    {"VELTARQ_LLM_API_KEY": ""}, {"VELTARQ_LLM_MODEL": ""}, {"VELTARQ_LLM_BASE_URL": ""},
    {"VELTARQ_LLM_BASE_URL": "invalid-url"},
    {"VELTARQ_LLM_BASE_URL": "https://user:secret@llm.example/v1"},
    {"VELTARQ_LLM_BASE_URL": "https://llm.example/v1?api_key=secret"},
    {"VELTARQ_LLM_BASE_URL": "https://llm.example/v1#secret"},
    {"VELTARQ_LLM_BASE_URL": "https://[invalid"},
    {"VELTARQ_LLM_TIMEOUT_SECONDS": "invalid"}, {"VELTARQ_LLM_TIMEOUT_SECONDS": "nan"},
    {"VELTARQ_LLM_TIMEOUT_SECONDS": "inf"}, {"VELTARQ_LLM_TIMEOUT_SECONDS": "0"},
    {"VELTARQ_LLM_TIMEOUT_SECONDS": "31"},
    {"VELTARQ_LLM_API_MODE": ""}, {"VELTARQ_LLM_API_MODE": "invalid"},
])
def test_missing_or_invalid_settings_keep_calculation_and_fallback_available(
    simulation, monkeypatch, override,
):
    for name, value in {
        "VELTARQ_LLM_BASE_URL": "https://llm.example/v1", "VELTARQ_LLM_MODEL": "test-model",
        "VELTARQ_LLM_API_KEY": SECRET, "VELTARQ_LLM_TIMEOUT_SECONDS": "20",
        "VELTARQ_LLM_API_MODE": "chat_completions", **override,
    }.items():
        monkeypatch.setenv(name, value)
    analyst = create_analyst_from_environment()
    result = analyst.analyze(simulation)
    assert result.provider == "deterministic_fallback"
    assert result.fallback_reason == "not_configured"
    assert result.facts["score_after"] == 56.54307


@pytest.mark.parametrize("api_mode", [None, "chat_completions", "responses"])
def test_environment_configures_provider_and_timeout(monkeypatch, api_mode):
    monkeypatch.delenv("VELTARQ_LLM_API_MODE", raising=False)
    if api_mode is not None:
        monkeypatch.setenv("VELTARQ_LLM_API_MODE", api_mode)
    for name, value in {
        "VELTARQ_LLM_BASE_URL": "https://llm.example/v1/", "VELTARQ_LLM_MODEL": "test-model",
        "VELTARQ_LLM_API_KEY": SECRET, "VELTARQ_LLM_TIMEOUT_SECONDS": "7.5",
    }.items():
        monkeypatch.setenv(name, value)
    analyst = create_analyst_from_environment()
    assert isinstance(analyst, FallbackAnalyst)
    assert analyst.primary.base_url == "https://llm.example/v1"
    assert analyst.primary.timeout_seconds == 7.5
    assert analyst.primary.api_mode == (api_mode or "chat_completions")
    analyst.primary.client.close()


def test_comparison_covers_losses_remaining_critical_and_lower_score(simulation):
    alternative = SimulationEngine().simulate([
        Decision(measure_id="M1", district_id="esil"),
        Decision(measure_id="M4", district_id="almaty"),
        Decision(measure_id="M9", district_id="saryarka"),
        Decision(measure_id="M11", district_id="baikonur"),
        Decision(measure_id="M14"),
    ])

    def handler(request):
        payload = json.loads(json.loads(request.content)["messages"][1]["content"])
        assert payload["mode"] == "comparison"
        assert payload["simulations"]["current"] == simulation.model_dump()
        assert payload["simulations"]["alternative"] == alternative.model_dump()
        assert payload["facts"]["comparison.losses"]["values"]
        return completion(json.dumps(payload["required_fact_ids"]))

    result = provider(handler).compare(simulation, alternative)
    assert result.provider == "llm"
    assert "ниже" in result.summary
    assert "не подтверждает преимущество" in result.recommendations[0]
    assert "Остались критические" in result.risks[0]
    fallback = FallbackAnalyst(provider(lambda request: httpx.Response(503)))
    deterministic = fallback.compare(simulation, alternative)
    assert deterministic.fallback_reason == "provider_error"
    assert "ниже показатели" in deterministic.tradeoffs[1]
    analysis = GroundedScenarioAnalyst().analyze(alternative)
    assert "Ухудшения показателей" in analysis.tradeoffs[1]
    assert "не активировались" in analysis.strengths[1]


def test_equal_comparison_does_not_claim_improvement(simulation):
    result = GroundedScenarioAnalyst().compare(simulation, simulation)
    assert "одинаковый" in result.summary
    assert result.facts["score_difference"] == 0
    assert "нет районов" in result.strengths[0]
    assert "не подтверждает преимущество" in result.recommendations[0]


def test_no_positive_change_is_not_presented_as_benefit(simulation):
    unchanged = simulation.model_copy(deep=True)
    for district in unchanged.districts:
        district.score_after = district.score_before
        district.score_delta = 0
        for indicator in district.indicators:
            indicator.after = indicator.before
            indicator.delta = 0
    result = GroundedScenarioAnalyst().analyze(unchanged)
    assert result.strengths[0] == "Районов с ростом итоговой оценки нет."
