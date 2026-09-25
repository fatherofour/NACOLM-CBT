"""Turns an uploaded study-material file into embedded, searchable chunks."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy.orm import Session

from app.models.document import Document, DocumentChunk
from app.services.embeddings import EmbeddingProvider

CHUNK_SIZE_CHARS = 1500
CHUNK_OVERLAP_CHARS = 200


def extract_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        from pypdf import PdfReader

        reader = PdfReader(str(path))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    if suffix == ".docx":
        import docx

        doc = docx.Document(str(path))
        return "\n".join(p.text for p in doc.paragraphs)
    return path.read_text(encoding="utf-8", errors="ignore")


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE_CHARS, overlap: int = CHUNK_OVERLAP_CHARS) -> list[str]:
    text = text.strip()
    if not text:
        return []
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        if end >= len(text):
            break
        start = end - overlap
    return chunks


def ingest_document(db: Session, document: Document, embedding_provider: EmbeddingProvider) -> list[DocumentChunk]:
    text = extract_text(Path(document.storage_path))
    pieces = chunk_text(text)
    if not pieces:
        return []

    vectors = embedding_provider.embed(pieces)
    chunks = [
        DocumentChunk(document_id=document.id, chunk_index=i, content=piece, embedding=vector)
        for i, (piece, vector) in enumerate(zip(pieces, vectors))
    ]
    db.add_all(chunks)
    return chunks
