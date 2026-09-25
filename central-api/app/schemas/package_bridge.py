"""Request/response shapes for the stateless packaging bridge (see
app.api.routes.package_bridge). instructor-api owns Paper/PaperVersion —
this endpoint doesn't touch central-api's own Exam/QuestionItem tables at
all, it just encrypts whatever finalized question content it's handed.

The candidate roster does NOT travel through here: local-exam-server
verifies check-in against a roster CSV loaded straight from disk at the
venue (see local-exam-server/internal/roster), not from anything bundled
into the encrypted package.
"""

from pydantic import BaseModel

from app.models.exam import PublishMode


class PoolItemIn(BaseModel):
    model_config = {"protected_namespaces": ()}

    id: str
    type: str  # "mcq" | "theory" — instructor-api's OBJECTIVE/THEORY, translated by the caller
    topic: str
    source: str  # "past_question" | "ai_generated"
    stem: str
    options: list[str] | None = None
    correct_index: int | None = None
    model_answer: str | None = None
    rubric: list | None = None


class BuildFromPaperRequest(BaseModel):
    exam_id: str  # instructor-api's PaperVersion id — becomes the package's AAD, same role as Exam.id elsewhere
    title: str
    duration_minutes: int
    pass_mark: float
    questions_per_candidate: int
    publish_mode: PublishMode
    pool: list[PoolItemIn]


class BuildFromPaperResponse(BaseModel):
    storage_path: str
    checksum_sha256: str
    release_key_hex: str
    pool_size: int
