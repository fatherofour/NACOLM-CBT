// Package models holds the shapes shared across the local exam server:
// the decrypted pool from the central service, and what gets stored per
// candidate once their paper is drawn from it.
package models

// PoolItem mirrors one entry of the "pool" array in the decrypted exam
// package JSON (see central-api/app/services/packaging.py::_serialize_pool).
type PoolItem struct {
	ID           string   `json:"id"`
	Type         string   `json:"type"` // "mcq" | "theory"
	Topic        string   `json:"topic"`
	Source       string   `json:"source"` // "past_question" | "ai_generated"
	Stem         string   `json:"stem"`
	Options      []string `json:"options"`
	CorrectIndex *int     `json:"correct_index"`
	ModelAnswer  *string  `json:"model_answer"`
	Rubric       []Rubric `json:"rubric"`
}

type Rubric struct {
	Criterion string `json:"criterion"`
	Points    int    `json:"points"`
}

// ExamPackage is the full decrypted payload for one exam.
type ExamPackage struct {
	ExamID                string     `json:"exam_id"`
	Title                 string     `json:"title"`
	DurationMinutes       int        `json:"duration_minutes"`
	PassMark              float64    `json:"pass_mark"`
	QuestionsPerCandidate int        `json:"questions_per_candidate"`
	PublishMode           string     `json:"publish_mode"` // "immediate" | "instructor_controlled"
	Pool                  []PoolItem `json:"pool"`
}

// CandidateQuestion is one question exactly as a specific candidate sees it,
// after stage-2 (per-candidate) shuffling of order and MCQ option order.
type CandidateQuestion struct {
	QuestionItemID string
	Type           string
	Topic          string
	Source         string
	Stem           string
	Options        []string // nil for theory
	CorrectIndex   *int     // nil for theory
	ModelAnswer    *string  // nil for MCQ
	Rubric         []Rubric // nil for MCQ
}
