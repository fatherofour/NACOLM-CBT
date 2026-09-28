package store

import "time"

// RecordViolation logs one integrity event from the kiosk — the candidate's
// tab was hidden, the window lost focus, or they left fullscreen. Never
// blocks the candidate from continuing; this is a log, not a lock.
func (s *Store) RecordViolation(examID, candidateID, kind string, at time.Time) error {
	_, err := s.db.Exec(
		`INSERT INTO exam_violations (exam_id, candidate_id, kind, occurred_at) VALUES (?, ?, ?, ?)`,
		examID, candidateID, kind, at.UTC().Format(time.RFC3339),
	)
	return err
}

// CountViolationsByExam returns how many integrity events each candidate has
// triggered so far, for the invigilator console's roster — one query for
// the whole exam rather than one per candidate.
func (s *Store) CountViolationsByExam(examID string) (map[string]int, error) {
	rows, err := s.db.Query(`SELECT candidate_id, COUNT(*) FROM exam_violations WHERE exam_id = ? GROUP BY candidate_id`, examID)
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
