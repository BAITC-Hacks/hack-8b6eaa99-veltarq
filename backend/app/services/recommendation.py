from __future__ import annotations

from app.catalog import DISTRICTS, MEASURES, MEASURES_BY_ID
from app.domain import MeasureScope
from app.schemas import Decision, RecommendationCandidate, RecommendationResult
from app.services.simulation import SimulationEngine
from app.services.validation import ScenarioValidator, normalize_decision


def _signature(decisions: list[Decision]) -> tuple[tuple[str, str], ...]:
    return tuple(
        sorted((decision.measure_id, decision.district_id or "") for decision in decisions)
    )


def _targets(measure_id: str) -> list[str | None]:
    measure = MEASURES_BY_ID[measure_id]
    if measure.scope is MeasureScope.CITY:
        return [None]
    return [district.id for district in DISTRICTS]


class RecommendationEngine:
    """Searches valid one-change neighbours and ranks them by exact backend Score."""

    def __init__(
        self,
        validator: ScenarioValidator | None = None,
        simulator: SimulationEngine | None = None,
    ):
        self.validator = validator or ScenarioValidator()
        self.simulator = simulator or SimulationEngine(self.validator)

    def recommend(self, decisions: list[Decision], limit: int = 3) -> RecommendationResult:
        normalized = [normalize_decision(decision) for decision in decisions]
        current = self.simulator.simulate(normalized)
        selected_ids = {decision.measure_id for decision in normalized}
        candidates: dict[tuple[tuple[str, str], ...], RecommendationCandidate] = {}

        neighbours: list[list[Decision]] = []
        for index, decision in enumerate(normalized):
            measure = MEASURES_BY_ID[decision.measure_id]
            if measure.scope is MeasureScope.DISTRICT:
                for district in DISTRICTS:
                    if district.id == decision.district_id:
                        continue
                    moved = list(normalized)
                    moved[index] = Decision(
                        measure_id=decision.measure_id,
                        district_id=district.id,
                    )
                    neighbours.append(moved)

            for replacement in MEASURES:
                if replacement.id in selected_ids:
                    continue
                for district_id in _targets(replacement.id):
                    replaced = list(normalized)
                    replaced[index] = Decision(
                        measure_id=replacement.id,
                        district_id=district_id,
                    )
                    neighbours.append(replaced)

        current_signature = _signature(normalized)
        for neighbour in neighbours:
            signature = _signature(neighbour)
            if signature == current_signature or signature in candidates:
                continue
            validation = self.validator.validate(neighbour)
            if not validation.valid:
                continue
            simulation = self.simulator.simulate(neighbour)
            improvement = simulation.score.score_after - current.score.score_after
            if improvement <= 0:
                continue
            candidates[signature] = RecommendationCandidate(
                decisions=neighbour,
                score=simulation.score.score_after,
                improvement=round(improvement, 6),
                budget_used=simulation.budget_used,
                budget_remaining=simulation.budget_remaining,
            )

        ranked = sorted(
            candidates.values(),
            key=lambda candidate: (candidate.score, -candidate.budget_used),
            reverse=True,
        )
        return RecommendationResult(
            current_score=current.score.score_after,
            candidates=ranked[:limit],
        )
