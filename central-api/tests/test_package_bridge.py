import json

import pytest

from app.core.config import get_settings
from app.services import crypto


@pytest.fixture(autouse=True)
def storage_root(tmp_path, monkeypatch):
    monkeypatch.setenv("CBT_PACKAGE_STORAGE_DIR", str(tmp_path))
    get_settings.cache_clear()
    yield tmp_path
    get_settings.cache_clear()


def _payload():
    return {
        "exam_id": "paperversion-123",
        "title": "CAT 1",
        "duration_minutes": 60,
        "pass_mark": 50.0,
        "questions_per_candidate": 2,
        "publish_mode": "instructor_controlled",
        "pool": [
            {
                "id": "q1",
                "type": "mcq",
                "topic": "OSI Model",
                "source": "past_question",
                "stem": "Which layer?",
                "options": ["A", "B", "C", "D"],
                "correct_index": 1,
            },
            {
                "id": "q2",
                "type": "theory",
                "topic": "Subnetting",
                "source": "ai_generated",
                "stem": "Explain subnetting.",
                "model_answer": "...",
                "rubric": [{"criterion": "mentions broadcast domains", "points": 5}],
            },
        ],
    }


def test_build_from_paper_produces_decryptable_package(client):
    resp = client.post("/package-bridge/build", json=_payload())
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["pool_size"] == 2

    raw = json.loads(open(body["storage_path"], "rb").read())
    envelope = crypto.Envelope.from_json(json.dumps(raw))
    key = bytes.fromhex(body["release_key_hex"])
    plaintext = json.loads(crypto.decrypt(envelope, key, aad=b"paperversion-123"))

    assert plaintext["title"] == "CAT 1"
    assert len(plaintext["pool"]) == 2
    # No candidate roster in the package — that travels to the venue as a
    # separate CSV, loaded straight from disk by local-exam-server.
    assert "roster" not in plaintext


def test_wrong_exam_id_fails_to_decrypt(client):
    resp = client.post("/package-bridge/build", json=_payload())
    body = resp.json()

    raw = json.loads(open(body["storage_path"], "rb").read())
    envelope = crypto.Envelope.from_json(json.dumps(raw))
    key = bytes.fromhex(body["release_key_hex"])
    with pytest.raises(Exception):
        crypto.decrypt(envelope, key, aad=b"some-other-paperversion")
