from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.question import QuestionType
from app.services.draft_staging import DraftSource, stage_draft_set
from app.services.embeddings import get_embedding_provider
from app.services.llm import get_llm_provider

router = APIRouter(prefix="/question-drafts", tags=["question-drafts"])


class StageDraftsRequest(BaseModel):
    course_code: str
    session_label: str
    topic: str
    question_type: QuestionType
    count: int = 10
    source: DraftSource


@router.post("/stage")
def stage_drafts(payload: StageDraftsRequest, db: Session = Depends(get_db)):
    """The instructor's "generate from past questions / study material /
    both" choice when setting up a session's questions."""
    llm_provider = None if payload.source == DraftSource.PAST_QUESTION else get_llm_provider()
    try:
        items = stage_draft_set(
            db,
            course_code=payload.course_code,
            session_label=payload.session_label,
            topic=payload.topic,
            question_type=payload.question_type,
            count=payload.count,
            source=payload.source,
            llm=llm_provider,
            embedding_provider=get_embedding_provider(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    db.commit()
    return {
        "count": len(items),
        "items": [
            {
                "id": str(item.id),
                "source": item.source.value,
                "status": item.status.value,
                "topic": item.topic,
                "stem": item.stem,
            }
            for item in items
        ],
    }
