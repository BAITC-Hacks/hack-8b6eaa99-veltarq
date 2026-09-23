from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class Decision(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    measure_id: str = Field(min_length=2, max_length=8)
    district_id: str | None = None


class ScenarioRequest(BaseModel):
    decisions: list[Decision]


class ValidationIssue(BaseModel):
    code: str
    message: str
    decision_index: int | None = None


class ValidationResult(BaseModel):
    valid: bool
    budget_used: int
    budget_remaining: int
    issues: list[ValidationIssue]


class IndicatorChange(BaseModel):
    code: str
    before: float
    after: float
    delta: float


class DistrictResult(BaseModel):
    district_id: str
    district_name: str
    population_share: float
    score_before: float
    score_after: float
    score_delta: float
    indicators: list[IndicatorChange]


class Contribution(BaseModel):
    source: str
    source_type: str
    district_id: str
    indicator_code: str
    delta: float


class ScoreBreakdown(BaseModel):
    city_average_before: float
    city_average_after: float
    weakest_district_before: float
    weakest_district_after: float
    critical_count_before: int
    critical_count_after: int
    score_before: float
    score_after: float
    score_delta: float


class SimulationResult(BaseModel):
    dataset_version: str = "1.0.0"
    horizon_quarters: int
    budget_used: int
    budget_remaining: int
    decisions: list[Decision]
    districts: list[DistrictResult]
    contributions: list[Contribution]
    activated_synergies: list[str]
    score: ScoreBreakdown


class AnalysisResult(BaseModel):
    provider: str = "deterministic"
    summary: str
    strengths: list[str]
    risks: list[str]
    tradeoffs: list[str]
    recommendations: list[str]
    facts: dict[str, Any]


class AnalyzedSimulation(BaseModel):
    simulation: SimulationResult
    analysis: AnalysisResult


class ComparisonRequest(BaseModel):
    first: ScenarioRequest
    second: ScenarioRequest


class ComparisonResult(BaseModel):
    first: SimulationResult
    second: SimulationResult
    better_scenario: str
    score_difference: float
    explanation: str


class RecommendationCandidate(BaseModel):
    decisions: list[Decision]
    score: float
    improvement: float
    budget_used: int
    budget_remaining: int


class RecommendationResult(BaseModel):
    current_score: float
    candidates: list[RecommendationCandidate]


class SaveScenarioRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    team_name: str = Field(min_length=1, max_length=100)
    scenario: ScenarioRequest


class SavedScenario(BaseModel):
    id: str
    team_name: str
    created_at: datetime
    simulation: SimulationResult


class LeaderboardEntry(BaseModel):
    scenario_id: str
    team_name: str
    score: float
    budget_used: int
    created_at: datetime
