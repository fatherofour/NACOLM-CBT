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


def _serialize_pool(exam: Exam, pool: list[QuestionItem]) -> bytes:
    payload = {
        "exam_id": str(exam.id),
        "title": exam.title,
        "duration_minutes": exam.duration_minutes,
        "pass_mark": exam.pass_mark,
        "questions_per_candidate": exam.questions_per_candidate,
        "publish_mode": exam.publish_mode.value,
        "pool": [
            {
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
            for item in pool
        ],
    }
    return json.dumps(payload).encode("utf-8")


def build_package(exam: Exam, pool: list[QuestionItem]) -> tuple[crypto.Envelope, bytes]:
    """Returns (envelope, key). The caller is responsible for writing the
    envelope to storage/sync channel and for handing the key to whatever
    release mechanism the venue uses — the two must NOT be stored together.
    """
    key = crypto.generate_key()
    plaintext = _serialize_pool(exam, pool)
    envelope = crypto.encrypt(plaintext, key, aad=str(exam.id).encode("utf-8"))
    return envelope, key


def write_package(envelope: crypto.Envelope, path: Path) -> str:
    """Writes the envelope to disk and returns its sha256 checksum, recorded
    on ExamPackage so a corrupted sync can be detected before exam day."""
    raw = envelope.to_json().encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    return hashlib.sha256(raw).hexdigest()
