import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db
from app.core.config import Settings, get_settings
from app.db.base import Base
from app.main import app
from app.models.document import Document
from app.models.exam import Exam, ExamPackage, ExamPoolItem
from app.models.question import QuestionItem
from app.models.user import User

# document_chunks is created by hand with a plain TEXT stand-in for the
# embedding column: pgvector's Vector type has no SQLite compiler, so
# Base.metadata.create_all() can't build it against the in-memory test DB.
_SQLITE_TABLES = [User.__table__, Document.__table__, QuestionItem.__table__, Exam.__table__, ExamPoolItem.__table__, ExamPackage.__table__]


@pytest.fixture
def db_engine():
    """A fresh in-memory SQLite DB per test — NOT shared across tests, and
    NOT the same object as any other test's engine, so tests can't leak
    state into each other via FastAPI's global dependency_overrides."""
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine, tables=_SQLITE_TABLES)
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE document_chunks ("
                "id TEXT PRIMARY KEY, document_id TEXT, chunk_index INTEGER, "
                "content TEXT, embedding TEXT)"
            )
        )
    yield engine
    engine.dispose()


@pytest.fixture
def db_session(db_engine):
    """A session bound to the same per-test engine `client` uses, for tests
    that want to seed data directly rather than through the API."""
    Session = sessionmaker(bind=db_engine, autoflush=False, autocommit=False)
    session = Session()
    yield session
    session.close()


TEST_SERVICE_TOKEN = "test-service-token"


@pytest.fixture
def raw_client(db_engine):
    """Client with no service token header, for testing the auth gate itself."""
    Session = sessionmaker(bind=db_engine, autoflush=False, autocommit=False)

    def override_get_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_settings] = lambda: Settings(service_token=TEST_SERVICE_TOKEN)
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_settings, None)


@pytest.fixture
def client(raw_client):
    """raw_client plus the service token. Deliberately NOT used as
    `with TestClient(app) as c:` — that would run app.main's lifespan
    hook, which tries to reach a real Postgres instance."""
    raw_client.headers["X-Service-Token"] = TEST_SERVICE_TOKEN
    return raw_client
