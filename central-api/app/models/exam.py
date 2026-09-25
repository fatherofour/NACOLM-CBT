import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Integer, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PublishMode(str, enum.Enum):
    IMMEDIATE = "immediate"  # candidate sees their result the moment they submit
    INSTRUCTOR_CONTROLLED = "instructor_controlled"  # held until instructor publishes


class Exam(Base):
    __tablename__ = "exams"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(255))
    course_code: Mapped[str] = mapped_column(String(32), index=True)
    session_label: Mapped[str] = mapped_column(String(32), index=True)

    duration_minutes: Mapped[int] = mapped_column(Integer)
    pass_mark: Mapped[float] = mapped_column(Float)
    questions_per_candidate: Mapped[int] = mapped_column(Integer)

    # Share of the offline pool that must come from vetted past questions,
    # e.g. 0.7 == 70% past questions / 30% AI-drafted-from-study-material.
    # Instructors who only have past questions set this to 1.0; instructors
    # who want to lean on the study-material generator set it lower.
    past_question_ratio: Mapped[float] = mapped_column(Float, default=0.7)

    publish_mode: Mapped[PublishMode] = mapped_column(
        Enum(PublishMode, name="publish_mode"), default=PublishMode.INSTRUCTOR_CONTROLLED
    )
    scheduled_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    topics: Mapped[list | None] = mapped_column(JSON, nullable=True)  # optional topic filter, list[str]

    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ExamPoolItem(Base):
    """The stage-1 selection: the (larger-than-needed) set of approved
    questions bundled into an exam's encrypted package. The offline local
    exam server draws each candidate's actual paper from this pool
    (stage 2), so the pool must be bigger than questions_per_candidate.
    """

    __tablename__ = "exam_pool_items"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    exam_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("exams.id", ondelete="CASCADE"), index=True)
    question_item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("question_items.id"))


class ExamPackage(Base):
    __tablename__ = "exam_packages"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    exam_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("exams.id", ondelete="CASCADE"), index=True)
    storage_path: Mapped[str] = mapped_column(String(1024))
    checksum_sha256: Mapped[str] = mapped_column(String(64))
    built_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # The AES key itself is deliberately NOT stored alongside the package.
    # It is withheld and released to the venue separately at exam start time.
    key_released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
