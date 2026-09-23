from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from app.catalog import CRITICAL_THRESHOLD, DISTRICTS_BY_ID, INDICATORS_BY_CODE, MEASURES_BY_ID
from app.schemas import AnalysisResult, ExplanationSelection, SimulationResult

SECTIONS = ("summary", "strengths", "risks", "tradeoffs", "recommendations")


@dataclass
class FactCatalog:
    """Verified server sentences, with required coverage and optional LLM prioritization."""

    mode: str
    simulations: dict[str, SimulationResult]
    facts: dict[str, dict[str, Any]] = field(default_factory=dict)
    required_fact_ids: dict[str, list[str]] = field(
        default_factory=lambda: {section: [] for section in SECTIONS}
    )

    def add(
        self, fact_id: str, section: str, kind: str, text: str,
        values: Any, *, required: bool = False,
    ) -> None:
        self.facts[fact_id] = {
            "section": section, "kind": kind, "text": text, "values": values,
        }
        if required:
            self.required_fact_ids[section].append(fact_id)

    def payload(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "simulations": {
                name: result.model_dump() for name, result in self.simulations.items()
            },
            "facts": self.facts,
            "required_fact_ids": self.required_fact_ids,
        }

    def render(self, selection: ExplanationSelection, *, provider: str) -> AnalysisResult:
        refs = selection.model_dump()
        for section, selected in refs.items():
            if len(set(selected)) != len(selected):
                raise ValueError("Duplicate fact reference")
            if not set(self.required_fact_ids[section]).issubset(selected):
                raise ValueError("Required fact omitted")
            if any(
                fact_id not in self.facts or self.facts[fact_id]["section"] != section
                for fact_id in selected
            ):
                raise ValueError("Unknown fact or incorrect section")
        rendered = {
            section: [self.facts[fact_id]["text"] for fact_id in selected]
            for section, selected in refs.items()
        }
        current = self.simulations["current"]
        weakest = min(current.districts, key=lambda district: district.score_after)
        facts: dict[str, Any] = {
            "score_before": current.score.score_before,
            "score_after": current.score.score_after,
            "score_delta": current.score.score_delta,
            "budget_used": current.budget_used,
            "budget_remaining": current.budget_remaining,
            "selected_measures": [MEASURES_BY_ID[d.measure_id].name for d in current.decisions],
            "activated_synergies": current.activated_synergies,
            "critical_count": current.score.critical_count_after,
            "weakest_district": weakest.district_name,
            "verified_facts": {
                fact_id: self.facts[fact_id] for ids in refs.values() for fact_id in ids
            },
        }
        if "alternative" in self.simulations:
            alternative = self.simulations["alternative"]
            facts["alternative_score"] = alternative.score.score_after
            facts["score_difference"] = round(
                alternative.score.score_after - current.score.score_after, 6,
            )
        return AnalysisResult(
            provider=provider, summary=" ".join(rendered["summary"]),
            strengths=rendered["strengths"], risks=rendered["risks"],
            tradeoffs=rendered["tradeoffs"], recommendations=rendered["recommendations"],
            facts=facts, fact_refs=refs,
        )


def _indicator_label(district_name: str, code: str) -> str:
    return f"{district_name}: {INDICATORS_BY_CODE[code].name}"


