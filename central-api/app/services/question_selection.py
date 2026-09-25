"""Two-stage question selection.

Stage 1 (this module, run centrally when an exam package is built):
    From the *approved* question bank, build an offline "pool" that is
    larger than what any one candidate needs. The pool mixes vetted past
    questions with AI-drafted-from-study-material questions according to
    the exam's `past_question_ratio` — e.g. an instructor who only has a
    thin past-question archive for a course can dial that ratio down and
    let the study-material generator fill the rest, without having to
    treat that as a special case anywhere else in the system.

Stage 2 (mirrored in Go, local-exam-server/internal/randomize, and run
    offline at the venue): each candidate draws their own paper from that
    pool with a seeded shuffle, so two candidates sitting next to each
    other get different question order, a different subset, and different
    MCQ option order, without needing any network connectivity.

Both stages are exposed here as pure functions over plain lists so they're
cheap to unit test without a database.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.exam import Exam, ExamPoolItem
from app.models.question import QuestionItem, QuestionSource, QuestionStatus, QuestionType


class InsufficientQuestionPoolError(Exception):
    def __init__(self, needed: int, available: int, course_code: str, topic_filter: list[str] | None):
        self.needed = needed
        self.available = available
        super().__init__(
            f"Need {needed} approved questions for {course_code} "
            f"(topics={topic_filter or 'any'}) but only {available} are available. "
            "Approve more past questions, or generate more draft questions from "
            "study material, before building this exam's package."
        )


@dataclass(frozen=True)
class QuestionInstance:
    """A single question exactly as one candidate will see it, after
    per-candidate shuffling of order and (for MCQ) option order."""

    question_item_id: object
    question_type: QuestionType
    stem: str
    options: list[str] | None
    correct_index: int | None
    model_answer: str | None
    rubric: list | None
    topic: str
    source: QuestionSource


# ---------------------------------------------------------------------------
# Stage 1: build the offline pool
# ---------------------------------------------------------------------------


def _recency_weight(item: QuestionItem) -> float:
    """Favor past questions that haven't been reused recently, so the same
    handful of old questions doesn't reappear every session."""
    return 1.0 / (1 + item.times_used)


def _weighted_sample_without_replacement(
    pool: list[QuestionItem], k: int, rng: random.Random, weight_fn
) -> list[QuestionItem]:
    k = min(k, len(pool))
    remaining = list(pool)
    selected: list[QuestionItem] = []
    for _ in range(k):
        weights = [weight_fn(item) for item in remaining]
        chosen = rng.choices(remaining, weights=weights, k=1)[0]
        selected.append(chosen)
        remaining.remove(chosen)
    return selected


def select_pool(
    candidates: list[QuestionItem],
    target_size: int,
    past_question_ratio: float,
    rng: random.Random,
) -> list[QuestionItem]:
    """Pure selection logic: given already-approved candidate questions,
    pick `target_size` of them mixing past-question and AI-generated
    sources by `past_question_ratio`, backfilling from whichever bucket
    has room if the other one falls short."""

    past_qs = [c for c in candidates if c.source == QuestionSource.PAST_QUESTION]
    ai_qs = [c for c in candidates if c.source == QuestionSource.AI_GENERATED]

    if len(past_qs) + len(ai_qs) < target_size:
        raise InsufficientQuestionPoolError(
            needed=target_size,
            available=len(past_qs) + len(ai_qs),
            course_code=candidates[0].course_code if candidates else "unknown",
            topic_filter=None,
        )

    desired_past = round(target_size * past_question_ratio)
    desired_ai = target_size - desired_past

    past_selected = _weighted_sample_without_replacement(past_qs, desired_past, rng, _recency_weight)
    ai_selected = _weighted_sample_without_replacement(ai_qs, desired_ai, rng, lambda _: 1.0)

    past_short = desired_past - len(past_selected)
    ai_short = desired_ai - len(ai_selected)
    # At most one of these can be positive: if both buckets fell short of
    # their targets, their combined total would be below target_size,
    # which the guard above already ruled out.
    if past_short > 0:
        # Not enough past questions for this course/topic — this is exactly
        # the "study material inclusive" fallback: let AI-drafted questions
        # cover the gap instead of failing the build.
        ai_remaining = [q for q in ai_qs if q not in ai_selected]
        ai_selected += _weighted_sample_without_replacement(ai_remaining, past_short, rng, lambda _: 1.0)
    elif ai_short > 0:
        past_remaining = [q for q in past_qs if q not in past_selected]
        past_selected += _weighted_sample_without_replacement(
            past_remaining, ai_short, rng, _recency_weight
        )

    pool = past_selected + ai_selected
    rng.shuffle(pool)
    return pool


def build_exam_pool_for_exam(db: Session, exam: Exam, pool_multiplier: float) -> list[QuestionItem]:
    stmt = select(QuestionItem).where(
        QuestionItem.course_code == exam.course_code,
        QuestionItem.status == QuestionStatus.APPROVED,
    )
    candidates = list(db.scalars(stmt))
    if exam.topics:
        candidates = [c for c in candidates if c.topic in exam.topics]

    target_size = max(exam.questions_per_candidate, round(exam.questions_per_candidate * pool_multiplier))
    rng = random.Random(f"{exam.id}:pool")
    pool = select_pool(candidates, target_size, exam.past_question_ratio, rng)

    now = datetime.now(timezone.utc)
    for item in pool:
        item.times_used += 1
        item.last_used_at = now
        db.add(ExamPoolItem(exam_id=exam.id, question_item_id=item.id))

    return pool


# ---------------------------------------------------------------------------
# Stage 2: per-candidate draw (reference implementation; the offline local
# exam server runs the real thing in Go — see local-exam-server/internal/randomize)
# ---------------------------------------------------------------------------


def select_candidate_instance(
    pool: list[QuestionItem], seed: str | int, count: int
) -> list[QuestionInstance]:
    if len(pool) < count:
        raise InsufficientQuestionPoolError(
            needed=count,
            available=len(pool),
            course_code=pool[0].course_code if pool else "unknown",
            topic_filter=None,
        )

    rng = random.Random(seed)
    chosen = rng.sample(pool, k=count)
    rng.shuffle(chosen)

    instances: list[QuestionInstance] = []
    for item in chosen:
        if item.question_type == QuestionType.MCQ:
            indexed_options = list(enumerate(item.options or []))
            rng.shuffle(indexed_options)
            new_options = [text for _orig_idx, text in indexed_options]
            new_correct_index = next(
                new_idx
                for new_idx, (orig_idx, _text) in enumerate(indexed_options)
                if orig_idx == item.correct_index
            )
            instances.append(
                QuestionInstance(
                    question_item_id=item.id,
                    question_type=item.question_type,
                    stem=item.stem,
                    options=new_options,
                    correct_index=new_correct_index,
                    model_answer=None,
                    rubric=None,
                    topic=item.topic,
                    source=item.source,
                )
            )
        else:
            instances.append(
                QuestionInstance(
                    question_item_id=item.id,
                    question_type=item.question_type,
                    stem=item.stem,
                    options=None,
                    correct_index=None,
                    model_answer=item.model_answer,
                    rubric=item.rubric,
                    topic=item.topic,
                    source=item.source,
                )
            )
    return instances
