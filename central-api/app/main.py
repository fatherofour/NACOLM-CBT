from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.routes import documents, drafts, exams, questions
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


app = FastAPI(title="CBT Central Authoring & Management API", lifespan=lifespan)

# Dev-permissive: the instructor portal runs on a different origin (Vite
# dev server) than this API. Tighten to the real portal's origin(s) before
# this is exposed beyond a local/demo network.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(documents.router)
app.include_router(drafts.router)
app.include_router(questions.router)
app.include_router(exams.router)


@app.get("/health")
def health():
    return {"status": "ok"}
