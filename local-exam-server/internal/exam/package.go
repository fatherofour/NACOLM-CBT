// Package exam handles loading the encrypted .cbtpkg synced from the
// central service and turning it into candidate exam instances.
package exam

import (
	"encoding/json"
	"fmt"
	"os"

	"cbt.army.mil.ng/local-exam-server/internal/crypto"
	"cbt.army.mil.ng/local-exam-server/internal/models"
	"cbt.army.mil.ng/local-exam-server/internal/randomize"
)

// LoadPackage decrypts the package at path for the given exam. The exam id
// must be known independently of the file (it's how the venue's sync
// manifest names the download) since it doubles as the GCM associated data
// that binds a ciphertext to one specific exam — see internal/crypto.
//
// The key is deliberately not read from disk here: it is supplied by
// whatever release mechanism fires at exam start (ReleaseKeyProvider),
// never stored next to the package.
func LoadPackage(path string, examID string, key []byte) (*models.ExamPackage, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read package %s: %w", path, err)
	}

	env, err := crypto.ParseEnvelope(raw)
	if err != nil {
		return nil, err
	}

	plaintext, err := crypto.Decrypt(env, key, []byte(examID))
	if err != nil {
		return nil, err
	}

	var pkg models.ExamPackage
	if err := json.Unmarshal(plaintext, &pkg); err != nil {
		return nil, fmt.Errorf("parse decrypted package: %w", err)
	}
	if pkg.ExamID != examID {
		return nil, fmt.Errorf("package exam id %q does not match requested exam %q", pkg.ExamID, examID)
	}
	return &pkg, nil
}

// GenerateCandidateInstance is the check-in-time entry point: given a
// decrypted package and a candidate id, draw that candidate's paper.
// salt is the per-sitting value from Store.GetOrCreateSalt (unpredictable
// before release); exposureCounts is the current per-item draw tally from
// Store.GetExposureCounts, used to keep coverage balanced across the cohort.
func GenerateCandidateInstance(
	pkg *models.ExamPackage, candidateID string, salt []byte, exposureCounts map[string]int,
) ([]models.CandidateQuestion, error) {
	seed := randomize.DeriveSeed(pkg.ExamID, candidateID, salt)
	return randomize.GenerateInstance(pkg.Pool, seed, pkg.QuestionsPerCandidate, exposureCounts)
}
