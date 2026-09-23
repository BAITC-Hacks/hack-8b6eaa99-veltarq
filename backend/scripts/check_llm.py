"""Explicit live-provider smoke test. Never print credentials or provider response bodies."""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))


def main() -> int:
    load_dotenv(BACKEND_ROOT / ".env", override=False)
    required = ("VELTARQ_LLM_BASE_URL", "VELTARQ_LLM_MODEL", "VELTARQ_LLM_API_KEY")
    missing = [name for name in required if not os.getenv(name, "").strip()]
    if missing:
        print("LIVE LLM NOT RUN. Missing server settings: " + ", ".join(missing))
        return 2

    # Load the analyst only after the server environment file is loaded.
    from app.schemas import Decision
    from app.services.llm import create_analyst_from_environment
    from app.services.recommendation import RecommendationEngine
    from app.services.simulation import SimulationEngine

    decisions = [
        Decision(measure_id="M7", district_id="nura"),
        Decision(measure_id="M8", district_id="nura"),
        Decision(measure_id="M10", district_id="nura"),
        Decision(measure_id="M12"),
        Decision(measure_id="M5", district_id="saryarka"),
    ]
    simulation = SimulationEngine().simulate(decisions)
    assert simulation.score.score_before == 52.55768
    assert simulation.score.score_after == 56.54307
    analyst = create_analyst_from_environment()
    diagnostics: list[str] = []

    def observe_response(response) -> None:
        if response.status_code < 400:
            return
        # Only status and a fixed allowlist of error codes; never dump provider text.
        response.read()
        reason = "provider_error"
        try:
            error = response.json().get("error", {})
            if error.get("code") in {
                "invalid_api_key", "insufficient_quota", "model_not_found",
                "permission_denied", "unsupported_parameter", "rate_limit_exceeded",
            }:
                reason = error["code"]
        except (ValueError, AttributeError, TypeError):
            pass
        diagnostics.append(f"HTTP {response.status_code}: {reason}")

    primary = getattr(analyst, "primary", None)
    if primary is not None:
        primary.client.event_hooks["response"].append(observe_response)
    analysis = analyst.analyze(simulation)
    if analysis.provider != "llm":
        print("LIVE LLM NOT VERIFIED. Explanation fallback: " + str(analysis.fallback_reason))
        for diagnostic in diagnostics:
            print(diagnostic)
        return 1
    print("LIVE explanation: valid grounded fact references; controls 52.55768 / 56.54307.")

    candidate = RecommendationEngine().recommend(decisions, limit=1).candidates[0]
    alternative = SimulationEngine().simulate(candidate.decisions)
    comparison = analyst.compare(simulation, alternative)
    if comparison.provider != "llm":
        print("LIVE comparison NOT VERIFIED. Fallback: " + str(comparison.fallback_reason))
        for diagnostic in diagnostics:
            print(diagnostic)
        return 1
    print("LIVE comparison: valid grounded fact references for two server-calculated plans.")
    print("LIVE LLM VERIFIED: explanation and comparison both succeeded.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        # Exception messages may contain a provider URL, authorization data or response body.
        print("LIVE LLM NOT VERIFIED. Check server configuration and provider availability.")
        raise SystemExit(1) from None
