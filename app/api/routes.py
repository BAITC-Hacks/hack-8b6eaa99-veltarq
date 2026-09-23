from __future__ import annotations

import os

from fastapi import APIRouter, HTTPException, Query

from app.catalog import (
    BUDGET,
    CONFLICTS,
    DECISION_COUNT,
    DISTRICTS,
    HORIZON_QUARTERS,
    INDICATORS,
    MEASURES,
    SYNERGIES,
)
from app.schemas import (
    AnalyzedSimulation,
    ComparisonRequest,
    ComparisonResult,
    LeaderboardEntry,
    RecommendationResult,
    SavedScenario,
    SaveScenarioRequest,
    ScenarioRequest,
    SimulationResult,
    ValidationResult,
)
from app.services.llm import create_analyst_from_environment
from app.services.recommendation import RecommendationEngine
from app.services.repository import ScenarioRepository
from app.services.simulation import ScenarioValidationError, SimulationEngine
from app.services.validation import ScenarioValidator

router = APIRouter(prefix="/api/v1")
validator = ScenarioValidator()
engine = SimulationEngine(validator)
analyst = create_analyst_from_environment()
recommender = RecommendationEngine(validator, engine)
repository = ScenarioRepository(os.getenv("VELTARQ_DB_PATH", "data/veltarq.db"))


@router.get("/catalog", tags=["catalog"])
def get_catalog() -> dict:
    return {
        "dataset_version": "1.0.0",
        "rules": {
            "budget": BUDGET,
            "decision_count": DECISION_COUNT,
            "horizon_quarters": HORIZON_QUARTERS,
            "max_measures_per_direction": 2,
        },
        "indicators": [
            {
                "code": item.code,
                "direction": item.direction,
                "name": item.name,
                "weight": item.weight,
                "best_case": item.best_case,
            }
            for item in INDICATORS
        ],
        "districts": [
            {
                "id": item.id,
                "name": item.name,
                "population_share": item.population_share,
                "indicators": dict(item.indicators),
                "profile": item.profile,
            }
            for item in DISTRICTS
        ],
        "measures": [
            {
                "id": item.id,
                "direction": item.direction,
                "name": item.name,
                "scope": item.scope,
                "cost": item.cost,
                "lag": item.lag,
                "realization_factor": item.realization_factor,
                "effects": dict(item.effects),
            }
            for item in MEASURES
        ],
        "synergies": [
            {
                "measures": [item.first_measure_id, item.second_measure_id],
                "indicator_code": item.indicator_code,
                "bonus": item.bonus,
                "target": "district_of_first_measure",
            }
            for item in SYNERGIES
        ],
        "conflicts": [
            {
                "measures": [item.first_measure_id, item.second_measure_id],
                "scope": item.scope,
            }
            for item in CONFLICTS
        ],
    }


@router.post("/scenarios/validate", response_model=ValidationResult, tags=["simulation"])
def validate_scenario(request: ScenarioRequest) -> ValidationResult:
    return validator.validate(request.decisions)


def _simulate_or_422(request: ScenarioRequest) -> SimulationResult:
    try:
        return engine.simulate(request.decisions)
    except ScenarioValidationError as error:
        raise HTTPException(
            status_code=422,
            detail=[issue.model_dump() for issue in error.issues],
        ) from error


@router.post("/scenarios/simulate", response_model=SimulationResult, tags=["simulation"])
def simulate_scenario(request: ScenarioRequest) -> SimulationResult:
    return _simulate_or_422(request)


@router.post("/scenarios/analyze", response_model=AnalyzedSimulation, tags=["analysis"])
def analyze_scenario(request: ScenarioRequest) -> AnalyzedSimulation:
    simulation = _simulate_or_422(request)
    return AnalyzedSimulation(simulation=simulation, analysis=analyst.analyze(simulation))


@router.post("/scenarios/compare", response_model=ComparisonResult, tags=["analysis"])
def compare_scenarios(request: ComparisonRequest) -> ComparisonResult:
    first = _simulate_or_422(request.first)
    second = _simulate_or_422(request.second)
    difference = round(second.score.score_after - first.score.score_after, 6)
    if difference > 0:
        better = "second"
        explanation = f"Второй сценарий лучше первого на {difference:g} балла."
    elif difference < 0:
        better = "first"
        explanation = f"Первый сценарий лучше второго на {abs(difference):g} балла."
    else:
        better = "equal"
        explanation = "Сценарии имеют одинаковый итоговый Score."
    return ComparisonResult(
        first=first,
        second=second,
        better_scenario=better,
        score_difference=abs(difference),
        explanation=explanation,
    )


@router.post(
    "/scenarios/recommend",
    response_model=RecommendationResult,
    tags=["analysis"],
)
def recommend_scenarios(
    request: ScenarioRequest,
    limit: int = Query(default=3, ge=1, le=10),
) -> RecommendationResult:
    try:
        return recommender.recommend(request.decisions, limit=limit)
    except ScenarioValidationError as error:
        raise HTTPException(
            status_code=422,
            detail=[issue.model_dump() for issue in error.issues],
        ) from error


@router.post("/scenarios/save", response_model=SavedScenario, tags=["storage"])
def save_scenario(request: SaveScenarioRequest) -> SavedScenario:
    simulation = _simulate_or_422(request.scenario)
    return repository.save(request.team_name, simulation)


@router.get("/scenarios/{scenario_id}", response_model=SavedScenario, tags=["storage"])
def get_saved_scenario(scenario_id: str) -> SavedScenario:
    scenario = repository.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail="Сценарий не найден.")
    return scenario


@router.get("/leaderboard", response_model=list[LeaderboardEntry], tags=["storage"])
def get_leaderboard(
    limit: int = Query(default=20, ge=1, le=100),
) -> list[LeaderboardEntry]:
    return repository.leaderboard(limit)
