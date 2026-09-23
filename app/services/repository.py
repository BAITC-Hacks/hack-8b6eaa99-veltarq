from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from app.schemas import LeaderboardEntry, SavedScenario, SimulationResult


class ScenarioRepository:
    def __init__(self, database_path: str | Path):
        self.database_path = Path(database_path)

    def _connect(self) -> sqlite3.Connection:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS scenarios (
                id TEXT PRIMARY KEY,
                team_name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                score REAL NOT NULL,
                budget_used INTEGER NOT NULL,
                simulation_json TEXT NOT NULL
            )
            """
        )
        return connection

    def save(self, team_name: str, simulation: SimulationResult) -> SavedScenario:
        scenario_id = str(uuid4())
        created_at = datetime.now(UTC)
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO scenarios (
                    id, team_name, created_at, score, budget_used, simulation_json
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    scenario_id,
                    team_name.strip(),
                    created_at.isoformat(),
                    simulation.score.score_after,
                    simulation.budget_used,
                    simulation.model_dump_json(),
                ),
            )
        return SavedScenario(
            id=scenario_id,
            team_name=team_name.strip(),
            created_at=created_at,
            simulation=simulation,
        )

    def get(self, scenario_id: str) -> SavedScenario | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM scenarios WHERE id = ?",
                (scenario_id,),
            ).fetchone()
        if row is None:
            return None
        return SavedScenario(
            id=row["id"],
            team_name=row["team_name"],
            created_at=datetime.fromisoformat(row["created_at"]),
            simulation=SimulationResult.model_validate_json(row["simulation_json"]),
        )

    def leaderboard(self, limit: int = 20) -> list[LeaderboardEntry]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, team_name, score, budget_used, created_at
                FROM scenarios
                ORDER BY score DESC, created_at ASC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [
            LeaderboardEntry(
                scenario_id=row["id"],
                team_name=row["team_name"],
                score=row["score"],
                budget_used=row["budget_used"],
                created_at=datetime.fromisoformat(row["created_at"]),
            )
            for row in rows
        ]
