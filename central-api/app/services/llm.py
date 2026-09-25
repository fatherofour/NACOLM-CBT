"""LLM provider abstraction used by the question-generation pipeline.

Isolated behind an interface so the generation logic (prompt construction,
response parsing) can be unit tested with FakeLLMProvider, without needing
an API key or a network call in CI.
"""

from __future__ import annotations

from typing import Protocol

from app.core.config import get_settings


class LLMProvider(Protocol):
    def complete(self, system_prompt: str, user_prompt: str) -> str: ...


class AnthropicLLMProvider:
    def __init__(self, api_key: str, model: str):
        # Imported lazily so importing this module never requires the
        # anthropic package or an API key unless this provider is actually used.
        from anthropic import Anthropic

        self._client = Anthropic(api_key=api_key)
        self._model = model

    def complete(self, system_prompt: str, user_prompt: str) -> str:
        response = self._client.messages.create(
            model=self._model,
            max_tokens=4096,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        return "".join(block.text for block in response.content if block.type == "text")


class FakeLLMProvider:
    """Returns a fixed, well-formed response — used in tests and local dev
    without an API key. Callers should not assume any particular content
    beyond the JSON shape documented in question_generation.py."""

    def __init__(self, fixed_response: str):
        self._fixed_response = fixed_response

    def complete(self, system_prompt: str, user_prompt: str) -> str:
        return self._fixed_response


def get_llm_provider() -> LLMProvider:
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise RuntimeError(
            "CBT_ANTHROPIC_API_KEY is not set. Question generation from study "
            "material requires an LLM provider; set the key or inject a "
            "different LLMProvider for local/dev use."
        )
    return AnthropicLLMProvider(api_key=settings.anthropic_api_key, model=settings.llm_model)
