from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.mark.parametrize("origin", ["http://127.0.0.1:5175", "http://localhost:5175"])
def test_default_cors_allows_frontend_dev_server(origin, monkeypatch):
    monkeypatch.delenv("VELTARQ_CORS_ORIGINS", raising=False)
    client = TestClient(create_app())
    response = client.options(
        "/api/v1/scenarios/simulate",
        headers={"Origin": origin, "Access-Control-Request-Method": "POST"},
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


def test_cors_uses_explicit_origins(monkeypatch):
    monkeypatch.setenv("VELTARQ_CORS_ORIGINS", " https://city.example , https://other.example ")
    client = TestClient(create_app())
    accepted = client.get("/health", headers={"Origin": "https://city.example"})
    rejected = client.get("/health", headers={"Origin": "http://localhost:5175"})
    assert accepted.headers["access-control-allow-origin"] == "https://city.example"
    assert "access-control-allow-origin" not in rejected.headers


def test_static_host_preserves_api_errors_and_missing_assets(tmp_path):
    (tmp_path / "index.html").write_text("<html>City simulator</html>", encoding="utf-8")
    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "app.js").write_text("console.log('city')", encoding="utf-8")
    client = TestClient(create_app(frontend_dir=tmp_path))

    assert "City simulator" in client.get("/").text
    assert "City simulator" in client.get("/scenario/example").text
    assert client.get("/assets/app.js").text == "console.log('city')"
    assert client.get("/api/v1/catalog").json()["dataset_version"] == "1.0.0"
    assert client.get("/health").json()["status"] == "ok"
    assert client.post("/api/v1/scenarios/simulate", json={"decisions": []}).status_code == 422
    for path in ("/api/unknown", "/api/v1/unknown", "/assets/missing.js", "/missing.png"):
        response = client.get(path)
        assert response.status_code == 404
        assert response.json() == {"detail": "Not Found"}


def test_static_host_is_optional_and_requires_build(tmp_path, monkeypatch):
    monkeypatch.delenv("VELTARQ_SERVE_FRONTEND", raising=False)
    assert TestClient(create_app()).get("/").status_code == 404
    with pytest.raises(RuntimeError, match="npm run build"):
        create_app(frontend_dir=tmp_path)


def test_static_host_can_be_enabled_from_environment(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("City simulator", encoding="utf-8")
    monkeypatch.setenv("VELTARQ_SERVE_FRONTEND", "true")
    monkeypatch.setenv("VELTARQ_FRONTEND_DIR", str(tmp_path))
    assert TestClient(create_app()).get("/").text == "City simulator"
