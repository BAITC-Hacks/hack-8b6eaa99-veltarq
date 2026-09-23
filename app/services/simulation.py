from __future__ import annotations

from collections import defaultdict

from app.catalog import (
    BUDGET,
    CRITICAL_THRESHOLD,
    DISTRICTS,
    HORIZON_QUARTERS,
    INDICATORS,
    MEASURES_BY_ID,
    SYNERGIES,
)
from app.domain import MeasureScope
from app.schemas import (
    Contribution,
    Decision,
    DistrictResult,
    IndicatorChange,
    ScoreBreakdown,
    SimulationResult,
    ValidationIssue,
)
from app.services.validation import ScenarioValidator, normalize_decision


class ScenarioValidationError(ValueError):
    def __init__(self, issues: list[ValidationIssue]):
        self.issues = issues
        super().__init__("Scenario validation failed")


def _clean(value: float) -> float:
    return round(value, 6)


def _district_score(values: dict[str, float]) -> float:
    return sum(values[indicator.code] * indicator.weight for indicator in INDICATORS)


def _score_state(values: dict[str, dict[str, float]]) -> tuple[float, float, int, float]:
    district_scores = {
        district.id: _district_score(values[district.id])
        for district in DISTRICTS
    }
    city_average = sum(
        district.population_share * district_scores[district.id]
        for district in DISTRICTS
    )
    weakest = min(district_scores.values())
    critical_count = sum(
        value < CRITICAL_THRESHOLD
        for district_values in values.values()
        for value in district_values.values()
    )
    score = 0.7 * city_average + 0.3 * weakest - critical_count
    return city_average, weakest, critical_count, score


class SimulationEngine:
    def __init__(self, validator: ScenarioValidator | None = None):
        self.validator = validator or ScenarioValidator()

    def simulate(self, decisions: list[Decision]) -> SimulationResult:
        normalized = [normalize_decision(decision) for decision in decisions]
        validation = self.validator.validate(normalized)
        if not validation.valid:
            raise ScenarioValidationError(validation.issues)

        before = {
            district.id: dict(district.indicators)
            for district in DISTRICTS
        }
        pending: dict[str, dict[str, float]] = {
            district.id: defaultdict(float)
            for district in DISTRICTS
        }
        contributions: list[Contribution] = []
        decisions_by_id = {decision.measure_id: decision for decision in normalized}

        for decision in normalized:
            measure = MEASURES_BY_ID[decision.measure_id]
            target_ids = (
                [district.id for district in DISTRICTS]
                if measure.scope is MeasureScope.CITY
                else [decision.district_id]
            )
            for district_id in target_ids:
                if district_id is None:  # Defensive guard; validation already rejects this.
                    continue
                for indicator_code, full_effect in measure.effects.items():
                    effect = full_effect * measure.realization_factor
                    pending[district_id][indicator_code] += effect
                    contributions.append(
                        Contribution(
                            source=measure.id,
                            source_type="measure",
                            district_id=district_id,
                            indicator_code=indicator_code,
                            delta=_clean(effect),
                        )
                    )

        activated_synergies: list[str] = []
        selected_ids = set(decisions_by_id)
        for synergy in SYNERGIES:
            if {synergy.first_measure_id, synergy.second_measure_id} - selected_ids:
                continue
            first_decision = decisions_by_id[synergy.first_measure_id]
            district_id = first_decision.district_id
            if district_id is None:
                continue
            pending[district_id][synergy.indicator_code] += synergy.bonus
            label = f"{synergy.first_measure_id}+{synergy.second_measure_id}"
            activated_synergies.append(label)
            contributions.append(
                Contribution(
                    source=label,
                    source_type="synergy",
                    district_id=district_id,
                    indicator_code=synergy.indicator_code,
                    delta=_clean(synergy.bonus),
                )
            )

        after: dict[str, dict[str, float]] = {}
        for district in DISTRICTS:
            after[district.id] = {}
            for indicator in INDICATORS:
                value = before[district.id][indicator.code] + pending[district.id][indicator.code]
                after[district.id][indicator.code] = min(100.0, max(0.0, value))

        before_average, before_weakest, before_critical, before_score = _score_state(before)
        after_average, after_weakest, after_critical, after_score = _score_state(after)

        district_results: list[DistrictResult] = []
        for district in DISTRICTS:
            score_before = _district_score(before[district.id])
            score_after = _district_score(after[district.id])
            district_results.append(
                DistrictResult(
                    district_id=district.id,
                    district_name=district.name,
                    population_share=district.population_share,
                    score_before=_clean(score_before),
                    score_after=_clean(score_after),
                    score_delta=_clean(score_after - score_before),
                    indicators=[
                        IndicatorChange(
                            code=indicator.code,
                            before=_clean(before[district.id][indicator.code]),
                            after=_clean(after[district.id][indicator.code]),
                            delta=_clean(
                                after[district.id][indicator.code]
                                - before[district.id][indicator.code]
                            ),
                        )
                        for indicator in INDICATORS
                    ],
                )
            )

        return SimulationResult(
            horizon_quarters=HORIZON_QUARTERS,
            budget_used=validation.budget_used,
            budget_remaining=BUDGET - validation.budget_used,
            decisions=normalized,
            districts=district_results,
            contributions=contributions,
            activated_synergies=activated_synergies,
            score=ScoreBreakdown(
                city_average_before=_clean(before_average),
                city_average_after=_clean(after_average),
                weakest_district_before=_clean(before_weakest),
                weakest_district_after=_clean(after_weakest),
                critical_count_before=before_critical,
                critical_count_after=after_critical,
                score_before=_clean(before_score),
                score_after=_clean(after_score),
                score_delta=_clean(after_score - before_score),
            ),
        )
