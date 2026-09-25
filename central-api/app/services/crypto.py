"""AES-256-GCM envelope for exam packages.

This is the one wire format shared between two independently-built
services: this Python module writes it, and the Go local exam server
(local-exam-server/internal/crypto) reads it. Both AES-GCM implementations
are standard-library / well-known packages, so the format only needs to
agree on layout, not on a shared codebase:

    {
      "version": 1,
      "nonce": "<base64, 12 bytes>",
      "ciphertext": "<base64, includes the 16-byte GCM tag appended>"
    }

The associated data (AAD) is the exam id as UTF-8 bytes, which binds a
ciphertext to one specific exam and makes package-swapping across exams
fail decryption instead of silently succeeding.

The AES key itself never travels inside this envelope. It is generated
per exam, handed to whatever release mechanism the venue uses (online
check-in at scheduled start, or a sealed code read out by the invigilator),
and is not persisted next to the encrypted package.
"""

from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ENVELOPE_VERSION = 1
KEY_SIZE_BYTES = 32  # AES-256
NONCE_SIZE_BYTES = 12  # standard GCM nonce size


@dataclass
class Envelope:
    version: int
    nonce: bytes
    ciphertext: bytes

    def to_json(self) -> str:
        return json.dumps(
            {
                "version": self.version,
                "nonce": base64.b64encode(self.nonce).decode("ascii"),
                "ciphertext": base64.b64encode(self.ciphertext).decode("ascii"),
            }
        )

    @classmethod
    def from_json(cls, raw: str) -> "Envelope":
        data = json.loads(raw)
        return cls(
            version=data["version"],
            nonce=base64.b64decode(data["nonce"]),
            ciphertext=base64.b64decode(data["ciphertext"]),
        )


def generate_key() -> bytes:
    return os.urandom(KEY_SIZE_BYTES)


def encrypt(plaintext: bytes, key: bytes, aad: bytes) -> Envelope:
    if len(key) != KEY_SIZE_BYTES:
        raise ValueError(f"key must be {KEY_SIZE_BYTES} bytes, got {len(key)}")
    nonce = os.urandom(NONCE_SIZE_BYTES)
    ciphertext = AESGCM(key).encrypt(nonce, plaintext, aad)
    return Envelope(version=ENVELOPE_VERSION, nonce=nonce, ciphertext=ciphertext)


def decrypt(envelope: Envelope, key: bytes, aad: bytes) -> bytes:
    if envelope.version != ENVELOPE_VERSION:
        raise ValueError(f"unsupported envelope version {envelope.version}")
    return AESGCM(key).decrypt(envelope.nonce, envelope.ciphertext, aad)
