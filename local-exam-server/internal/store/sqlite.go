// Package store persists candidate exam instances and responses locally,
// entirely offline. SQLite (pure-Go driver, no CGO) so the whole server
// ships as one static binary a venue's exam PC can run with nothing else
// installed.
package store

import (
	cryptorand "crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	_ "modernc.org/sqlite"

	"cbt.army.mil.ng/local-exam-server/internal/models"
)

const schema = `
CREATE TABLE IF NOT EXISTS exam_instances (
    exam_id            TEXT NOT NULL,
    candidate_id       TEXT NOT NULL,
    question_position  INTEGER NOT NULL,
    question_item_id   TEXT NOT NULL,
    question_type      TEXT NOT NULL,
    stem               TEXT NOT NULL,
    options_json       TEXT,           -- NULL for theory questions
    correct_index      INTEGER,        -- NULL for theory questions
    response_index     INTEGER,        -- candidate's MCQ answer, NULL until answered
    response_text      TEXT,           -- candidate's theory answer, NULL until answered
    is_correct         INTEGER,        -- 0/1, MCQ only, set at auto-mark time
    theory_score       REAL,           -- set by instructor during theory marking
    answered_at        TEXT,
    PRIMARY KEY (exam_id, candidate_id, question_position)
);

CREATE TABLE IF NOT EXISTS exam_sessions (
    exam_id       TEXT NOT NULL,
    candidate_id  TEXT NOT NULL,
    checked_in_at TEXT NOT NULL,
    submitted_at  TEXT,
    synced_at     TEXT,               -- set once results are pushed to the central server
    PRIMARY KEY (exam_id, candidate_id)
);

-- How many times each pool item has been drawn to a candidate so far this
-- sitting. Read by randomize.GenerateInstance to spread draws evenly across
-- the pool instead of leaving it to chance — see internal/randomize.
CREATE TABLE IF NOT EXISTS pool_exposure (
    exam_id           TEXT NOT NULL,
    question_item_id  TEXT NOT NULL,
    draw_count        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (exam_id, question_item_id)
);

-- The per-sitting random salt mixed into every candidate's seed derivation
-- (internal/randomize.DeriveSeed). Generated once, the first time an exam is
-- released, and persisted so a server restart mid-exam doesn't change
-- already-checked-in candidates' seed derivation inputs.
CREATE TABLE IF NOT EXISTS exam_release (
    exam_id      TEXT PRIMARY KEY,
    salt_hex     TEXT NOT NULL,
    released_at  TEXT NOT NULL
);
`

type Store struct {
	db *sql.DB
}

func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite db: %w", err)
	}
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	st := &Store{db: db}
	if err := st.migrateKiosk(); err != nil {
		db.Close()
		return nil, fmt.Errorf("apply kiosk columns: %w", err)
	}
	return st, nil
}

func (s *Store) Close() error { return s.db.Close() }

