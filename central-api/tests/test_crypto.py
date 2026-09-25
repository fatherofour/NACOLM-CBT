import pytest
from cryptography.exceptions import InvalidTag

from app.services import crypto


def test_encrypt_decrypt_roundtrip():
    key = crypto.generate_key()
    plaintext = b'{"pool": ["q1", "q2"]}'
    envelope = crypto.encrypt(plaintext, key, aad=b"exam-123")

    recovered = crypto.decrypt(envelope, key, aad=b"exam-123")

    assert recovered == plaintext


def test_envelope_json_roundtrip_preserves_bytes():
    key = crypto.generate_key()
    envelope = crypto.encrypt(b"payload", key, aad=b"exam-1")

    rebuilt = crypto.Envelope.from_json(envelope.to_json())

    assert rebuilt.nonce == envelope.nonce
    assert rebuilt.ciphertext == envelope.ciphertext
    assert crypto.decrypt(rebuilt, key, aad=b"exam-1") == b"payload"


def test_wrong_key_fails():
    envelope = crypto.encrypt(b"payload", crypto.generate_key(), aad=b"exam-1")
    with pytest.raises(InvalidTag):
        crypto.decrypt(envelope, crypto.generate_key(), aad=b"exam-1")


def test_wrong_aad_fails():
    key = crypto.generate_key()
    envelope = crypto.encrypt(b"payload", key, aad=b"exam-1")
    with pytest.raises(InvalidTag):
        crypto.decrypt(envelope, key, aad=b"exam-DIFFERENT")


def test_tampered_ciphertext_fails():
    key = crypto.generate_key()
    envelope = crypto.encrypt(b"payload", key, aad=b"exam-1")
    tampered = crypto.Envelope(
        version=envelope.version,
        nonce=envelope.nonce,
        ciphertext=bytes([envelope.ciphertext[0] ^ 0xFF]) + envelope.ciphertext[1:],
    )
    with pytest.raises(InvalidTag):
        crypto.decrypt(tampered, key, aad=b"exam-1")
