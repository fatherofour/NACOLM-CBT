package store

import (
	"database/sql"
	"strings"
	"time"
)

// Integrity events: what the kiosk detected (the candidate left the exam
// screen, a second display, a print or screenshot attempt...) and what
// happened about it (sign-ins, pauses, unlocks, extra time). This is the
// incident log for the sitting. A browser can only detect and record, never
// truly prevent, so the log is evidence for the invigilator's judgement, not
// proof of malpractice on its own.

// SeriousKinds count towards pausing the exam and are the "Flags" number on
// the invigilator console. The rest are recorded for the timeline only.
var SeriousKinds = []string{
	"tab_hidden", "window_blur", "fullscreen_exit", "multi_screen",
	"print_attempt", "screenshot_key", "bulk_insert", "concurrent_login_blocked",
}

var integrityColumns = []string{
	`ALTER TABLE exam_violations ADD COLUMN detail TEXT`,
	// 0 for an event that is part of the same episode as the one just before
	// it (leaving the window fires blur and hidden together), so one
	// alt-tab counts once towards the pause threshold.
	`ALTER TABLE exam_violations ADD COLUMN counted INTEGER NOT NULL DEFAULT 1`,
	`ALTER TABLE exam_sessions ADD COLUMN locked_at TEXT`,
	`ALTER TABLE exam_sessions ADD COLUMN lock_reason TEXT`,
	// Serious-event count already dealt with by an invigilator unlock, so the
	// candidate gets a fresh allowance afterwards.
	`ALTER TABLE exam_sessions ADD COLUMN flags_cleared INTEGER NOT NULL DEFAULT 0`,
}

func seriousIn() string {
	return "('" + strings.Join(SeriousKinds, "','") + "')"
}

// RecordViolation logs one integrity event. counted=false keeps it in the
// timeline without counting it towards the pause threshold.
func (s *Store) RecordViolation(examID, candidateID, kind, detail string, counted bool, at time.Time) error {
	c := 0
	if counted {
		c = 1
	}
	_, err := s.db.Exec(
		`INSERT INTO exam_violations (exam_id, candidate_id, kind, detail, counted, occurred_at) VALUES (?, ?, ?, ?, ?, ?)`,
		examID, candidateID, kind, nullable(detail), c, at.UTC().Format(time.RFC3339),
	)
	return err
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// CountFlagsByExam returns each candidate's serious-event count, for the
// invigilator console's roster — one query for the whole exam.
func (s *Store) CountFlagsByExam(examID string) (map[string]int, error) {
	rows, err := s.db.Query(`SELECT candidate_id, COUNT(*) FROM exam_violations WHERE exam_id = ? AND kind IN `+seriousIn()+` GROUP BY candidate_id`, examID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var candidateID string
		var n int
		if err := rows.Scan(&candidateID, &n); err != nil {
			return nil, err
		}
		out[candidateID] = n
	}
	return out, rows.Err()
}

// CountedSerious is the number of serious events that count towards pausing.
func (s *Store) CountedSerious(examID, candidateID string) (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COALESCE(SUM(counted), 0) FROM exam_violations WHERE exam_id = ? AND candidate_id = ? AND kind IN `+seriousIn(), examID, candidateID).Scan(&n)
	return n, err
}

type Event struct {
	CandidateID string    `json:"candidate_id"`
	Kind        string    `json:"kind"`
	Detail      string    `json:"detail,omitempty"`
	Counted     bool      `json:"counted"`
	At          time.Time `json:"at"`
}

// Events lists one candidate's events, or every candidate's when candidateID
// is empty, oldest first.
func (s *Store) Events(examID, candidateID string) ([]Event, error) {
	q := `SELECT candidate_id, kind, COALESCE(detail, ''), counted, occurred_at FROM exam_violations WHERE exam_id = ?`
	args := []any{examID}
	if candidateID != "" {
		q += ` AND candidate_id = ?`
		args = append(args, candidateID)
	}
	rows, err := s.db.Query(q+` ORDER BY id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Event
	for rows.Next() {
		var e Event
		var counted int
		var at string
		if err := rows.Scan(&e.CandidateID, &e.Kind, &e.Detail, &counted, &at); err != nil {
			return nil, err
		}
		e.Counted = counted == 1
		e.At, _ = time.Parse(time.RFC3339, at)
		out = append(out, e)
	}
	return out, rows.Err()
}

type LockState struct {
	LockedAt     *time.Time
	Reason       string
	FlagsCleared int
}

func (s *Store) GetLock(examID, candidateID string) (LockState, error) {
	var at, reason sql.NullString
	var cleared int
	err := s.db.QueryRow(`SELECT locked_at, lock_reason, flags_cleared FROM exam_sessions WHERE exam_id = ? AND candidate_id = ?`, examID, candidateID).Scan(&at, &reason, &cleared)
	if err == sql.ErrNoRows {
		return LockState{}, nil
	}
	return LockState{LockedAt: parseTime(at), Reason: reason.String, FlagsCleared: cleared}, err
}

// Lock pauses the candidate's exam. Returns false if it was already paused
// or the candidate has no session yet.
func (s *Store) Lock(examID, candidateID, reason string, at time.Time) (bool, error) {
	res, err := s.db.Exec(`UPDATE exam_sessions SET locked_at = ?, lock_reason = ? WHERE exam_id = ? AND candidate_id = ? AND locked_at IS NULL AND submitted_at IS NULL`,
		at.UTC().Format(time.RFC3339), reason, examID, candidateID)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// Unlock resumes the exam and records the serious events dealt with so far,
// so the next pause needs a fresh run of warnings.
func (s *Store) Unlock(examID, candidateID string, flagsCleared int) (bool, error) {
	res, err := s.db.Exec(`UPDATE exam_sessions SET locked_at = NULL, lock_reason = NULL, flags_cleared = ? WHERE exam_id = ? AND candidate_id = ? AND locked_at IS NOT NULL`,
		flagsCleared, examID, candidateID)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// ExtendDeadline gives a started, unsubmitted candidate extra time.
func (s *Store) ExtendDeadline(examID, candidateID string, by time.Duration) (*time.Time, error) {
	st, err := s.GetSessionState(examID, candidateID)
	if err != nil || st.DeadlineAt == nil || st.SubmittedAt != nil {
		return nil, err
	}
	d := st.DeadlineAt.Add(by)
	if _, err := s.db.Exec(`UPDATE exam_sessions SET deadline_at = ? WHERE exam_id = ? AND candidate_id = ? AND submitted_at IS NULL`,
		d.UTC().Format(time.RFC3339), examID, candidateID); err != nil {
		return nil, err
	}
	return &d, nil
}
