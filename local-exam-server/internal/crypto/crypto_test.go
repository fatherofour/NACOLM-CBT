package crypto

import (
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

// This test proves real interop with the central-api Python service: the
// fixture package on disk was produced by
// central-api/scripts/generate_fixture_package.py using the Python crypto
// module, not by this Go code. If someone changes the envelope format on
// either side without updating the other, this is what catches it.
func TestDecrypt_PythonProducedFixture(t *testing.T) {
	dir := "../../testdata"

	rawEnvelope, err := os.ReadFile(filepath.Join(dir, "sample_package.cbtpkg"))
	if err != nil {
		t.Fatalf("read fixture package (run `python scripts/generate_fixture_package.py` in central-api first): %v", err)
	}
	keyHex, err := os.ReadFile(filepath.Join(dir, "sample_package.key.hex"))
	if err != nil {
		t.Fatalf("read fixture key: %v", err)
	}
	aad, err := os.ReadFile(filepath.Join(dir, "sample_package.aad.txt"))
	if err != nil {
		t.Fatalf("read fixture aad: %v", err)
	}
	expectedJSON, err := os.ReadFile(filepath.Join(dir, "sample_package.expected.json"))
	if err != nil {
		t.Fatalf("read expected json: %v", err)
	}

	key, err := hex.DecodeString(string(keyHex))
	if err != nil {
		t.Fatalf("decode key hex: %v", err)
	}

	env, err := ParseEnvelope(rawEnvelope)
	if err != nil {
		t.Fatalf("parse envelope: %v", err)
	}

	plaintext, err := Decrypt(env, key, aad)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}

	assertJSONEqual(t, plaintext, expectedJSON)
}

func TestDecrypt_WrongKeyFails(t *testing.T) {
	dir := "../../testdata"
	rawEnvelope, _ := os.ReadFile(filepath.Join(dir, "sample_package.cbtpkg"))
	aad, _ := os.ReadFile(filepath.Join(dir, "sample_package.aad.txt"))

	env, err := ParseEnvelope(rawEnvelope)
	if err != nil {
		t.Fatalf("parse envelope: %v", err)
	}

	wrongKey := make([]byte, 32) // all zeros, not the real fixture key
	if _, err := Decrypt(env, wrongKey, aad); err == nil {
		t.Fatal("expected decryption to fail with the wrong key, it succeeded")
	}
}

func TestDecrypt_WrongAADFails(t *testing.T) {
	dir := "../../testdata"
	rawEnvelope, _ := os.ReadFile(filepath.Join(dir, "sample_package.cbtpkg"))
	keyHex, _ := os.ReadFile(filepath.Join(dir, "sample_package.key.hex"))
	key, _ := hex.DecodeString(string(keyHex))

	env, err := ParseEnvelope(rawEnvelope)
	if err != nil {
		t.Fatalf("parse envelope: %v", err)
	}

	if _, err := Decrypt(env, key, []byte("wrong-exam-id")); err == nil {
		t.Fatal("expected decryption to fail with the wrong AAD (exam id), it succeeded")
	}
}
