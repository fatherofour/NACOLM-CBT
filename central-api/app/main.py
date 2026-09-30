from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from sqlalchemy import text

from app.api.routes import documents, drafts, exams, package_bridge, questions
from app.core.security import require_service_token
from app.db.base import Base
from app.db.session import engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    # NOTE: create_all is a stand-in until Alembic migrations are wired up
    # (tracked as a follow-up — see central-api/README.md). Fine for a
    # single-environment dev/demo deploy, not for schema evolution in prod.
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        Base.metadata.create_all(bind=conn)
    yield


# No public API docs, and no CORS: browsers never talk to this service. The
# instructor portal reaches it only through instructor-api on the private network.
app = FastAPI(
    title="CBT Central Authoring & Management API",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

_protected = [Depends(require_service_token)]
app.include_router(documents.router, dependencies=_protected)
app.include_router(drafts.router, dependencies=_protected)
app.include_router(questions.router, dependencies=_protected)
app.include_router(exams.router, dependencies=_protected)
app.include_router(package_bridge.router, dependencies=_protected)


@app.get("/health")
def health():
    return {"status": "ok"}
