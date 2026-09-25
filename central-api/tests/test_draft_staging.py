import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.question import QuestionItem, QuestionSource, QuestionStatus, QuestionType
from app.services import draft_staging
from app.services.draft_staging import DraftSource, stage_draft_set


@pytest.fixture
def db_session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    QuestionItem.metadata.create_all(bind=engine, tables=[QuestionItem.__table__])
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


def make_past_question(course_code="CSC301", session_label="2024/2025", topic="OSI Model"):
    return QuestionItem(
        id=uuid.uuid4(),
        course_code=course_code,
        session_label=session_label,
        topic=topic,
        question_type=QuestionType.MCQ,
        source=QuestionSource.PAST_QUESTION,
        stem="Which layer handles routing?",
        options=["A", "B", "C", "D"],
        correct_index=0,
        status=QuestionStatus.APPROVED,
    )


def test_past_question_source_never_calls_llm(db_session):
    db_session.add(make_past_question())
    db_session.add(make_past_question())
    db_session.commit()

    items = stage_draft_set(
        db_session,
        course_code="CSC301",
        session_label="2024/2025",
        topic="OSI Model",
        question_type=QuestionType.MCQ,
        count=5,
        source=DraftSource.PAST_QUESTION,
        llm=None,  # would blow up if the code path ever tried to call it
        embedding_provider=None,
    )

    assert len(items) == 2
    assert all(item.source == QuestionSource.PAST_QUESTION for item in items)


def test_past_question_source_only_returns_matching_topic_and_course(db_session):
    db_session.add(make_past_question(topic="OSI Model"))
    db_session.add(make_past_question(topic="Subnetting"))
    db_session.add(make_past_question(course_code="CSC999"))
    db_session.commit()

    items = stage_draft_set(
        db_session,
        course_code="CSC301",
        session_label="2024/2025",
        topic="OSI Model",
        question_type=QuestionType.MCQ,
        count=5,
        source=DraftSource.PAST_QUESTION,
        llm=None,
        embedding_provider=None,
    )

    assert len(items) == 1
    assert items[0].topic == "OSI Model"


def test_study_material_source_delegates_to_generation_pipeline(db_session, monkeypatch):
    calls = []

    def fake_generate(db, course_code, session_label, topic, question_type, count, llm, embedding_provider):
        calls.append(count)
        return [f"fake-item-{i}" for i in range(count)]

    monkeypatch.setattr(draft_staging, "generate_draft_questions", fake_generate)

    items = stage_draft_set(
        db_session,
        course_code="CSC301",
        session_label="2024/2025",
        topic="Subnetting",
        question_type=QuestionType.THEORY,
        count=4,
        source=DraftSource.STUDY_MATERIAL,
        llm="fake-llm",
        embedding_provider="fake-embeddings",
    )

    assert calls == [4]
    assert items == [f"fake-item-{i}" for i in range(4)]


def test_both_source_blends_bank_items_with_ai_backfill(db_session, monkeypatch):
    # Two past questions already exist; requesting 5 total should reuse both
    # and generate only the remaining 3 via AI — this is the literal
    # "blends bank and AI" behavior from the source-picker.
    db_session.add(make_past_question())
    db_session.add(make_past_question())
    db_session.commit()

    calls = []

    def fake_generate(db, course_code, session_label, topic, question_type, count, llm, embedding_provider):
        calls.append(count)
        return [f"ai-item-{i}" for i in range(count)]

    monkeypatch.setattr(draft_staging, "generate_draft_questions", fake_generate)

    items = stage_draft_set(
        db_session,
        course_code="CSC301",
        session_label="2024/2025",
        topic="OSI Model",
        question_type=QuestionType.MCQ,
        count=5,
        source=DraftSource.BOTH,
        llm="fake-llm",
        embedding_provider="fake-embeddings",
    )

    assert calls == [3]
    past_count = sum(1 for i in items if isinstance(i, QuestionItem))
    ai_count = sum(1 for i in items if isinstance(i, str))
    assert past_count == 2
    assert ai_count == 3


def test_both_source_skips_generation_when_bank_already_covers_the_count(db_session, monkeypatch):
    for _ in range(5):
        db_session.add(make_past_question())
    db_session.commit()

    called = False

    def fake_generate(*args, **kwargs):
        nonlocal called
        called = True
        return []

    monkeypatch.setattr(draft_staging, "generate_draft_questions", fake_generate)

    items = stage_draft_set(
        db_session,
        course_code="CSC301",
        session_label="2024/2025",
        topic="OSI Model",
        question_type=QuestionType.MCQ,
        count=2,
        source=DraftSource.BOTH,
        llm="fake-llm",
        embedding_provider="fake-embeddings",
    )

    assert called is False
    assert len(items) == 2
