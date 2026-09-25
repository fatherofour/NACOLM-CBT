import enum
import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

EMBEDDING_DIM = 1536


class DocumentType(str, enum.Enum):
    PAST_QUESTION = "past_question"
    STUDY_MATERIAL = "study_material"


class Document(Base):
    """A past-question paper or a study-material file uploaded for a given
    course/session. Both are stored the same way; PAST_QUESTION items feed
    the direct question pool, STUDY_MATERIAL items feed the RAG pipeline
    that drafts new questions when the past-question pool alone isn't enough.
    """

    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    course_code: Mapped[str] = mapped_column(String(32), index=True)
    session_label: Mapped[str] = mapped_column(String(32), index=True)  # e.g. "2024/2025"
    title: Mapped[str] = mapped_column(String(255))
    doc_type: Mapped[DocumentType] = mapped_column(Enum(DocumentType, name="document_type"))
    storage_path: Mapped[str] = mapped_column(String(1024))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    chunks: Mapped[list["DocumentChunk"]] = relationship(back_populates="document", cascade="all, delete-orphan")


class DocumentChunk(Base):
    """A chunk of a STUDY_MATERIAL document with its embedding, used for
    retrieval-augmented question generation."""

    __tablename__ = "document_chunks"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))
    chunk_index: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBEDDING_DIM), nullable=True)

    document: Mapped["Document"] = relationship(back_populates="chunks")
