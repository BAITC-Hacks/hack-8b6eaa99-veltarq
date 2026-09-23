from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from types import MappingProxyType
from typing import Mapping


class Direction(StrEnum):
    TRANSPORT = "transport"
    ECOLOGY = "ecology"
    SOCIAL = "social"
    SAFETY = "safety"
    SERVICES = "services"


class MeasureScope(StrEnum):
    DISTRICT = "district"
    CITY = "city"


class ConflictScope(StrEnum):
    GLOBAL = "global"
    SAME_DISTRICT = "same_district"


@dataclass(frozen=True, slots=True)
class Indicator:
    code: str
    direction: Direction
    name: str
    weight: float
    best_case: str


@dataclass(frozen=True, slots=True)
class District:
    id: str
    name: str
    population_share: float
    indicators: Mapping[str, float]
    profile: str


@dataclass(frozen=True, slots=True)
class Measure:
    id: str
    direction: Direction
    name: str
    scope: MeasureScope
    cost: int
    lag: int
    effects: Mapping[str, float]

    @property
    def realization_factor(self) -> float:
        return (8 - self.lag) / 8


@dataclass(frozen=True, slots=True)
class Synergy:
    first_measure_id: str
    second_measure_id: str
    indicator_code: str
    bonus: float


@dataclass(frozen=True, slots=True)
class Conflict:
    first_measure_id: str
    second_measure_id: str
    scope: ConflictScope


def readonly(values: Mapping[str, float]) -> Mapping[str, float]:
    return MappingProxyType(dict(values))
