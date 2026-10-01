package store

import (
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"cbt.army.mil.ng/local-exam-server/internal/models"
)

// A full exam room saves answers and reports events at the same moment.
// Every write must succeed; none may fail with "database is locked".
func TestConcurrentWritesFromAWholeRoom(t *testing.T) {
	st, err := Open(filepath.Join(t.TempDir(), "exam.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	const candidates = 40
	stem := func(i int) []models.CandidateQuestion {
		idx := 0
		return []models.CandidateQuestion{{QuestionItemID: fmt.Sprintf("q%d", i), Type: "mcq", Stem: "s", Options: []string{"a", "b"}, CorrectIndex: &idx}}
	}
	for i := 0; i < candidates; i++ {
		if err := st.CheckIn("exam", fmt.Sprintf("NA/%d", i), stem(i)); err != nil {
			t.Fatal(err)
		}
	}

	var wg sync.WaitGroup
	errs := make(chan error, candidates*30)
	for i := 0; i < candidates; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			c := fmt.Sprintf("NA/%d", i)
			for n := 0; n < 10; n++ {
				sel := n % 2
				if err := st.RecordResponse("exam", c, 1, &sel, nil); err != nil {
					errs <- fmt.Errorf("answer: %w", err)
				}
				if err := st.RecordViolation("exam", c, "window_blur", "", true, time.Now()); err != nil {
					errs <- fmt.Errorf("event: %w", err)
				}
				if _, err := st.CountedSerious("exam", c); err != nil {
					errs <- fmt.Errorf("count: %w", err)
				}
			}
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
}
