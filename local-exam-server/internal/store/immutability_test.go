package store

import (
	"strings"
	"testing"
	"time"

	"cbt.army.mil.ng/local-exam-server/internal/models"
)

func checkInOneMCQ(t *testing.T, s *Store, examID, candidateID string) {
	t.Helper()
	questions := []models.CandidateQuestion{
		{QuestionItemID: "q1", Type: "mcq", Stem: "1+1=?", Options: []string{"1", "2", "3"}, CorrectIndex: intPtr(1)},
	}
	if err := s.CheckIn(examID, candidateID, questions); err != nil {
		t.Fatalf("CheckIn: %v", err)
	}
}

func TestResponsesAreLockedAfterSubmit(t *testing.T) {
	s, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.Close()

	checkInOneMCQ(t, s, "exam-1", "cand-1")
	if err := s.RecordResponse("exam-1", "cand-1", 0, intPtr(1), nil); err != nil {
		t.Fatalf("RecordResponse before submit: %v", err)
	}

	submitted, err := s.MarkSubmitted("exam-1", "cand-1", "AB-CD", time.Now())
	if err != nil {
		t.Fatalf("MarkSubmitted: %v", err)
	}
	if !submitted {
		t.Fatalf("expected first MarkSubmitted to report submitted=true")
	}

	// The candidate (or anything else writing through the normal API) must
	// not be able to change an answer after submission — trg_lock_responses_after_submit
	// should reject this at the database layer.
	err = s.RecordResponse("exam-1", "cand-1", 0, intPtr(2), nil)
	if err == nil {
		t.Fatal("expected RecordResponse to fail after submission, but it succeeded")
	}
	if !strings.Contains(err.Error(), "immutable") {
		t.Fatalf("expected an immutability error, got: %v", err)
	}

	// Marking (is_correct) must still be writable after submission — that's
	// the system's output, not the candidate's answer.
	if _, _, err := s.AutoMarkMCQ("exam-1", "cand-1"); err != nil {
		t.Fatalf("AutoMarkMCQ after submit should still work: %v", err)
	}
}

func TestSubmittedAtCannotBeChangedOnceSet(t *testing.T) {
	s, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.Close()

	checkInOneMCQ(t, s, "exam-1", "cand-1")
	first := time.Now().Add(-time.Hour)
	if _, err := s.MarkSubmitted("exam-1", "cand-1", "AB-CD", first); err != nil {
		t.Fatalf("first MarkSubmitted: %v", err)
	}

	// A retried submit (flaky kiosk network, double-click) must be a no-op,
	// not silently push the recorded submission time forward.
	again, err := s.MarkSubmitted("exam-1", "cand-1", "WX-YZ", time.Now())
	if err != nil {
		t.Fatalf("second MarkSubmitted should be a no-op, not an error: %v", err)
	}
	if again {
		t.Fatal("expected second MarkSubmitted to report submitted=false (already submitted)")
	}

	st, err := s.GetSessionState("exam-1", "cand-1")
	if err != nil {
		t.Fatalf("GetSessionState: %v", err)
	}
	if st.Reference != "AB-CD" {
		t.Fatalf("expected the original reference to survive, got %q", st.Reference)
	}
	if st.SubmittedAt == nil || !st.SubmittedAt.Equal(first.UTC().Truncate(time.Second)) {
		t.Fatalf("expected the original submission time to survive, got %v", st.SubmittedAt)
	}
}

func TestResponseHashReflectsFinalAnswers(t *testing.T) {
	s, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.Close()

	checkInOneMCQ(t, s, "exam-1", "cand-1")
	checkInOneMCQ(t, s, "exam-1", "cand-2")

	if err := s.RecordResponse("exam-1", "cand-1", 0, intPtr(1), nil); err != nil {
		t.Fatal(err)
	}
	if err := s.RecordResponse("exam-1", "cand-2", 0, intPtr(0), nil); err != nil {
		t.Fatal(err)
	}
	if _, err := s.MarkSubmitted("exam-1", "cand-1", "AB-CD", time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := s.MarkSubmitted("exam-1", "cand-2", "EF-GH", time.Now()); err != nil {
		t.Fatal(err)
	}

	st1, _ := s.GetSessionState("exam-1", "cand-1")
	st2, _ := s.GetSessionState("exam-1", "cand-2")
	if st1.ResponseHash == "" || st2.ResponseHash == "" {
		t.Fatal("expected both candidates to get a response_hash on submit")
	}
	if st1.ResponseHash == st2.ResponseHash {
		t.Fatal("candidates with different answers should not hash the same")
	}
}
