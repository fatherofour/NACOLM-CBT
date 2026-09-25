"""Embedding provider abstraction.

Kept as an interface (rather than calling one SDK directly) because this
choice is genuinely still open for this project: sentence-transformers
running locally keeps the whole authoring platform vendor-independent,
while a hosted embeddings API is less ops work. Swap the provider bound in
get_embedding_provider() once that's decided; nothing else in the RAG
pipeline needs to change.

HashEmbeddingProvider is a deterministic, dependency-free stand-in used in
tests and local dev so the pipeline is runnable without downloading a model
or holding an API key.
"""

from __future__ import annotations

import hashlib
from typing import Protocol

from app.models.document import EMBEDDING_DIM


class EmbeddingProvider(Protocol):
    def embed(self, texts: list[str]) -> list[list[float]]: ...


class HashEmbeddingProvider:
    """Deterministic pseudo-embedding: same text always maps to the same
    vector. Good enough to exercise chunking/storage/retrieval code paths
    in tests; not semantically meaningful, so never use it in production.
    """

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._embed_one(text) for text in texts]

    def _embed_one(self, text: str) -> list[float]:
        vector: list[float] = []
        seed = text.encode("utf-8")
        while len(vector) < EMBEDDING_DIM:
            seed = hashlib.sha256(seed).digest()
            vector.extend(byte / 255.0 for byte in seed)
        return vector[:EMBEDDING_DIM]


def get_embedding_provider() -> EmbeddingProvider:
    return HashEmbeddingProvider()
