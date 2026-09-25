import io

import pytest

from app.core.config import get_settings


@pytest.fixture(autouse=True)
def storage_root(tmp_path, monkeypatch):
    monkeypatch.setenv("CBT_DOCUMENT_STORAGE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    yield tmp_path
    get_settings.cache_clear()


def test_upload_list_and_delete_document(client, storage_root):
    upload = client.post(
        "/documents",
        data={
            "course_code": "CSC301",
            "session_label": "2024/2025",
            "doc_type": "past_question",
            "title": "2023 CAT1 Past Questions",
        },
        files={"file": ("cat1.txt", io.BytesIO(b"1. What is a subnet?"), "text/plain")},
    )
    assert upload.status_code == 200, upload.text
    body = upload.json()
    assert body["course_code"] == "CSC301"
    assert body["filename"].endswith("cat1.txt")

    # The file actually landed on disk under course/session/doc_type.
    saved_files = list((storage_root / "CSC301" / "2024/2025" / "past_question").glob("*cat1.txt"))
    assert len(saved_files) == 1
    assert saved_files[0].read_bytes() == b"1. What is a subnet?"

    listing = client.get("/documents", params={"course_code": "CSC301", "session_label": "2024/2025"})
    assert listing.status_code == 200
    assert len(listing.json()) == 1

    delete_resp = client.delete(f"/documents/{body['id']}")
    assert delete_resp.status_code == 200

    # Deleting from the UI must delete the underlying file, not just the row.
    assert not saved_files[0].exists()

    listing_after = client.get("/documents", params={"course_code": "CSC301", "session_label": "2024/2025"})
    assert listing_after.json() == []


def test_delete_missing_document_returns_404(client):
    resp = client.delete("/documents/00000000-0000-0000-0000-000000000000")
    assert resp.status_code == 404


def test_list_filters_by_doc_type(client):
    for doc_type, title in [("past_question", "PQ"), ("study_material", "SM")]:
        client.post(
            "/documents",
            data={
                "course_code": "CSC302",
                "session_label": "2024/2025",
                "doc_type": doc_type,
                "title": title,
            },
            files={"file": ("f.txt", io.BytesIO(b"content"), "text/plain")},
        )

    only_study_material = client.get(
        "/documents",
        params={"course_code": "CSC302", "session_label": "2024/2025", "doc_type": "study_material"},
    )
    titles = [d["title"] for d in only_study_material.json()]
    assert titles == ["SM"]
