import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.question import QuestionItem, QuestionStatus
from app.schemas.question import QuestionItemOut

router = APIRouter(prefix="/questions", tags=["questions"])


@router.get("/drafts", response_model=list[QuestionItemOut])
def list_drafts(course_code: str, session_label: str | None = None, db: Session = Depends(get_db)):
    stmt = select(QuestionItem).where(
        QuestionItem.course_code == course_code, QuestionItem.status == QuestionStatus.DRAFT
    )
    if session_label:
        stmt = stmt.where(QuestionItem.session_label == session_label)
    return list(db.scalars(stmt.order_by(QuestionItem.created_at.desc())))


@router.post("/{question_id}/approve")
def approve_question(question_id: uuid.UUID, db: Session = Depends(get_db)):
    item = db.get(QuestionItem, question_id)
    if item is None:
        raise HTTPException(status_code=404, detail="question not found")
    item.status = QuestionStatus.APPROVED
    db.commit()
    return {"id": str(item.id), "status": item.status.value}


@router.post("/{question_id}/reject")
def reject_question(question_id: uuid.UUID, db: Session = Depends(get_db)):
    item = db.get(QuestionItem, question_id)
    if item is None:
        raise HTTPException(status_code=404, detail="question not found")
    item.status = QuestionStatus.REJECTED
    db.commit()
    return {"id": str(item.id), "status": item.status.value}
