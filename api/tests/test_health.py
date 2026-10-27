from fastapi.testclient import TestClient

from app.main import app


def test_health():
    assert TestClient(app).get("/api/health").json() == {"ok": True}


def test_no_docs():
    client = TestClient(app)
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404
