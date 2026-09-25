package store

import (
	"testing"

	"cbt.army.mil.ng/local-exam-server/internal/models"
)

func intPtr(v int) *int { return &v }

func TestCheckInLoadAnswerAndAutoMark(t *testing.T) {
	s, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.Close()

	questions := []models.CandidateQuestion{
		{QuestionItemID: "q1", Type: "mcq", Stem: "1+1=?", Options: []string{"1", "2", "3"}, CorrectIndex: intPtr(1)},
		{QuestionItemID: "q2", Type: "mcq", Stem: "2+2=?", Options: []string{"3", "4", "5"}, CorrectIndex: intPtr(1)},
	}
	if err := s.CheckIn("exam-1", "cand-1", questions); err != nil {
		t.Fatalf("CheckIn: %v", err)
	}

	paper, err := s.LoadCandidatePaper("exam-1", "cand-1")
	if err != nil {
		t.Fatalf("LoadCandidatePaper: %v", err)
	}
	if len(paper) != 2 {
		t.Fatalf("expected 2 questions, got %d", len(paper))
	}
	if len(paper[0].Options) != 3 {
		t.Fatalf("expected options to load back, got %v", paper[0].Options)
	}

	// Candidate gets question 0 right, question 1 wrong.
	if err := s.RecordResponse("exam-1", "cand-1", 0, intPtr(1), nil); err != nil {
		t.Fatalf("RecordResponse: %v", err)
	}
	if err := s.RecordResponse("exam-1", "cand-1", 1, intPtr(0), nil); err != nil {
		t.Fatalf("RecordResponse: %v", err)
	}

	correct, total, err := s.AutoMarkMCQ("exam-1", "cand-1")
	if err != nil {
		t.Fatalf("AutoMarkMCQ: %v", err)
	}
	if total != 2 {
		t.Fatalf("expected 2 mcq questions marked, got %d", total)
	}
	if correct != 1 {
		t.Fatalf("expected 1 correct answer, got %d", correct)
	}
}

func TestCheckInIsIdempotent(t *testing.T) {
	s, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.Close()

	questions := []models.CandidateQuestion{
		{QuestionItemID: "q1", Type: "mcq", Stem: "1+1=?", Options: []string{"1", "2"}, CorrectIndex: intPtr(1)},
	}
	if err := s.CheckIn("exam-1", "cand-1", questions); err != nil {
		t.Fatalf("first CheckIn: %v", err)
	}
	// Re-checking in (e.g. after the kiosk app restarts) must not duplicate rows.
	if err := s.CheckIn("exam-1", "cand-1", questions); err != nil {
		t.Fatalf("second CheckIn: %v", err)
	}

	paper, err := s.LoadCandidatePaper("exam-1", "cand-1")
	if err != nil {
		t.Fatalf("LoadCandidatePaper: %v", err)
	}
	if len(paper) != 1 {
		t.Fatalf("expected check-in to be idempotent, got %d rows", len(paper))
	}
}
