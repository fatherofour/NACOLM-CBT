"""Generates a fixed-key sample .cbtpkg so the Go local exam server's tests
can prove they can decrypt a package this Python service actually produced,
without spinning up both services in one test run.

Run manually whenever app/services/crypto.py's envelope format changes:

    cd central-api && python scripts/generate_fixture_package.py
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import crypto  # noqa: E402

FIXTURE_DIR = Path(__file__).resolve().parent.parent.parent / "local-exam-server" / "testdata"
FIXED_KEY = bytes.fromhex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f")
FIXED_AAD = b"fixture-exam-0001"

SAMPLE_PLAINTEXT = {
    "exam_id": "fixture-exam-0001",
    "title": "Sample Networking Fundamentals CAT",
    "duration_minutes": 45,
    "pass_mark": 50.0,
    "questions_per_candidate": 2,
    "publish_mode": "instructor_controlled",
    "pool": [
        {
            "id": "q-mcq-1",
            "type": "mcq",
            "topic": "OSI Model",
            "source": "past_question",
            "stem": "Which OSI layer is responsible for routing?",
            "options": ["Data Link", "Network", "Transport", "Session"],
            "correct_index": 1,
            "model_answer": None,
            "rubric": None,
        },
        {
            "id": "q-theory-1",
            "type": "theory",
            "topic": "Subnetting",
            "source": "ai_generated",
            "stem": "Explain why subnetting improves network security and manageability.",
            "options": None,
            "correct_index": None,
            "model_answer": "Subnetting isolates broadcast domains and lets access control be applied per segment.",
            "rubric": [
                {"criterion": "Mentions broadcast domain isolation", "points": 5},
                {"criterion": "Mentions per-segment access control", "points": 5},
            ],
        },
    ],
}


def main() -> None:
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    plaintext_bytes = json.dumps(SAMPLE_PLAINTEXT).encode("utf-8")

    envelope = crypto.encrypt(plaintext_bytes, FIXED_KEY, aad=FIXED_AAD)

    (FIXTURE_DIR / "sample_package.cbtpkg").write_text(envelope.to_json(), encoding="utf-8")
    (FIXTURE_DIR / "sample_package.key.hex").write_text(FIXED_KEY.hex(), encoding="utf-8")
    (FIXTURE_DIR / "sample_package.aad.txt").write_text(FIXED_AAD.decode("ascii"), encoding="utf-8")
    (FIXTURE_DIR / "sample_package.expected.json").write_text(
        json.dumps(SAMPLE_PLAINTEXT, indent=2), encoding="utf-8"
    )
    print(f"Wrote fixture package to {FIXTURE_DIR}")


if __name__ == "__main__":
    main()
