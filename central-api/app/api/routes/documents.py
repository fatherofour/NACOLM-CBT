import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.config import get_settings
from app.models.document import Document, DocumentChunk, DocumentType
from app.models.question import QuestionType
from app.schemas.document import DocumentOut
from app.services.document_ingestion import ingest_document
from app.services.embeddings import get_embedding_provider
from app.services.llm import get_llm_provider
from app.services.question_generation import generate_draft_questions

router = APIRouter(prefix="/documents", tags=["documents"])


@router.post("", response_model=DocumentOut)
async def upload_document(
    course_code: str = Form(...),
    session_label: str = Form(...),
    doc_type: DocumentType = Form(...),
    title: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> Document:
    """Uploads a past-question paper or a study-material file into that
    course/session's folder on the server. This is the "folder for past
    questions, folder for study material" the instructor UI's document
    library is built on."""
    settings = get_settings()
    dest_dir = Path(settings.document_storage_root) / course_code / session_label / doc_type.value
    dest_dir.mkdir(parents=True, exist_ok=True)

    # Prefix with a uuid so re-uploading a same-named file never overwrites
    # an existing one, and so a crafted filename can't escape the folder.
    safe_name = f"{uuid.uuid4()}_{Path(file.filename or 'upload').name}"
    dest_path = dest_dir / safe_name
    with dest_path.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    document = Document(
        course_code=course_code,
        session_label=session_label,
        doc_type=doc_type,
        title=title,
        storage_path=str(dest_path),
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


@router.get("", response_model=list[DocumentOut])
def list_documents(
    course_code: str,
    session_label: str,
    doc_type: DocumentType | None = None,
    db: Session = Depends(get_db),
):
    stmt = select(Document).where(
        Document.course_code == course_code, Document.session_label == session_label
    )
    if doc_type is not None:
        stmt = stmt.where(Document.doc_type == doc_type)
    return list(db.scalars(stmt.order_by(Document.uploaded_at.desc())))


@router.delete("/{document_id}")
def delete_document(document_id: uuid.UUID, db: Session = Depends(get_db)):
    """Deleting from the UI deletes from the server: removes the file from
    disk as well as the database row (and any indexed chunks), not just the
    listing entry."""
    document = db.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="document not found")

    path = Path(document.storage_path)
    if path.exists():
        path.unlink()

    db.execute(delete(DocumentChunk).where(DocumentChunk.document_id == document_id))
    db.delete(document)
    db.commit()
    return {"deleted": True, "id": str(document_id)}


@router.post("/{document_id}/ingest")
def ingest(document_id: uuid.UUID, db: Session = Depends(get_db)):
    document = db.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="document not found")
    chunks = ingest_document(db, document, get_embedding_provider())
    db.commit()
    return {"document_id": str(document_id), "chunks_indexed": len(chunks)}


@router.post("/generate-questions")
def generate_from_study_material(
    course_code: str,
    session_label: str,
    topic: str,
    question_type: QuestionType,
    count: int = 5,
    db: Session = Depends(get_db),
):
    """Drafts new questions from previously ingested study material. Used
    when the past-question archive for a topic is thin — see
    Exam.past_question_ratio for how these mix into an exam's pool."""
    try:
        items = generate_draft_questions(
            db,
            course_code=course_code,
            session_label=session_label,
            topic=topic,
            question_type=question_type,
            count=count,
            llm=get_llm_provider(),
            embedding_provider=get_embedding_provider(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    db.commit()
    return {"drafted": len(items), "ids": [str(i.id) for i in items]}
