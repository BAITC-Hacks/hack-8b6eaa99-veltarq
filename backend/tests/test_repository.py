from __future__ import annotations

from app.services.repository import ScenarioRepository
from app.services.simulation import SimulationEngine
from tests.test_simulation import example_decisions


def test_repository_saves_reads_and_ranks_scenarios(tmp_path) -> None:
    repository = ScenarioRepository(tmp_path / "test.db")
    simulation = SimulationEngine().simulate(example_decisions())

    first = repository.save("Team One", simulation)
    second = repository.save("Team Two", simulation)
    loaded = repository.get(first.id)
    leaderboard = repository.leaderboard()

    assert loaded is not None
    assert loaded.team_name == "Team One"
    assert loaded.simulation.score == simulation.score
    assert [entry.scenario_id for entry in leaderboard] == [first.id, second.id]


def test_repository_returns_none_for_unknown_id(tmp_path) -> None:
    repository = ScenarioRepository(tmp_path / "test.db")

    assert repository.get("missing") is None
