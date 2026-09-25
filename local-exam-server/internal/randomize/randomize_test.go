package randomize

import (
	"reflect"
	"sort"
	"testing"

	"cbt.army.mil.ng/local-exam-server/internal/models"
)

func intPtr(v int) *int { return &v }

func mcqPool(n int) []models.PoolItem {
	pool := make([]models.PoolItem, n)
	for i := range pool {
		pool[i] = models.PoolItem{
			ID:           "q" + string(rune('a'+i)),
			Type:         "mcq",
			Topic:        "OSI Model",
			Source:       "past_question",
			Stem:         "Which layer handles routing?",
			Options:      []string{"Physical", "Data Link", "Network", "Transport"},
			CorrectIndex: intPtr(2), // "Network"
		}
	}
	return pool
}

func testSalt() []byte { return []byte("test-salt") }

func TestGenerateInstance_DeterministicForSameSeed(t *testing.T) {
	pool := mcqPool(10)
	first, err := GenerateInstance(pool, 42, 5, nil)
	if err != nil {
		t.Fatal(err)
	}
	second, err := GenerateInstance(pool, 42, 5, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("same seed produced different instances:\n%+v\n%+v", first, second)
	}
}

func TestGenerateInstance_DifferentSeedsUsuallyDiffer(t *testing.T) {
	pool := mcqPool(20)
	a, err := GenerateInstance(pool, 1, 8, nil)
	if err != nil {
		t.Fatal(err)
	}
	b, err := GenerateInstance(pool, 2, 8, nil)
	if err != nil {
		t.Fatal(err)
	}

	sameOrder := true
	for i := range a {
		if a[i].QuestionItemID != b[i].QuestionItemID {
			sameOrder = false
			break
		}
	}
	if sameOrder {
		t.Fatal("two different seeds produced the exact same question order")
	}
}

func TestGenerateInstance_CorrectAnswerSurvivesShuffle(t *testing.T) {
	pool := mcqPool(1)
	original := pool[0].Options[*pool[0].CorrectIndex]
	if original != "Network" {
		t.Fatalf("test setup broken: expected 'Network', got %q", original)
	}

	for seed := int64(0); seed < 200; seed++ {
		instances, err := GenerateInstance(pool, seed, 1, nil)
		if err != nil {
			t.Fatal(err)
		}
		instance := instances[0]
		if instance.CorrectIndex == nil {
			t.Fatalf("seed %d: correct index missing after shuffle", seed)
		}
		got := instance.Options[*instance.CorrectIndex]
		if got != "Network" {
			t.Fatalf("seed %d: correct_index points at %q, want %q", seed, got, "Network")
		}

		gotSorted := append([]string{}, instance.Options...)
		wantSorted := append([]string{}, pool[0].Options...)
		sort.Strings(gotSorted)
		sort.Strings(wantSorted)
		if !reflect.DeepEqual(gotSorted, wantSorted) {
			t.Fatalf("seed %d: option set changed after shuffle: got %v want %v", seed, gotSorted, wantSorted)
		}
	}
}

