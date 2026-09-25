import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models.question import QuestionSource, QuestionStatus, QuestionType


class QuestionItemOut(BaseModel):
    id: uuid.UUID
    course_code: str
    session_label: str
    topic: str
    difficulty: str
    question_type: QuestionType
    source: QuestionSource
    status: QuestionStatus
    stem: str
    options: list[str] | None
    correct_index: int | None
    model_answer: str | None
    rubric: list | None
    times_used: int
    created_at: datetime

    model_config = {"from_attributes": True, "protected_namespaces": ()}
