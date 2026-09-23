from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.routes import router


def create_app() -> FastAPI:
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
        allow_origins=["http://localhost:3000", "http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.include_router(router)

    @application.get("/health", tags=["system"])
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    return application


app = create_app()
