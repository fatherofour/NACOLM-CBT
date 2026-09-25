import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class QuestionType(str, enum.Enum):
    MCQ = "mcq"
    THEORY = "theory"


class QuestionSource(str, enum.Enum):
    PAST_QUESTION = "past_question"
    AI_GENERATED = "ai_generated"


class QuestionStatus(str, enum.Enum):
    DRAFT = "draft"
    APPROVED = "approved"
    REJECTED = "rejected"


class QuestionItem(Base):
    """A single question in the bank. Whether it originated from a scanned
    past-question paper or was drafted by the RAG pipeline from study
    material, it goes through the same draft -> instructor review -> approved
    lifecycle before it is eligible for any exam pool.
    """

    __tablename__ = "question_items"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    course_code: Mapped[str] = mapped_column(String(32), index=True)
    session_label: Mapped[str] = mapped_column(String(32), index=True)
    topic: Mapped[str] = mapped_column(String(255), index=True)
    difficulty: Mapped[str] = mapped_column(String(16), default="medium")  # easy | medium | hard

    question_type: Mapped[QuestionType] = mapped_column(Enum(QuestionType, name="question_type"))
    source: Mapped[QuestionSource] = mapped_column(Enum(QuestionSource, name="question_source"))
    source_document_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), nullable=True
    )

    stem: Mapped[str] = mapped_column(Text)
    options: Mapped[list | None] = mapped_column(JSON, nullable=True)  # MCQ: list[str]
    correct_index: Mapped[int | None] = mapped_column(Integer, nullable=True)  # MCQ only
    model_answer: Mapped[str | None] = mapped_column(Text, nullable=True)  # Theory only
    rubric: Mapped[list | None] = mapped_column(JSON, nullable=True)  # Theory: list[{criterion, points}]

    status: Mapped[QuestionStatus] = mapped_column(
        Enum(QuestionStatus, name="question_status"), default=QuestionStatus.DRAFT
    )
    version: Mapped[int] = mapped_column(Integer, default=1)

    # Recency tracking so past-question selection can down-weight items that
    # keep reappearing exam after exam, instead of always picking the same set.
    times_used: Mapped[int] = mapped_column(Integer, default=0)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    approved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
