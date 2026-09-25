from app.models.question import QuestionItem, QuestionSource, QuestionStatus, QuestionType


def test_list_drafts_serializes_over_http(client, db_session):
    # This is a regression test: list_drafts used to return raw SQLAlchemy
    # ORM objects with no response_model, which fails to JSON-serialize
    # once actually hit over HTTP (jsonable_encoder chokes on SQLAlchemy's
    # internal InstanceState) — TestClient without `with` still runs real
    # request/response serialization, so this catches it.
    db_session.add(
        QuestionItem(
            course_code="CSC301",
            session_label="2024/2025",
            topic="OSI Model",
            question_type=QuestionType.MCQ,
            source=QuestionSource.PAST_QUESTION,
            stem="Which layer handles routing?",
            options=["A", "B", "C", "D"],
            correct_index=0,
            status=QuestionStatus.DRAFT,
        )
    )
    db_session.commit()

    resp = client.get("/questions/drafts", params={"course_code": "CSC301"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 1
    assert body[0]["stem"] == "Which layer handles routing?"
    assert body[0]["status"] == "draft"