// CheckIn records the candidate's check-in and their generated exam
// instance in one transaction, so a crash mid-write can't leave a candidate
// half-registered.
func (s *Store) CheckIn(examID, candidateID string, questions []models.CandidateQuestion) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	now := time.Now().UTC().Format(time.RFC3339)
	if _, err := tx.Exec(
		`INSERT OR IGNORE INTO exam_sessions (exam_id, candidate_id, checked_in_at) VALUES (?, ?, ?)`,
		examID, candidateID, now,
	); err != nil {
		return fmt.Errorf("insert session: %w", err)
	}

	for position, q := range questions {
		var optionsJSON *string
		if q.Options != nil {
			raw, err := json.Marshal(q.Options)
			if err != nil {
				return fmt.Errorf("marshal options: %w", err)
			}
			s := string(raw)
			optionsJSON = &s
		}
		if _, err := tx.Exec(
			`INSERT OR IGNORE INTO exam_instances
			 (exam_id, candidate_id, question_position, question_item_id, question_type, stem, options_json, correct_index)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			examID, candidateID, position, q.QuestionItemID, q.Type, q.Stem, optionsJSON, q.CorrectIndex,
		); err != nil {
			return fmt.Errorf("insert instance row: %w", err)
		}
	}

	return tx.Commit()
}

type StoredQuestion struct {
	Position     int
	QuestionType string
	Stem         string
	Options      []string
}

// LoadCandidatePaper returns a candidate's paper WITHOUT correct answers —
// this is what the kiosk client is served.
func (s *Store) LoadCandidatePaper(examID, candidateID string) ([]StoredQuestion, error) {
	rows, err := s.db.Query(
		`SELECT question_position, question_type, stem, options_json
		 FROM exam_instances WHERE exam_id = ? AND candidate_id = ?
		 ORDER BY question_position`,
		examID, candidateID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []StoredQuestion
	for rows.Next() {
		var q StoredQuestion
		var optionsJSON *string
		if err := rows.Scan(&q.Position, &q.QuestionType, &q.Stem, &optionsJSON); err != nil {
			return nil, err
		}
		if optionsJSON != nil {
			if err := json.Unmarshal([]byte(*optionsJSON), &q.Options); err != nil {
				return nil, fmt.Errorf("unmarshal options: %w", err)
			}
		}
		out = append(out, q)
	}
	return out, rows.Err()
}

// RecordResponse stores a candidate's answer to one question. Exactly one
// of selectedIndex (MCQ) or answerText (theory) should be non-nil.
func (s *Store) RecordResponse(examID, candidateID string, position int, selectedIndex *int, answerText *string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.Exec(
		`UPDATE exam_instances SET response_index = ?, response_text = ?, answered_at = ?
		 WHERE exam_id = ? AND candidate_id = ? AND question_position = ?`,
		selectedIndex, answerText, now, examID, candidateID, position,
	)
	return err
}

// AutoMarkMCQ scores every MCQ question for a candidate immediately and
// offline — no network needed. Theory questions are left for the
// invigilator console to mark separately. Returns (correct, totalMCQ).
func (s *Store) AutoMarkMCQ(examID, candidateID string) (correct int, total int, err error) {
	rows, err := s.db.Query(
		`SELECT question_position, correct_index, response_index FROM exam_instances
		 WHERE exam_id = ? AND candidate_id = ? AND question_type = 'mcq'`,
		examID, candidateID,
	)
	if err != nil {
		return 0, 0, err
	}
	defer rows.Close()

	type update struct {
		position  int
		isCorrect bool
	}
	var updates []update
	for rows.Next() {
		var position int
		var correctIndex, responseIndex *int
		if err := rows.Scan(&position, &correctIndex, &responseIndex); err != nil {
			return 0, 0, err
		}
		total++
		isCorrect := correctIndex != nil && responseIndex != nil && *correctIndex == *responseIndex
		if isCorrect {
			correct++
		}
		updates = append(updates, update{position: position, isCorrect: isCorrect})
	}
	if err := rows.Err(); err != nil {
		return 0, 0, err
	}

	for _, u := range updates {
		if _, err := s.db.Exec(
			`UPDATE exam_instances SET is_correct = ? WHERE exam_id = ? AND candidate_id = ? AND question_position = ?`,
			u.isCorrect, examID, candidateID, u.position,
		); err != nil {
			return 0, 0, err
		}
	}

	if _, err := s.db.Exec(
		`UPDATE exam_sessions SET submitted_at = ? WHERE exam_id = ? AND candidate_id = ?`,
		time.Now().UTC().Format(time.RFC3339), examID, candidateID,
	); err != nil {
		return 0, 0, err
	}

	return correct, total, nil
}

// GetExposureCounts returns how many times each pool item has been drawn to
// a candidate so far this sitting, for randomize.GenerateInstance's
// exposure-weighted selection. Items never drawn are simply absent from the
// map — callers should treat a missing key as zero.
func (s *Store) GetExposureCounts(examID string) (map[string]int, error) {
	rows, err := s.db.Query(`SELECT question_item_id, draw_count FROM pool_exposure WHERE exam_id = ?`, examID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	counts := make(map[string]int)
	for rows.Next() {
		var id string
		var count int
		if err := rows.Scan(&id, &count); err != nil {
			return nil, err
		}
		counts[id] = count
	}
	return counts, rows.Err()
}

// IncrementExposure bumps the draw count for each question item a candidate
// was just given. Call this only once per candidate, after a genuinely new
// check-in — re-incrementing on an idempotent re-checkin would skew the
// exposure balance without a real additional draw happening.
func (s *Store) IncrementExposure(examID string, questionItemIDs []string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, id := range questionItemIDs {
		if _, err := tx.Exec(
			`INSERT INTO pool_exposure (exam_id, question_item_id, draw_count) VALUES (?, ?, 1)
			 ON CONFLICT(exam_id, question_item_id) DO UPDATE SET draw_count = draw_count + 1`,
			examID, id,
		); err != nil {
			return fmt.Errorf("increment exposure for %s: %w", id, err)
		}
	}
	return tx.Commit()
}

// GetOrCreateSalt returns the per-sitting random salt for an exam, creating
// it (via a CSPRNG) on first release. Persisting it means a local-exam-server
// restart mid-exam-day doesn't require picking a new salt — which would
// otherwise make already-checked-in candidates' seed derivation
// inconsistent with what generated their (already-served) paper.
func (s *Store) GetOrCreateSalt(examID string) ([]byte, error) {
	var saltHex string
	err := s.db.QueryRow(`SELECT salt_hex FROM exam_release WHERE exam_id = ?`, examID).Scan(&saltHex)
	if err == nil {
		return hex.DecodeString(saltHex)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}

	salt := make([]byte, 16)
	if _, err := cryptorand.Read(salt); err != nil {
		return nil, fmt.Errorf("generate release salt: %w", err)
	}
	saltHex = hex.EncodeToString(salt)
	if _, err := s.db.Exec(
		`INSERT INTO exam_release (exam_id, salt_hex, released_at) VALUES (?, ?, ?)`,
		examID, saltHex, time.Now().UTC().Format(time.RFC3339),
	); err != nil {
		return nil, fmt.Errorf("persist release salt: %w", err)
	}
	return salt, nil
}