func TestGenerateInstance_TheoryKeepsRubricAndModelAnswer(t *testing.T) {
	answer := "Subnetting isolates broadcast domains."
	pool := []models.PoolItem{
		{
			ID:          "q-theory-1",
			Type:        "theory",
			Topic:       "Subnetting",
			Source:      "ai_generated",
			Stem:        "Explain subnetting.",
			ModelAnswer: &answer,
			Rubric:      []models.Rubric{{Criterion: "mentions broadcast domains", Points: 5}},
		},
	}

	instances, err := GenerateInstance(pool, 1, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	instance := instances[0]

	if instance.Options != nil {
		t.Fatalf("expected nil options for theory question, got %v", instance.Options)
	}
	if instance.CorrectIndex != nil {
		t.Fatalf("expected nil correct index for theory question, got %v", *instance.CorrectIndex)
	}
	if instance.ModelAnswer == nil || *instance.ModelAnswer != answer {
		t.Fatalf("model answer not preserved: got %v", instance.ModelAnswer)
	}
	if len(instance.Rubric) != 1 || instance.Rubric[0].Points != 5 {
		t.Fatalf("rubric not preserved: got %+v", instance.Rubric)
	}
}

func TestGenerateInstance_ErrorsWhenPoolTooSmall(t *testing.T) {
	pool := mcqPool(3)
	if _, err := GenerateInstance(pool, 1, 5, nil); err == nil {
		t.Fatal("expected an error when the pool is smaller than the requested count")
	}
}

// --- topic stratification ---------------------------------------------

func twoTopicPool(networkingCount, securityCount int) []models.PoolItem {
	pool := make([]models.PoolItem, 0, networkingCount+securityCount)
	for i := 0; i < networkingCount; i++ {
		pool = append(pool, models.PoolItem{
			ID: "net" + string(rune('a'+i)), Type: "mcq", Topic: "Networking",
			Options: []string{"A", "B"}, CorrectIndex: intPtr(0),
		})
	}
	for i := 0; i < securityCount; i++ {
		pool = append(pool, models.PoolItem{
			ID: "sec" + string(rune('a'+i)), Type: "mcq", Topic: "Security",
			Options: []string{"A", "B"}, CorrectIndex: intPtr(0),
		})
	}
	return pool
}

func TestGenerateInstance_StratifiesByTopicProportionally(t *testing.T) {
	// Pool is 80% Networking / 20% Security. A candidate's 10-question
	// paper should land close to that split, not be left to pure chance
	// (which could hand someone an all-Security paper).
	pool := twoTopicPool(40, 10)

	for seed := int64(0); seed < 20; seed++ {
		instances, err := GenerateInstance(pool, seed, 10, nil)
		if err != nil {
			t.Fatal(err)
		}
		networking := 0
		for _, inst := range instances {
			if inst.Topic == "Networking" {
				networking++
			}
		}
		// Expect 8/10 networking; allow +/-1 for rounding.
		if networking < 7 || networking > 9 {
			t.Fatalf("seed %d: expected ~8 networking questions out of 10, got %d", seed, networking)
		}
	}
}

func TestGenerateInstance_BackfillsWhenATopicIsThin(t *testing.T) {
	// Only 1 Security question exists but proportional allocation would
	// want ~2 out of 10 — the shortfall must be silently backfilled from
	// Networking rather than erroring out.
	pool := twoTopicPool(20, 1)

	instances, err := GenerateInstance(pool, 7, 10, nil)
	if err != nil {
		t.Fatalf("expected backfill to avoid an error, got: %v", err)
	}
	if len(instances) != 10 {
		t.Fatalf("expected 10 questions, got %d", len(instances))
	}
}

// --- exposure control ---------------------------------------------------

func TestGenerateInstance_ExposureControlBalancesDrawsAcrossCandidates(t *testing.T) {
	pool := mcqPool(10) // single topic, 10 items, all initially unused

	exposure := map[string]int{}
	const candidates = 30
	const perCandidate = 5 // 30*5 = 150 draws over 10 items => 15 each if perfectly balanced

	for i := 0; i < candidates; i++ {
		instances, err := GenerateInstance(pool, int64(i), perCandidate, exposure)
		if err != nil {
			t.Fatal(err)
		}
		for _, inst := range instances {
			exposure[inst.QuestionItemID]++
		}
	}

	min, max := -1, -1
	for _, count := range exposure {
		if min == -1 || count < min {
			min = count
		}
		if max == -1 || count > max {
			max = count
		}
	}
	// Exposure-weighted sampling should keep this far tighter than a naive
	// independent random draw would (which can easily produce a 2x+ spread
	// at this sample size).
	if max-min > 3 {
		t.Fatalf("exposure spread too wide: min=%d max=%d counts=%v", min, max, exposure)
	}
}

// --- theory rubric / model answer preserved through stratification ------

func TestDeriveSeed_SameInputsSameSeed(t *testing.T) {
	if DeriveSeed("exam-1", "candidate-1", testSalt()) != DeriveSeed("exam-1", "candidate-1", testSalt()) {
		t.Fatal("DeriveSeed is not deterministic for identical inputs")
	}
}

func TestDeriveSeed_DifferentCandidatesDifferentSeeds(t *testing.T) {
	if DeriveSeed("exam-1", "candidate-1", testSalt()) == DeriveSeed("exam-1", "candidate-2", testSalt()) {
		t.Fatal("two different candidates produced the same seed")
	}
}

func TestDeriveSeed_DifferentSaltsDifferentSeeds(t *testing.T) {
	// This is the unpredictability property: the same exam id and candidate
	// id produce a different seed once the (only-known-at-release) salt
	// changes, so nothing about the draw can be precomputed before release.
	a := DeriveSeed("exam-1", "candidate-1", []byte("salt-a"))
	b := DeriveSeed("exam-1", "candidate-1", []byte("salt-b"))
	if a == b {
		t.Fatal("different salts produced the same seed")
	}
}
