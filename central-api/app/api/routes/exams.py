import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.config import get_settings
from app.models.exam import Exam, ExamPackage
from app.schemas.exam import ExamCreate, ExamOut, PackageBuildOut
from app.services.packaging import build_package, write_package
from app.services.question_selection import (
    InsufficientQuestionPoolError,
    build_exam_pool_for_exam,
    select_candidate_instance,
)

router = APIRouter(prefix="/exams", tags=["exams"])


@router.post("", response_model=ExamOut)
def create_exam(payload: ExamCreate, db: Session = Depends(get_db)) -> Exam:
    exam = Exam(**payload.model_dump())
    db.add(exam)
    db.commit()
    db.refresh(exam)
    return exam


@router.get("", response_model=list[ExamOut])
def list_exams(course_code: str | None = None, session_label: str | None = None, db: Session = Depends(get_db)):
    stmt = select(Exam)
    if course_code:
        stmt = stmt.where(Exam.course_code == course_code)
    if session_label:
        stmt = stmt.where(Exam.session_label == session_label)
    return list(db.scalars(stmt.order_by(Exam.created_at.desc())))


@router.get("/{exam_id}", response_model=ExamOut)
def get_exam(exam_id: uuid.UUID, db: Session = Depends(get_db)) -> Exam:
    exam = db.get(Exam, exam_id)
    if exam is None:
        raise HTTPException(status_code=404, detail="exam not found")
    return exam


@router.post("/{exam_id}/build-package", response_model=PackageBuildOut)
def build_exam_package(exam_id: uuid.UUID, db: Session = Depends(get_db)) -> PackageBuildOut:
    exam = db.get(Exam, exam_id)
    if exam is None:
        raise HTTPException(status_code=404, detail="exam not found")

    settings = get_settings()
    try:
        pool = build_exam_pool_for_exam(db, exam, settings.exam_pool_multiplier)
    except InsufficientQuestionPoolError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    envelope, key = build_package(exam, pool)
    storage_path = Path(settings.package_storage_dir) / f"{exam.id}.cbtpkg"
    checksum = write_package(envelope, storage_path)

    package = ExamPackage(exam_id=exam.id, storage_path=str(storage_path), checksum_sha256=checksum)
    db.add(package)
    db.commit()
    db.refresh(package)

    # NOTE: returning the key in this response is a dev/demo convenience.
    # In production the key must go through the separate release mechanism
    # (scheduled online check-in or invigilator-entered sealed code), never
    # travel alongside the package, and never appear in an API response log.
    return PackageBuildOut(
        package_id=package.id,
        storage_path=package.storage_path,
        checksum_sha256=package.checksum_sha256,
        release_key_hex=key.hex(),
        pool_size=len(pool),
    )


@router.get("/{exam_id}/preview")
def preview_candidate_paper(exam_id: uuid.UUID, seed: str = "preview", db: Session = Depends(get_db)):
    """Lets an instructor sanity-check what a randomized candidate paper
    looks like before approving the exam for delivery."""
    exam = db.get(Exam, exam_id)
    if exam is None:
        raise HTTPException(status_code=404, detail="exam not found")

    settings = get_settings()
    try:
        pool = build_exam_pool_for_exam(db, exam, settings.exam_pool_multiplier)
        db.rollback()  # preview must not consume real usage stats or persist pool rows
        instances = select_candidate_instance(pool, seed=seed, count=exam.questions_per_candidate)
    except InsufficientQuestionPoolError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return [
        {
            "type": inst.question_type.value,
            "topic": inst.topic,
            "source": inst.source.value,
            "stem": inst.stem,
            "options": inst.options,
        }
        for inst in instances
    ]
