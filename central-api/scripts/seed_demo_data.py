"""Seeds enough question-bank data to make the instructor portal's tabs
non-empty for a demo: some drafts waiting for approval, and enough approved
past-question + AI-generated items for the Exams tab's preview/build-package
actions to actually have a pool to work with.

Run against a live central-api DB (same one uvicorn is pointed at):

    CBT_DATABASE_URL=... python scripts/seed_demo_data.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db.session import SessionLocal  # noqa: E402
from app.models.question import QuestionItem, QuestionSource, QuestionStatus, QuestionType  # noqa: E402

COURSE = "CSC301"
SESSION = "2024/2025"

MCQ_TEMPLATES = [
    ("Which OSI layer is responsible for routing between networks?",
     ["Data Link", "Network", "Transport", "Session"], 1, "OSI Model"),
    ("Which protocol resolves a domain name to an IP address?",
     ["ARP", "DNS", "DHCP", "ICMP"], 1, "Networking Fundamentals"),
    ("What does CIDR notation /24 represent?",
     ["A /24 prefix gives 256 addresses", "A /24 prefix gives 24 addresses", "A Class A network", "A loopback range"], 0, "Subnetting"),
    ("Which layer of the OSI model handles encryption and compression?",
     ["Presentation", "Session", "Application", "Transport"], 0, "OSI Model"),
    ("Which device operates primarily at Layer 2 of the OSI model?",
     ["Router", "Switch", "Hub repeater", "Firewall"], 1, "OSI Model"),
]


def make_item(i: int, source: QuestionSource, status: QuestionStatus) -> QuestionItem:
    stem, options, correct, topic = MCQ_TEMPLATES[i % len(MCQ_TEMPLATES)]
    suffix = f" (variant {i})" if i >= len(MCQ_TEMPLATES) else ""
    return QuestionItem(
        course_code=COURSE,
        session_label=SESSION,
        topic=topic,
        question_type=QuestionType.MCQ,
        source=source,
        stem=stem + suffix,
        options=options,
        correct_index=correct,
        status=status,
    )


def main() -> None:
    db = SessionLocal()
    try:
        for i in range(22):
            db.add(make_item(i, QuestionSource.PAST_QUESTION, QuestionStatus.APPROVED))
        for i in range(8):
            db.add(make_item(i, QuestionSource.AI_GENERATED, QuestionStatus.APPROVED))
        for i in range(3):
            db.add(make_item(i, QuestionSource.PAST_QUESTION, QuestionStatus.DRAFT))
        db.add(
            QuestionItem(
                course_code=COURSE,
                session_label=SESSION,
                topic="Subnetting",
                question_type=QuestionType.THEORY,
                source=QuestionSource.AI_GENERATED,
                stem="Explain why subnetting improves network security and manageability.",
                model_answer="Subnetting isolates broadcast domains and lets access control be applied per segment.",
                rubric=[
                    {"criterion": "Mentions broadcast domain isolation", "points": 5},
                    {"criterion": "Mentions per-segment access control", "points": 5},
                ],
                status=QuestionStatus.DRAFT,
            )
        )
        db.commit()
        print(f"Seeded demo questions for {COURSE} / {SESSION}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
