import uuid
from datetime import datetime
from pathlib import Path

from pydantic import BaseModel, computed_field

from app.models.document import DocumentType


class DocumentOut(BaseModel):
    id: uuid.UUID
    course_code: str
    session_label: str
    title: str
    doc_type: DocumentType
    storage_path: str
    uploaded_at: datetime

    model_config = {"from_attributes": True}

    @computed_field
    @property
    def filename(self) -> str:
        # The instructor UI only needs the filename, not the server's
        # absolute storage path.
        return Path(self.storage_path).name
