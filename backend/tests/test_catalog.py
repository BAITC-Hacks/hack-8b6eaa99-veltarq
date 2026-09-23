from __future__ import annotations

import pytest

from app.catalog import (
    DISTRICTS,
    INDICATORS,
    INDICATORS_BY_CODE,
    MEASURES,
    MEASURES_BY_ID,
    SYNERGIES,
)


def test_indicator_weights_sum_to_one() -> None:
    assert sum(item.weight for item in INDICATORS) == pytest.approx(1.0)


def test_population_shares_sum_to_one() -> None:
    assert sum(item.population_share for item in DISTRICTS) == pytest.approx(1.0)


def test_catalog_references_are_consistent() -> None:
    for district in DISTRICTS:
        assert set(district.indicators) == set(INDICATORS_BY_CODE)
        assert all(0 <= value <= 100 for value in district.indicators.values())

    for measure in MEASURES:
        assert set(measure.effects) <= set(INDICATORS_BY_CODE)
        assert 1 <= measure.lag < 8
        assert measure.cost > 0

    for synergy in SYNERGIES:
        assert synergy.first_measure_id in MEASURES_BY_ID
        assert synergy.second_measure_id in MEASURES_BY_ID
        assert synergy.indicator_code in INDICATORS_BY_CODE


def test_measure_ids_are_unique() -> None:
    assert len(MEASURES) == len(MEASURES_BY_ID) == 14
