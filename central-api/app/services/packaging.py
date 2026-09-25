"""Builds the encrypted .cbtpkg file that gets synced to a venue's local
exam server ahead of an exam. See app.services.crypto for the wire format
and local-exam-server/internal/exam/package.go for the reader.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from app.models.exam import Exam
from app.models.question import QuestionItem
from app.services import crypto


def serialize_payload(
    exam_id: str,
    title: str,
    duration_minutes: int,
    pass_mark: float,
    questions_per_candidate: int,
    publish_mode: str,
    pool: list[dict],
) -> bytes:
    """The plaintext package payload, built from plain dicts rather than ORM
    objects — this is what both the direct exam-pool path (build_package,
    below) and the stateless instructor-api bridge (see
    app.api.routes.package_bridge) serialize. No candidate roster here:
    local-exam-server verifies check-in against a roster CSV loaded straight
    from disk at the venue, not from anything bundled into this package.
    """
    payload = {
        "exam_id": exam_id,
        "title": title,
        "duration_minutes": duration_minutes,
        "pass_mark": pass_mark,
        "questions_per_candidate": questions_per_candidate,
        "publish_mode": publish_mode,
        "pool": pool,
    }
    return json.dumps(payload).encode("utf-8")


def _pool_item_dict(item: QuestionItem) -> dict:
    return {
        "id": str(item.id),
        "type": item.question_type.value,
        "topic": item.topic,
        "source": item.source.value,
        "stem": item.stem,
        "options": item.options,
        "correct_index": item.correct_index,
        "model_answer": item.model_answer,
        "rubric": item.rubric,
    }


def build_package(exam: Exam, pool: list[QuestionItem]) -> tuple[crypto.Envelope, bytes]:
    """Returns (envelope, key). The caller is responsible for writing the
    envelope to storage/sync channel and for handing the key to whatever
    release mechanism the venue uses — the two must NOT be stored together.
    """
    key = crypto.generate_key()
    plaintext = serialize_payload(
        exam_id=str(exam.id),
        title=exam.title,
        duration_minutes=exam.duration_minutes,
        pass_mark=exam.pass_mark,
        questions_per_candidate=exam.questions_per_candidate,
        publish_mode=exam.publish_mode.value,
        pool=[_pool_item_dict(item) for item in pool],
    )
    envelope = crypto.encrypt(plaintext, key, aad=str(exam.id).encode("utf-8"))
    return envelope, key


def build_package_from_payload(exam_id: str, plaintext: bytes) -> tuple[crypto.Envelope, bytes]:
    """Same encryption step as build_package, for callers (the instructor-api
    bridge) that already have a fully-serialized payload rather than
    central-api's own ORM objects."""
    key = crypto.generate_key()
    envelope = crypto.encrypt(plaintext, key, aad=exam_id.encode("utf-8"))
    return envelope, key


def write_package(envelope: crypto.Envelope, path: Path) -> str:
    """Writes the envelope to disk and returns its sha256 checksum, recorded
    on ExamPackage so a corrupted sync can be detected before exam day."""
    raw = envelope.to_json().encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    return hashlib.sha256(raw).hexdigest()
