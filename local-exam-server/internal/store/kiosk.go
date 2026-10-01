package store

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Columns the candidate kiosk needs on exam_sessions. Added with ALTER TABLE
// so databases created before the kiosk existed keep working.
var kioskColumns = []string{
	`ALTER TABLE exam_sessions ADD COLUMN started_at TEXT`,
	`ALTER TABLE exam_sessions ADD COLUMN deadline_at TEXT`,
	`ALTER TABLE exam_sessions ADD COLUMN submit_reference TEXT`,
	// SHA-256 of the candidate's final answers, computed the instant
	// submission is locked in — see MarkSubmitted. Lets anyone later prove
	// the stored responses are exactly what was submitted, independent of
	// trg_lock_responses_after_submit (which stops the write; this lets you
	// detect it if that were ever bypassed, e.g. by editing the DB file
	// directly with the server stopped).
	`ALTER TABLE exam_sessions ADD COLUMN response_hash TEXT`,
}

func (s *Store) migrateKiosk() error {
	for _, stmt := range append(kioskColumns, integrityColumns...) {
		if _, err := s.db.Exec(stmt); err != nil && !strings.Contains(strings.ToLower(err.Error()), "duplicate column") {
			return err
		}
	}
	return nil
}

// SessionState is one candidate's progress through the sitting.
type SessionState struct {
	CheckedIn    bool
	StartedAt    *time.Time
	DeadlineAt   *time.Time
	SubmittedAt  *time.Time
	Reference    string
	ResponseHash string // set once, alongside SubmittedAt — see MarkSubmitted
}

func parseTime(v sql.NullString) *time.Time {
	if !v.Valid || v.String == "" {
		return nil
	}
	t, err := time.Parse(time.RFC3339, v.String)
	if err != nil {
		return nil
	}
	return &t
}

func (s *Store) GetSessionState(examID, candidateID string) (SessionState, error) {
	var started, deadline, submitted, ref, hash sql.NullString
	err := s.db.QueryRow(
		`SELECT started_at, deadline_at, submitted_at, submit_reference, response_hash FROM exam_sessions WHERE exam_id = ? AND candidate_id = ?`,
		examID, candidateID,
	).Scan(&started, &deadline, &submitted, &ref, &hash)
	if errors.Is(err, sql.ErrNoRows) {
		return SessionState{}, nil
	}
	if err != nil {
		return SessionState{}, err
	}
	return SessionState{CheckedIn: true, StartedAt: parseTime(started), DeadlineAt: parseTime(deadline), SubmittedAt: parseTime(submitted), Reference: ref.String, ResponseHash: hash.String}, nil
}

// StartClock records when the candidate pressed Start and their deadline.
// It only ever sets them once: signing in again after a kiosk restart keeps
// the original deadline.
func (s *Store) StartClock(examID, candidateID string, now time.Time, duration time.Duration) error {
	_, err := s.db.Exec(
		`UPDATE exam_sessions SET started_at = ?, deadline_at = ?
		 WHERE exam_id = ? AND candidate_id = ? AND started_at IS NULL`,
		now.UTC().Format(time.RFC3339), now.Add(duration).UTC().Format(time.RFC3339), examID, candidateID,
	)
	return err
}

// MarkSubmitted closes the candidate's paper and, in the same transaction,
// stamps a SHA-256 of their final answers (trg_lock_responses_after_submit
// then stops those answers changing). Returns false if it was already
// submitted — a no-op, not an error, so a retried request from a flaky
// kiosk connection can't fail the candidate's submission.
func (s *Store) MarkSubmitted(examID, candidateID, reference string, now time.Time) (bool, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	res, err := tx.Exec(
		`UPDATE exam_sessions SET submitted_at = ?, submit_reference = ?
		 WHERE exam_id = ? AND candidate_id = ? AND submitted_at IS NULL`,
		now.UTC().Format(time.RFC3339), reference, examID, candidateID,
	)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	if n == 0 {
		return false, nil
	}

	hash, err := responseHash(tx, examID, candidateID)
	if err != nil {
		return false, err
	}
	if _, err := tx.Exec(`UPDATE exam_sessions SET response_hash = ? WHERE exam_id = ? AND candidate_id = ?`, hash, examID, candidateID); err != nil {
		return false, err
	}
	return true, tx.Commit()
}

// responseHash is the tamper-evidence value MarkSubmitted stores: a SHA-256
// over every question's position and final answer, in position order, so
// two candidates who answer identically get the same hash and any later
// change to a stored answer is detectable by recomputing it.
func responseHash(tx *sql.Tx, examID, candidateID string) (string, error) {
	rows, err := tx.Query(
		`SELECT question_position, response_index, response_text FROM exam_instances
		 WHERE exam_id = ? AND candidate_id = ? ORDER BY question_position`,
		examID, candidateID,
	)
	if err != nil {
		return "", err
	}
	defer rows.Close()

	h := sha256.New()
	for rows.Next() {
		var position int
		var idx sql.NullInt64
		var text sql.NullString
		if err := rows.Scan(&position, &idx, &text); err != nil {
			return "", err
		}
		idxStr := ""
		if idx.Valid {
			idxStr = strconv.FormatInt(idx.Int64, 10)
		}
		fmt.Fprintf(h, "%d|%s|%s\n", position, idxStr, text.String)
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// SavedAnswer is what a candidate has entered so far for one question.
type SavedAnswer struct {
	Position      int     `json:"position"`
	SelectedIndex *int    `json:"selected_index,omitempty"`
	AnswerText    *string `json:"answer_text,omitempty"`
}

func (s *Store) LoadAnswers(examID, candidateID string) ([]SavedAnswer, error) {
	rows, err := s.db.Query(
		`SELECT question_position, response_index, response_text FROM exam_instances
		 WHERE exam_id = ? AND candidate_id = ? AND (response_index IS NOT NULL OR response_text IS NOT NULL)
		 ORDER BY question_position`,
		examID, candidateID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SavedAnswer
	for rows.Next() {
		var a SavedAnswer
		var idx sql.NullInt64
		var text sql.NullString
		if err := rows.Scan(&a.Position, &idx, &text); err != nil {
			return nil, err
		}
		if idx.Valid {
			v := int(idx.Int64)
			a.SelectedIndex = &v
		}
		if text.Valid {
			v := text.String
			a.AnswerText = &v
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
