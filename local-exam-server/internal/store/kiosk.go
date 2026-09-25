package store

import (
	"database/sql"
	"errors"
	"strings"
	"time"
)

// Columns the candidate kiosk needs on exam_sessions. Added with ALTER TABLE
// so databases created before the kiosk existed keep working.
var kioskColumns = []string{
	`ALTER TABLE exam_sessions ADD COLUMN started_at TEXT`,
	`ALTER TABLE exam_sessions ADD COLUMN deadline_at TEXT`,
	`ALTER TABLE exam_sessions ADD COLUMN submit_reference TEXT`,
}

func (s *Store) migrateKiosk() error {
	for _, stmt := range kioskColumns {
		if _, err := s.db.Exec(stmt); err != nil && !strings.Contains(strings.ToLower(err.Error()), "duplicate column") {
			return err
		}
	}
	return nil
}

// SessionState is one candidate's progress through the sitting.
type SessionState struct {
	CheckedIn   bool
	StartedAt   *time.Time
	DeadlineAt  *time.Time
	SubmittedAt *time.Time
	Reference   string
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
	var started, deadline, submitted, ref sql.NullString
	err := s.db.QueryRow(
		`SELECT started_at, deadline_at, submitted_at, submit_reference FROM exam_sessions WHERE exam_id = ? AND candidate_id = ?`,
		examID, candidateID,
	).Scan(&started, &deadline, &submitted, &ref)
	if errors.Is(err, sql.ErrNoRows) {
		return SessionState{}, nil
	}
	if err != nil {
		return SessionState{}, err
	}
	return SessionState{CheckedIn: true, StartedAt: parseTime(started), DeadlineAt: parseTime(deadline), SubmittedAt: parseTime(submitted), Reference: ref.String}, nil
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

// MarkSubmitted closes the candidate's paper. Returns false if it was
// already submitted.
func (s *Store) MarkSubmitted(examID, candidateID, reference string, now time.Time) (bool, error) {
	res, err := s.db.Exec(
		`UPDATE exam_sessions SET submitted_at = ?, submit_reference = ?
		 WHERE exam_id = ? AND candidate_id = ? AND submitted_at IS NULL`,
		now.UTC().Format(time.RFC3339), reference, examID, candidateID,
	)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n == 1, err
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
