from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app import __version__
from app.api.preview_routes import router as preview_router
from app.api.routes import router

DEFAULT_CORS_ORIGINS = [
    f"http://{host}:{port}"
    for host in ("localhost", "127.0.0.1")
    for port in (3000, 5173, 5175)
]


def create_app(*, frontend_dir: Path | None = None) -> FastAPI:
    application = FastAPI(
        title="VELTARQ City Simulator API",
        description=(
            "Детерминированный backend AI-симулятора управления городом. "
            "Расчёты выполняются сервером, а аналитический слой объясняет готовые результаты."
        ),
        version=__version__,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[
            origin.strip()
            for origin in os.getenv(
                "VELTARQ_CORS_ORIGINS", ",".join(DEFAULT_CORS_ORIGINS)
            ).split(",")
            if origin.strip()
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.include_router(router)
    application.include_router(preview_router)

    @application.get("/health", tags=["system"])
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    if frontend_dir is None and os.getenv("VELTARQ_SERVE_FRONTEND", "").lower() in {
        "1", "true", "yes",
    }:
        configured_dir = os.getenv("VELTARQ_FRONTEND_DIR")
        frontend_dir = (
            Path(configured_dir) if configured_dir else Path(__file__).resolve().parents[2] / "dist"
        )
    if frontend_dir is not None:
        frontend_root = frontend_dir.resolve()
        if not (frontend_root / "index.html").is_file():
            raise RuntimeError(
                f"Frontend build not found in {frontend_root}. Run npm run build first."
            )

        @application.get("/{path:path}", include_in_schema=False)
        def frontend(path: str) -> FileResponse:
            # API typos and absent assets must stay real 404s, never SPA HTML.
            if path.split("/", 1)[0] in {"api", "health", "docs", "redoc", "openapi.json"}:
                raise HTTPException(status_code=404, detail="Not Found")
            candidate = (frontend_root / path).resolve()
            if not candidate.is_relative_to(frontend_root):
                raise HTTPException(status_code=404, detail="Not Found")
            if candidate.is_file():
                return FileResponse(candidate)
            if Path(path).suffix or path.split("/", 1)[0] == "assets":
                raise HTTPException(status_code=404, detail="Not Found")
            return FileResponse(frontend_root / "index.html")

    return application


app = create_app()
