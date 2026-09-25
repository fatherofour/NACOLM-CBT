"""Orchestrates the instructor's "generate questions from..." choice when
setting an exam: past questions already in the bank, AI-drafted from study
material, or a blend of both. This runs BEFORE an Exam row necessarily
exists — it stages a set of QuestionItem drafts for the approval portal;
Exam.past_question_ratio (see question_selection.py) is a separate, later
decision about how an *approved* pool mixes sources when a package is built.
"""

from __future__ import annotations

import enum

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.question import QuestionItem, QuestionSource, QuestionStatus, QuestionType
from app.services.embeddings import EmbeddingProvider
from app.services.llm import LLMProvider
from app.services.question_generation import generate_draft_questions


class DraftSource(str, enum.Enum):
    PAST_QUESTION = "past_question"  # no AI: surface existing bank items for review
    STUDY_MATERIAL = "study_material"  # all new, AI-drafted from ingested material
    BOTH = "both"  # blends existing bank items with new AI drafts


def _existing_past_questions(db: Session, course_code: str, session_label: str, topic: str, limit: int) -> list[QuestionItem]:
    stmt = (
        select(QuestionItem)
        .where(
            QuestionItem.course_code == course_code,
            QuestionItem.session_label == session_label,
            QuestionItem.topic == topic,
            QuestionItem.source == QuestionSource.PAST_QUESTION,
            QuestionItem.status.in_([QuestionStatus.APPROVED, QuestionStatus.DRAFT]),
        )
        .limit(limit)
    )
    return list(db.scalars(stmt))


def stage_draft_set(
    db: Session,
    course_code: str,
    session_label: str,
    topic: str,
    question_type: QuestionType,
    count: int,
    source: DraftSource,
    llm: LLMProvider,
    embedding_provider: EmbeddingProvider,
) -> list[QuestionItem]:
    """Returns the draft set for the instructor's approval screen. For
    PAST_QUESTION this never calls the LLM — it just surfaces what's already
    in the bank. For STUDY_MATERIAL / BOTH, new drafts are created (and
    added to the session, not yet committed — the caller commits) via the
    RAG pipeline.
    """
    if source == DraftSource.PAST_QUESTION:
        return _existing_past_questions(db, course_code, session_label, topic, count)

    if source == DraftSource.STUDY_MATERIAL:
        return generate_draft_questions(
            db, course_code, session_label, topic, question_type, count, llm, embedding_provider
        )

    # BOTH: blend — reuse as many past questions as are available (up to the
    # full requested count), and only generate as many new ones as needed to
    # make up the rest. This minimizes unnecessary LLM calls: if the bank
    # alone already covers the count, AI generation is skipped entirely.
    past_items = _existing_past_questions(db, course_code, session_label, topic, count)
    remaining = count - len(past_items)
    ai_items = (
        generate_draft_questions(
            db, course_code, session_label, topic, question_type, remaining, llm, embedding_provider
        )
        if remaining > 0
        else []
    )
    return past_items + ai_items
