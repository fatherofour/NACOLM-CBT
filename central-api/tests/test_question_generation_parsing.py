import pytest

from app.services.question_generation import _parse_llm_response


def test_parses_plain_json_array():
    raw = '[{"stem": "What is a subnet?", "options": ["a", "b"], "correct_index": 0}]'
    assert _parse_llm_response(raw) == [{"stem": "What is a subnet?", "options": ["a", "b"], "correct_index": 0}]


def test_strips_markdown_code_fence():
    raw = '```json\n[{"stem": "x"}]\n```'
    assert _parse_llm_response(raw) == [{"stem": "x"}]


def test_strips_bare_code_fence_without_language_tag():
    raw = "```\n[{\"stem\": \"x\"}]\n```"
    assert _parse_llm_response(raw) == [{"stem": "x"}]


def test_rejects_non_array_json():
    with pytest.raises(ValueError):
        _parse_llm_response('{"stem": "not an array"}')
