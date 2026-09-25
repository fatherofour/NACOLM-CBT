package exam

import (
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadPackage_DecryptsPythonProducedFixtureAndGeneratesInstance(t *testing.T) {
	dir := "../../testdata"
	keyHex, err := os.ReadFile(filepath.Join(dir, "sample_package.key.hex"))
	if err != nil {
		t.Fatalf("read fixture key (run `python scripts/generate_fixture_package.py` in central-api first): %v", err)
	}
	key, err := hex.DecodeString(string(keyHex))
	if err != nil {
		t.Fatalf("decode key: %v", err)
	}

	pkg, err := LoadPackage(filepath.Join(dir, "sample_package.cbtpkg"), "fixture-exam-0001", key)
	if err != nil {
		t.Fatalf("LoadPackage: %v", err)
	}

	if pkg.Title != "Sample Networking Fundamentals CAT" {
		t.Fatalf("unexpected title: %q", pkg.Title)
	}
	if len(pkg.Pool) != 2 {
		t.Fatalf("expected 2 pool items, got %d", len(pkg.Pool))
	}
	if pkg.QuestionsPerCandidate != 2 {
		t.Fatalf("expected questions_per_candidate=2, got %d", pkg.QuestionsPerCandidate)
	}

	instance, err := GenerateCandidateInstance(pkg, "candidate-001", []byte("test-salt"), nil)
	if err != nil {
		t.Fatalf("GenerateCandidateInstance: %v", err)
	}
	if len(instance) != 2 {
		t.Fatalf("expected 2 questions in candidate instance, got %d", len(instance))
	}
}

func TestLoadPackage_WrongExamIDFails(t *testing.T) {
	dir := "../../testdata"
	keyHex, _ := os.ReadFile(filepath.Join(dir, "sample_package.key.hex"))
	key, _ := hex.DecodeString(string(keyHex))

	if _, err := LoadPackage(filepath.Join(dir, "sample_package.cbtpkg"), "some-other-exam", key); err == nil {
		t.Fatal("expected an error when the exam id doesn't match the package's AAD")
	}
}
