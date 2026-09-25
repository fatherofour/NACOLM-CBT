"""RAG question drafting: retrieve relevant study-material chunks, ask the
LLM to draft questions grounded in them, and land the result as DRAFT /
AI_GENERATED QuestionItems for an instructor to review in the approval
portal. Nothing here is ever auto-approved — see app.models.question.QuestionStatus.
"""

from __future__ import annotations

import json
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.document import Document, DocumentChunk, DocumentType
from app.models.question import QuestionItem, QuestionSource, QuestionStatus, QuestionType
from app.services.embeddings import EmbeddingProvider
from app.services.llm import LLMProvider

SYSTEM_PROMPT = (
    "You are drafting exam questions for a Nigerian Army College course. "
    "Base every question strictly on the supplied study-material excerpts — "
    "do not introduce facts that aren't in them. Respond with ONLY a JSON "
    "array, no prose, matching the schema you are given."
)

MCQ_SCHEMA_HINT = (
    '[{"stem": "...", "options": ["...", "...", "...", "..."], '
    '"correct_index": 0, "topic": "..."}]'
)
THEORY_SCHEMA_HINT = (
    '[{"stem": "...", "model_answer": "...", '
    '"rubric": [{"criterion": "...", "points": 5}], "topic": "..."}]'
)


def retrieve_relevant_chunks(
    db: Session,
    course_code: str,
    session_label: str,
    topic: str,
    embedding_provider: EmbeddingProvider,
    k: int = 6,
) -> list[DocumentChunk]:
    query_vector = embedding_provider.embed([topic])[0]
    stmt = (
        select(DocumentChunk)
        .join(Document, DocumentChunk.document_id == Document.id)
        .where(
            Document.course_code == course_code,
            Document.session_label == session_label,
            Document.doc_type == DocumentType.STUDY_MATERIAL,
        )
        .order_by(DocumentChunk.embedding.cosine_distance(query_vector))
        .limit(k)
    )
    return list(db.scalars(stmt))


def _build_user_prompt(topic: str, question_type: QuestionType, count: int, chunks: list[DocumentChunk]) -> str:
    excerpts = "\n\n---\n\n".join(chunk.content for chunk in chunks)
    schema_hint = MCQ_SCHEMA_HINT if question_type == QuestionType.MCQ else THEORY_SCHEMA_HINT
    return (
        f"Study material excerpts on '{topic}':\n\n{excerpts}\n\n"
        f"Draft exactly {count} {question_type.value.upper()} question(s) on '{topic}' "
        f"grounded only in the excerpts above. Respond as a JSON array matching: {schema_hint}"
    )


def _parse_llm_response(raw: str) -> list[dict]:
    cleaned = re.sub(r"^```(json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip()
    data = json.loads(cleaned)
    if not isinstance(data, list):
        raise ValueError("expected a JSON array of question drafts")
    return data


def generate_draft_questions(
    db: Session,
    course_code: str,
    session_label: str,
    topic: str,
    question_type: QuestionType,
    count: int,
    llm: LLMProvider,
    embedding_provider: EmbeddingProvider,
) -> list[QuestionItem]:
    chunks = retrieve_relevant_chunks(db, course_code, session_label, topic, embedding_provider)
    if not chunks:
        raise ValueError(
            f"No study material indexed for {course_code} / {session_label} on topic '{topic}'. "
            "Upload and ingest study material for this session before generating from it."
        )

    user_prompt = _build_user_prompt(topic, question_type, count, chunks)
    raw = llm.complete(SYSTEM_PROMPT, user_prompt)
    drafts = _parse_llm_response(raw)

    source_document_id = chunks[0].document_id
    items: list[QuestionItem] = []
    for draft in drafts:
        item = QuestionItem(
            course_code=course_code,
            session_label=session_label,
            topic=draft.get("topic", topic),
            question_type=question_type,
            source=QuestionSource.AI_GENERATED,
            source_document_id=source_document_id,
            stem=draft["stem"],
            options=draft.get("options"),
            correct_index=draft.get("correct_index"),
            model_answer=draft.get("model_answer"),
            rubric=draft.get("rubric"),
            status=QuestionStatus.DRAFT,
        )
        db.add(item)
        items.append(item)
    return items
