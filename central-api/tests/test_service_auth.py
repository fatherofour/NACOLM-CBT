from tests.conftest import TEST_SERVICE_TOKEN

PROTECTED = [
    ("GET", "/documents"),
    ("GET", "/questions/drafts"),
    ("GET", "/exams"),
    ("POST", "/package-bridge/build"),
    ("POST", "/question-drafts/stage"),
]


def test_protected_routes_refuse_without_token(raw_client):
    for method, path in PROTECTED:
        assert raw_client.request(method, path).status_code == 401, path


def test_protected_routes_refuse_wrong_token(raw_client):
    for method, path in PROTECTED:
        res = raw_client.request(method, path, headers={"X-Service-Token": "nope"})
        assert res.status_code == 401, path


def test_correct_token_passes_the_gate(raw_client):
    res = raw_client.get("/documents", headers={"X-Service-Token": TEST_SERVICE_TOKEN})
    assert res.status_code != 401


def test_unset_token_fails_closed(raw_client):
    from app.core.config import Settings, get_settings
    from app.main import app

    app.dependency_overrides[get_settings] = lambda: Settings(service_token=None)
    res = raw_client.get("/documents", headers={"X-Service-Token": ""})
    assert res.status_code == 401


def test_health_stays_open_and_docs_are_off(raw_client):
    assert raw_client.get("/health").status_code == 200
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert raw_client.get(path).status_code == 404, path
