import uuid

from pydantic import BaseModel

from app.models.exam import PublishMode


class ExamCreate(BaseModel):
    title: str
    course_code: str
    session_label: str
    duration_minutes: int
    pass_mark: float
    questions_per_candidate: int
    past_question_ratio: float = 0.7
    publish_mode: PublishMode = PublishMode.INSTRUCTOR_CONTROLLED
    topics: list[str] | None = None


class ExamOut(BaseModel):
    id: uuid.UUID
    title: str
    course_code: str
    session_label: str
    questions_per_candidate: int
    past_question_ratio: float
    publish_mode: PublishMode

    model_config = {"from_attributes": True}


class PackageBuildOut(BaseModel):
    package_id: uuid.UUID
    storage_path: str
    checksum_sha256: str
    release_key_hex: str
    pool_size: int
