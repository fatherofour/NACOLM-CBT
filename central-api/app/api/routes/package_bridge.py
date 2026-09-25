"""Stateless packaging bridge for instructor-api's "Package for exam centre"
action. instructor-api has already finalized the question set (a frozen
PaperVersion) — this endpoint's only job is the one thing that must not be
reimplemented in a second language: AES-256-GCM encryption in the exact
wire format local-exam-server's Go code reads. Nothing here is persisted in
central-api's own database.
"""

from pathlib import Path

from fastapi import APIRouter

from app.core.config import get_settings
from app.schemas.package_bridge import BuildFromPaperRequest, BuildFromPaperResponse
from app.services.packaging import build_package_from_payload, serialize_payload, write_package

router = APIRouter(prefix="/package-bridge", tags=["package-bridge"])


@router.post("/build", response_model=BuildFromPaperResponse)
def build_from_paper(payload: BuildFromPaperRequest) -> BuildFromPaperResponse:
    settings = get_settings()

    plaintext = serialize_payload(
        exam_id=payload.exam_id,
        title=payload.title,
        duration_minutes=payload.duration_minutes,
        pass_mark=payload.pass_mark,
        questions_per_candidate=payload.questions_per_candidate,
        publish_mode=payload.publish_mode.value,
        pool=[item.model_dump() for item in payload.pool],
    )

    envelope, key = build_package_from_payload(payload.exam_id, plaintext)
    storage_path = Path(settings.package_storage_dir) / f"{payload.exam_id}.cbtpkg"
    checksum = write_package(envelope, storage_path)

    # Same dev/demo caveat as the direct build-package route: in production
    # this key must go through the venue's actual release mechanism, never
    # sit in a response log.
    return BuildFromPaperResponse(
        storage_path=str(storage_path),
        checksum_sha256=checksum,
        release_key_hex=key.hex(),
        pool_size=len(payload.pool),
    )
