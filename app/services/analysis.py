from __future__ import annotations

from app.catalog import DISTRICTS_BY_ID, INDICATORS_BY_CODE, MEASURES_BY_ID
from app.schemas import AnalysisResult, SimulationResult


class GroundedScenarioAnalyst:
    """Produces an evidence-based explanation without recalculating simulation values."""

    def analyze(self, result: SimulationResult) -> AnalysisResult:
        changes = [
            (district, indicator)
            for district in result.districts
            for indicator in district.indicators
            if indicator.delta != 0
        ]
        positive = sorted(changes, key=lambda item: item[1].delta, reverse=True)
        negative = sorted(changes, key=lambda item: item[1].delta)

        strengths = [
            (
                f"{district.district_name}: {INDICATORS_BY_CODE[indicator.code].name} "
                f"улучшился на {indicator.delta:g} пункта."
            )
            for district, indicator in positive[:3]
            if indicator.delta > 0
        ]

        critical = [
            (district, indicator)
            for district in result.districts
            for indicator in district.indicators
            if indicator.after < 40
        ]
        risks = [
            (
                f"{district.district_name}: {INDICATORS_BY_CODE[indicator.code].name} "
                f"остаётся на критическом уровне {indicator.after:g}."
            )
            for district, indicator in critical
        ]
        if not risks:
            risks.append("После применения решений показателей ниже 40 не осталось.")

        tradeoffs = [
            (
                f"Использовано {result.budget_used} из 100 единиц бюджета; "
                f"остаток составляет {result.budget_remaining}."
            )
        ]
        for district, indicator in negative:
            if indicator.delta < 0:
                tradeoffs.append(
                    f"{district.district_name}: {INDICATORS_BY_CODE[indicator.code].name} "
                    f"снизился на {abs(indicator.delta):g} пункта."
                )

        weakest = min(result.districts, key=lambda district: district.score_after)
        recommendations = [
            (
                f"При следующем сценарии в первую очередь проверьте меры для района "
                f"{weakest.district_name}, его итоговая оценка — {weakest.score_after:g}."
            )
        ]
        if result.budget_remaining > 0:
            recommendations.append(
                "Сравните текущий набор с валидным сценарием, который использует остаток бюджета."
            )
        selected = {decision.measure_id for decision in result.decisions}
        if "M12" in selected and "M10" not in selected:
            recommendations.append(
                "Проверьте вариант с M10 и M12: эта пара может активировать синергию B1."
            )

        selected_names = [MEASURES_BY_ID[item.measure_id].name for item in result.decisions]
        summary = (
            f"Сценарий изменил итоговый Score с {result.score.score_before:g} "
            f"до {result.score.score_after:g} ({result.score.score_delta:+g})."
        )
        return AnalysisResult(
            provider="deterministic",
            summary=summary,
            strengths=strengths or ["Положительных изменений показателей не обнаружено."],
            risks=risks,
            tradeoffs=tradeoffs,
            recommendations=recommendations,
            facts={
                "selected_measures": selected_names,
                "activated_synergies": result.activated_synergies,
                "critical_count": result.score.critical_count_after,
                "weakest_district": DISTRICTS_BY_ID[weakest.district_id].name,
            },
        )
