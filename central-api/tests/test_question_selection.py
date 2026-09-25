import random
import uuid

import pytest

from app.models.question import QuestionItem, QuestionSource, QuestionStatus, QuestionType
from app.services.question_selection import (
    InsufficientQuestionPoolError,
    select_candidate_instance,
    select_pool,
)


def make_mcq(source: QuestionSource, times_used: int = 0, correct_index: int = 2) -> QuestionItem:
    return QuestionItem(
        id=uuid.uuid4(),
        course_code="CSC301",
        session_label="2024/2025",
        topic="OSI Model",
        question_type=QuestionType.MCQ,
        source=source,
        stem="Which layer handles routing?",
        options=["Physical", "Data Link", "Network", "Transport"],
        correct_index=correct_index,
        status=QuestionStatus.APPROVED,
        times_used=times_used,
    )


def make_theory(source: QuestionSource) -> QuestionItem:
    return QuestionItem(
        id=uuid.uuid4(),
        course_code="CSC301",
        session_label="2024/2025",
        topic="Subnetting",
        question_type=QuestionType.THEORY,
        source=source,
        stem="Explain subnetting.",
        model_answer="...",
        rubric=[{"criterion": "mentions broadcast domains", "points": 5}],
        status=QuestionStatus.APPROVED,
    )


class TestSelectPool:
    def test_mixes_sources_by_ratio_when_both_plentiful(self):
        past = [make_mcq(QuestionSource.PAST_QUESTION) for _ in range(20)]
        ai = [make_mcq(QuestionSource.AI_GENERATED) for _ in range(20)]

        pool = select_pool(past + ai, target_size=10, past_question_ratio=0.7, rng=random.Random(42))

        assert len(pool) == 10
        assert sum(1 for q in pool if q.source == QuestionSource.PAST_QUESTION) == 7
        assert sum(1 for q in pool if q.source == QuestionSource.AI_GENERATED) == 3

    def test_backfills_from_ai_when_past_questions_run_short(self):
        # Only 3 past questions exist for this topic — the exact scenario the
        # user described: instructor wants study-material-derived questions
        # to cover the rest instead of the build failing.
        past = [make_mcq(QuestionSource.PAST_QUESTION) for _ in range(3)]
        ai = [make_mcq(QuestionSource.AI_GENERATED) for _ in range(20)]

        pool = select_pool(past + ai, target_size=10, past_question_ratio=0.7, rng=random.Random(1))

        assert len(pool) == 10
        assert sum(1 for q in pool if q.source == QuestionSource.PAST_QUESTION) == 3
        assert sum(1 for q in pool if q.source == QuestionSource.AI_GENERATED) == 7

    def test_backfills_from_past_when_ai_generated_run_short(self):
        past = [make_mcq(QuestionSource.PAST_QUESTION) for _ in range(20)]
        ai = [make_mcq(QuestionSource.AI_GENERATED) for _ in range(1)]

        pool = select_pool(past + ai, target_size=10, past_question_ratio=0.7, rng=random.Random(7))

        assert len(pool) == 10
        assert sum(1 for q in pool if q.source == QuestionSource.AI_GENERATED) == 1
        assert sum(1 for q in pool if q.source == QuestionSource.PAST_QUESTION) == 9

    def test_raises_when_combined_pool_too_small(self):
        past = [make_mcq(QuestionSource.PAST_QUESTION) for _ in range(2)]
        ai = [make_mcq(QuestionSource.AI_GENERATED) for _ in range(2)]

        with pytest.raises(InsufficientQuestionPoolError):
            select_pool(past + ai, target_size=10, past_question_ratio=0.7, rng=random.Random(0))

    def test_favors_less_recently_used_past_questions(self):
        fresh = [make_mcq(QuestionSource.PAST_QUESTION, times_used=0) for _ in range(5)]
        overused = [make_mcq(QuestionSource.PAST_QUESTION, times_used=50) for _ in range(5)]
        ai = [make_mcq(QuestionSource.AI_GENERATED) for _ in range(5)]

        # Run many trials: fresh past questions should be selected far more
        # often than heavily-reused ones.
        fresh_ids = {q.id for q in fresh}
        overused_ids = {q.id for q in overused}
        fresh_hits = 0
        overused_hits = 0
        for trial in range(200):
            pool = select_pool(
                fresh + overused + ai, target_size=6, past_question_ratio=0.5, rng=random.Random(trial)
            )
            fresh_hits += sum(1 for q in pool if q.id in fresh_ids)
            overused_hits += sum(1 for q in pool if q.id in overused_ids)

        assert fresh_hits > overused_hits * 3


class TestSelectCandidateInstance:
    def test_deterministic_for_same_seed(self):
        pool = [make_mcq(QuestionSource.PAST_QUESTION) for _ in range(10)]
        first = select_candidate_instance(pool, seed="candidate-42", count=5)
        second = select_candidate_instance(pool, seed="candidate-42", count=5)

        assert [i.question_item_id for i in first] == [i.question_item_id for i in second]
        assert [i.options for i in first] == [i.options for i in second]

    def test_different_seeds_usually_differ(self):
        pool = [make_mcq(QuestionSource.PAST_QUESTION, correct_index=i % 4) for i in range(20)]
        a = select_candidate_instance(pool, seed="candidate-1", count=8)
        b = select_candidate_instance(pool, seed="candidate-2", count=8)

        assert [i.question_item_id for i in a] != [i.question_item_id for i in b]

    def test_correct_answer_survives_option_shuffle(self):
        # This is the correctness-critical path: whatever order the options
        # land in after shuffling, correct_index must still point at the
        # text that was originally marked correct.
        item = make_mcq(QuestionSource.PAST_QUESTION, correct_index=2)
        assert item.options[2] == "Network"
        pool = [item]

        for seed in range(50):
            [instance] = select_candidate_instance(pool, seed=f"seed-{seed}", count=1)
            assert instance.options[instance.correct_index] == "Network"
            assert sorted(instance.options) == sorted(item.options)

    def test_theory_question_keeps_rubric_and_model_answer(self):
        item = make_theory(QuestionSource.AI_GENERATED)
        [instance] = select_candidate_instance([item], seed="s", count=1)

        assert instance.options is None
        assert instance.correct_index is None
        assert instance.model_answer == item.model_answer
        assert instance.rubric == item.rubric

    def test_raises_when_pool_smaller_than_requested_count(self):
        pool = [make_mcq(QuestionSource.PAST_QUESTION) for _ in range(3)]
        with pytest.raises(InsufficientQuestionPoolError):
            select_candidate_instance(pool, seed="s", count=5)