def _add_scenario(catalog: FactCatalog, result: SimulationResult, prefix: str) -> None:
    required = catalog.mode == "scenario"
    label = "" if required else ("Текущий план. " if prefix == "current" else "Альтернатива. ")

    def add(
        name: str, section: str, kind: str, text: str, values: Any, *, mandatory: bool = False,
    ) -> None:
        catalog.add(
            f"{prefix}.{name}", section, kind, label + text, values,
            required=required and mandatory,
        )

    score = result.score
    add(
        "score", "summary", "score",
        f"Сценарий изменил итоговый Score с {score.score_before:.5f} "
        f"до {score.score_after:.5f} ({score.score_delta:+.5f}).",
        score.model_dump(), mandatory=True,
    )
    beneficiaries = [district for district in result.districts if district.score_delta > 0]
    add(
        "beneficiaries", "strengths", "district_benefits",
        "Районная оценка выросла: " + "; ".join(
            f"{district.district_name} ({district.score_delta:+g})" for district in beneficiaries
        ) + "." if beneficiaries else "Районов с ростом итоговой оценки нет.",
        [district.model_dump(exclude={"indicators"}) for district in beneficiaries],
        mandatory=True,
    )
    critical = []
    declines = []
    for district in result.districts:
        add(
            f"district.{district.district_id}",
            "strengths" if district.score_delta > 0 else "risks", "district_score",
            f"{district.district_name}: районная оценка {district.score_before:g} → "
            f"{district.score_after:g} ({district.score_delta:+g}).",
            district.model_dump(exclude={"indicators"}),
        )
        for indicator in district.indicators:
            item = {"district_id": district.district_id, **indicator.model_dump()}
            text = (
                f"{_indicator_label(district.district_name, indicator.code)} — "
                f"{indicator.before:g} → {indicator.after:g} ({indicator.delta:+g})."
            )
            section = (
                "strengths" if indicator.delta > 0
                else "tradeoffs" if indicator.delta < 0 else "risks"
            )
            add(
                f"indicator.{district.district_id}.{indicator.code}", section,
                "indicator_change", text, item,
            )
            if indicator.after < CRITICAL_THRESHOLD:
                critical.append((district, indicator, item))
            if indicator.delta < 0:
                declines.append((text, item))
    add(
        "critical", "risks", "critical_indicators",
        "Остались критические показатели: " + "; ".join(
            f"{_indicator_label(district.district_name, indicator.code)} ({indicator.after:g})"
            for district, indicator, _ in critical
        ) + "." if critical else "После применения мер критических показателей не осталось.",
        {"count": score.critical_count_after, "indicators": [item for _, _, item in critical]},
        mandatory=True,
    )
    add(
        "budget", "tradeoffs", "budget",
        f"Использовано {result.budget_used} единиц бюджета; остаток — {result.budget_remaining}.",
        {"used": result.budget_used, "remaining": result.budget_remaining}, mandatory=True,
    )
    add(
        "declines", "tradeoffs", "indicator_losses",
        "Ухудшения показателей: " + " ".join(text for text, _ in declines)
        if declines else "Снижения показателей по сравнению с исходным состоянием нет.",
        [item for _, item in declines], mandatory=True,
    )
    grouped = defaultdict(list)
    for contribution in result.contributions:
        grouped[(contribution.source_type, contribution.source)].append(contribution)
    for (source_type, source), contributions in grouped.items():
        title = (
            f"Синергия {source}" if source_type == "synergy"
            else f"Мера «{MEASURES_BY_ID[source].name}»"
        )
        add(
            f"contribution.{source_type}.{source}", "strengths", "contribution",
            title + ": " + "; ".join(
                f"{_indicator_label(DISTRICTS_BY_ID[item.district_id].name, item.indicator_code)} "
                f"{item.delta:+g}"
                for item in contributions
            ) + ". Вклад до ограничения значений показателей диапазоном расчёта.",
            [item.model_dump() for item in contributions],
        )
    add(
        "synergies", "strengths", "synergies",
        "Сработали синергии: " + "; ".join(
            f"{item.source} — "
            f"{_indicator_label(DISTRICTS_BY_ID[item.district_id].name, item.indicator_code)} "
            f"{item.delta:+g}"
            for item in result.contributions if item.source_type == "synergy"
        ) + "." if result.activated_synergies else "Синергии выбранных мер не активировались.",
        [item.model_dump() for item in result.contributions if item.source_type == "synergy"],
        mandatory=True,
    )
    weakest = min(result.districts, key=lambda district: district.score_after)
    add(
        "next_step", "recommendations", "next_step",
        f"Для следующего сравнения проверьте меры для района {weakest.district_name}: "
        f"его итоговая оценка — {weakest.score_after:g}. "
        "Преимущество другого набора можно подтвердить только его расчётом.",
        {"district_id": weakest.district_id, "score_after": weakest.score_after}, mandatory=True,
    )


def scenario_catalog(result: SimulationResult) -> FactCatalog:
    catalog = FactCatalog(mode="scenario", simulations={"current": result})
    _add_scenario(catalog, result, "current")
    return catalog


