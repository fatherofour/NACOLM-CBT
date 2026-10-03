package store

import (
	"database/sql"
	"strings"
)

// ResultItem is one question of a candidate's submitted paper, for the
// results file the portal imports (objective totals and item analysis).
type ResultItem struct {
	QuestionID string `json:"question_id"`
	Type       string `json:"type"`
	Correct    bool   `json:"correct"`
	Answered   bool   `json:"answered"`
}

func (s *Store) ResultItems(examID, candidateID string) ([]ResultItem, error) {
	rows, err := s.db.Query(
		`SELECT question_item_id, question_type, correct_index, response_index, response_text
		 FROM exam_instances WHERE exam_id = ? AND candidate_id = ? ORDER BY question_position`,
		examID, candidateID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ResultItem
	for rows.Next() {
		var it ResultItem
		var correct, response sql.NullInt64
		var text sql.NullString
		if err := rows.Scan(&it.QuestionID, &it.Type, &correct, &response, &text); err != nil {
			return nil, err
		}
		it.Answered = response.Valid || strings.TrimSpace(text.String) != ""
		it.Correct = it.Type == "mcq" && correct.Valid && response.Valid && correct.Int64 == response.Int64
		out = append(out, it)
	}
	return out, rows.Err()
}
