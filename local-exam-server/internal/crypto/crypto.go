// Package crypto reads the AES-256-GCM envelope produced by the central
// authoring service (central-api/app/services/crypto.py). See that file's
// docstring for the full format spec — this is the read side of it.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
)

const envelopeVersion = 1

type Envelope struct {
	Version    int    `json:"version"`
	Nonce      string `json:"nonce"`      // base64
	Ciphertext string `json:"ciphertext"` // base64, includes the 16-byte GCM tag
}

func ParseEnvelope(raw []byte) (Envelope, error) {
	var env Envelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return Envelope{}, fmt.Errorf("parse envelope: %w", err)
	}
	if env.Version != envelopeVersion {
		return Envelope{}, fmt.Errorf("unsupported envelope version %d", env.Version)
	}
	return env, nil
}

// Decrypt returns the plaintext exam-pool JSON. aad must be the exam id as
// it was encoded on the Python side (UTF-8 bytes of the exam id string).
func Decrypt(env Envelope, key []byte, aad []byte) ([]byte, error) {
	if len(key) != 32 {
		return nil, fmt.Errorf("key must be 32 bytes, got %d", len(key))
	}

	nonce, err := base64.StdEncoding.DecodeString(env.Nonce)
	if err != nil {
		return nil, fmt.Errorf("decode nonce: %w", err)
	}
	ciphertext, err := base64.StdEncoding.DecodeString(env.Ciphertext)
	if err != nil {
		return nil, fmt.Errorf("decode ciphertext: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("new cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("new gcm: %w", err)
	}
	if len(nonce) != gcm.NonceSize() {
		return nil, errors.New("nonce size mismatch")
	}

	plaintext, err := gcm.Open(nil, nonce, ciphertext, aad)
	if err != nil {
		return nil, fmt.Errorf("decrypt (wrong key, wrong exam id, or tampered package): %w", err)
	}
	return plaintext, nil
}