def comparison_catalog(first: SimulationResult, second: SimulationResult) -> FactCatalog:
    catalog = FactCatalog(mode="comparison", simulations={"current": first, "alternative": second})
    _add_scenario(catalog, first, "current")
    _add_scenario(catalog, second, "alternative")
    difference = round(second.score.score_after - first.score.score_after, 6)
    outcome = (
        f"Альтернатива повышает итоговый Score на {difference:g}." if difference > 0
        else f"У альтернативы итоговый Score ниже на {abs(difference):g}." if difference < 0
        else "Оба плана имеют одинаковый итоговый Score."
    )
    catalog.add(
        "comparison.score", "summary", "score_comparison",
        f"Текущий план: Score {first.score.score_after:.5f}; "
        f"альтернатива: {second.score.score_after:.5f}. {outcome}",
        {"current": first.score.score_after, "alternative": second.score.score_after,
         "difference": difference}, required=True,
    )
    current_districts = {district.district_id: district for district in first.districts}
    benefits = []
    losses = []
    for district in second.districts:
        original = current_districts[district.district_id]
        if district.score_after > original.score_after:
            benefits.append({"district": district.district_name, "current": original.score_after,
                             "alternative": district.score_after})
        original_indicators = {indicator.code: indicator for indicator in original.indicators}
        for indicator in district.indicators:
            previous = original_indicators[indicator.code]
            if indicator.after < previous.after:
                losses.append({"district": district.district_name, "indicator": indicator.code,
                               "current": previous.after, "alternative": indicator.after})
            elif indicator.after > previous.after:
                catalog.add(
                    f"comparison.indicator.{district.district_id}.{indicator.code}",
                    "strengths", "indicator_comparison",
                    f"{_indicator_label(district.district_name, indicator.code)}: "
                    f"в текущем плане {previous.after:g}, в альтернативе {indicator.after:g}.",
                    {"district_id": district.district_id, "indicator_code": indicator.code,
                     "current": previous.after, "alternative": indicator.after},
                )
    catalog.add(
        "comparison.beneficiaries", "strengths", "district_comparison",
        "У альтернативы выше районная оценка: " + "; ".join(
            f"{item['district']} ({item['current']:g} → {item['alternative']:g})"
            for item in benefits
        ) + "." if benefits else "У альтернативы нет районов с более высокой итоговой оценкой.",
        benefits, required=True,
    )
    catalog.add(
        "comparison.critical", "risks", "critical_comparison",
        f"Критических показателей: текущий план — {first.score.critical_count_after}, "
        f"альтернатива — {second.score.critical_count_after}. "
        + catalog.facts["alternative.critical"]["text"],
        {"current": first.score.critical_count_after,
         "alternative": catalog.facts["alternative.critical"]["values"]}, required=True,
    )
    catalog.add(
        "comparison.budget", "tradeoffs", "budget_comparison",
        f"Бюджет текущего плана — {first.budget_used}, остаток {first.budget_remaining}; "
        f"альтернативы — {second.budget_used}, остаток {second.budget_remaining}.",
        {"current_used": first.budget_used, "current_remaining": first.budget_remaining,
         "alternative_used": second.budget_used, "alternative_remaining": second.budget_remaining},
        required=True,
    )
    catalog.add(
        "comparison.losses", "tradeoffs", "indicator_comparison_losses",
        "В альтернативе ниже показатели: " + "; ".join(
            f"{_indicator_label(item['district'], item['indicator'])} "
            f"({item['current']:g} → {item['alternative']:g})" for item in losses
        ) + "." if losses else "В альтернативе нет показателей ниже, чем в текущем плане.",
        losses, required=True,
    )
    catalog.add(
        "comparison.next_step", "recommendations", "verified_recommendation",
        "Найдено улучшение по итоговому Score среди проверенных вариантов. "
        "Оцените перечисленные компромиссы перед применением; глобальный оптимум не проверялся."
        if difference > 0 else
        "Расчёт не подтверждает преимущество альтернативы по итоговому Score. "
        "При выборе учитывайте районные показатели и бюджет.",
        {"improvement_verified": difference > 0, "difference": difference}, required=True,
    )
    return catalog


class GroundedScenarioAnalyst:
    """Deterministic explanation also works without a configured or available provider."""

    def __init__(self, fallback_reason: str | None = None):
        self.fallback_reason = fallback_reason

    def _render(self, catalog: FactCatalog) -> AnalysisResult:
        refs = {section: list(ids) for section, ids in catalog.required_fact_ids.items()}
        optional = [
            (fact_id, fact) for fact_id, fact in catalog.facts.items()
            if fact["section"] == "strengths"
            and fact["kind"] in {"indicator_change", "indicator_comparison"}
        ]
        if catalog.mode == "comparison":
            optional = [(fact_id, fact) for fact_id, fact in optional
                        if fact_id.startswith("comparison.")]
        optional.sort(key=lambda item: item[1]["values"].get("delta", 0), reverse=True)
        refs["strengths"].extend(fact_id for fact_id, _ in optional[:2])
        result = catalog.render(ExplanationSelection.model_validate(refs), provider="deterministic")
        result.fallback_reason = self.fallback_reason
        if self.fallback_reason:
            result.provider = "deterministic_fallback"
        return result

    def analyze(self, result: SimulationResult) -> AnalysisResult:
        return self._render(scenario_catalog(result))

    def compare(self, first: SimulationResult, second: SimulationResult) -> AnalysisResult:
        return self._render(comparison_catalog(first, second))
