from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.schemas import ScenarioRequest
from app.services.preview import PreviewEngine, PreviewResult
from app.services.simulation import ScenarioValidationError


class PreviewRequest(ScenarioRequest):
    district_id: str


router = APIRouter(prefix="/api/v1")
engine = PreviewEngine()


@router.post("/scenarios/preview", response_model=PreviewResult, tags=["simulation"])
def preview_scenario(request: PreviewRequest) -> PreviewResult:
    try:
        return engine.preview(request.decisions, request.district_id)
    except ScenarioValidationError as error:
        raise HTTPException(
            status_code=422,
            detail=[issue.model_dump() for issue in error.issues],
        ) from error
