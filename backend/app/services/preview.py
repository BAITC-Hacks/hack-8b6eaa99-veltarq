from __future__ import annotations

from pydantic import BaseModel

from app.catalog import DECISION_COUNT, DISTRICTS_BY_ID, MEASURES
from app.domain import MeasureScope
from app.schemas import Decision, IndicatorChange, ValidationIssue, ValidationResult
from app.services.simulation import ScenarioValidationError, SimulationEngine
from app.services.validation import ScenarioValidator, normalize_decision


class PartialScenarioValidator(ScenarioValidator):
    """Allow incomplete previews while preserving every other scenario constraint."""

    def validate(self, decisions: list[Decision]) -> ValidationResult:
        result = super().validate(decisions)
        if len(decisions) <= DECISION_COUNT:
            result.issues = [issue for issue in result.issues if issue.code != "decision_count"]
            result.valid = not result.issues
        return result


class PreviewDistrict(BaseModel):
    district_id: str
    district_name: str
    indicators: list[IndicatorChange]


class PreviewCandidate(BaseModel):
    measure_id: str
    district_id: str | None
    districts: list[PreviewDistrict]


class PreviewResult(BaseModel):
    dataset_version: str = "1.0.0"
    decisions: list[Decision]
    district_id: str
    horizon_quarters: int
    budget_used: int
    budget_remaining: int
    current: list[PreviewDistrict]
    candidates: list[PreviewCandidate]


class PreviewEngine:
    def __init__(self) -> None:
        self.validator = PartialScenarioValidator()
        self.simulator = SimulationEngine(self.validator)

    def preview(self, decisions: list[Decision], district_id: str) -> PreviewResult:
        normalized = [normalize_decision(decision) for decision in decisions]
        district_id = district_id.strip().lower()
        if district_id not in DISTRICTS_BY_ID:
            raise ScenarioValidationError([
                ValidationIssue(code="unknown_district", message="Целевой район не найден."),
            ])
        current = self.simulator.simulate(normalized)
        candidates: list[PreviewCandidate] = []
        selected = {decision.measure_id for decision in normalized}
        for measure in MEASURES:
            if measure.id in selected:
                continue
            target = None if measure.scope is MeasureScope.CITY else district_id
            proposed = [*normalized, Decision(measure_id=measure.id, district_id=target)]
            if not self.validator.validate(proposed).valid:
                continue
            calculated = self.simulator.simulate(proposed)
            changes: list[PreviewDistrict] = []
            for before, after in zip(current.districts, calculated.districts, strict=True):
                indicators = [
                    IndicatorChange(
                        code=next_value.code,
                        before=previous.after,
                        after=next_value.after,
                        delta=round(next_value.after - previous.after, 6),
                    )
                    for previous, next_value in zip(
                        before.indicators, after.indicators, strict=True,
                    )
                    if previous.after != next_value.after
                ]
                if indicators:
                    changes.append(PreviewDistrict(
                        district_id=after.district_id,
                        district_name=after.district_name,
                        indicators=indicators,
                    ))
            candidates.append(PreviewCandidate(
                measure_id=measure.id, district_id=target, districts=changes,
            ))
        # Scores remain private: an incomplete plan is never exposed as a final scenario.
        return PreviewResult(
            decisions=normalized,
            district_id=district_id,
            horizon_quarters=current.horizon_quarters,
            budget_used=current.budget_used,
            budget_remaining=current.budget_remaining,
            current=[PreviewDistrict(
                district_id=district.district_id,
                district_name=district.district_name,
                indicators=district.indicators,
            ) for district in current.districts],
            candidates=candidates,
        )
