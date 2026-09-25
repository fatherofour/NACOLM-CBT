package marking

import (
	"reflect"
	"testing"
)

// The exact worked example from the design: a 10-mark question on convoy
// movement orders, with two required groups.
func convoyScheme() Scheme {
	return Scheme{
		TotalMarks: 10,
		Groups: []ConceptGroup{
			{Label: "Convoy control / coordination", Terms: []string{"control", "coordination", "command"}, Marks: 2, Required: true},
			{Label: "Timing / synchronisation", Terms: []string{"timing", "schedule", "synchronise", "eta"}, Marks: 2, Required: false},
			{Label: "Route security", Terms: []string{"security", "ambush risk", "threat"}, Marks: 2, Required: true},
			{Label: "Terrain / road condition", Terms: []string{"terrain", "road condition", "gradient"}, Marks: 2, Required: false},
			{Label: "Fuel / resupply", Terms: []string{"fuel", "pol", "resupply", "refuel"}, Marks: 2, Required: false},
		},
		RequiredGroupCeilingPercent: 50,
		MinWordCount:                15,
	}
}

func TestScore_FullAnswerCreditsAllGroups(t *testing.T) {
	answer := "The convoy movement order establishes control and coordination of the convoy, " +
		"addresses route security against ambush risk, accounts for terrain and road condition, " +
		"sets timing for synchronisation, and plans fuel resupply for the whole journey."

	result := Score(answer, convoyScheme())

	if result.Score != 10 {
		t.Fatalf("expected full 10 marks, got %d (matched=%v missing=%v)", result.Score, result.MatchedGroups, result.MissingGroups)
	}
	if result.RequiredGroupMissing {
		t.Fatal("no required group should be missing")
	}
	if result.FlaggedTooShort {
		t.Fatal("answer is long enough, should not be flagged as too short")
	}
	if len(result.MatchedGroups) != 5 {
		t.Fatalf("expected all 5 groups matched, got %v", result.MatchedGroups)
	}
}

func TestScore_MissingRequiredGroupCapsScoreAtCeiling(t *testing.T) {
	// Covers all 4 optional/other groups (8 raw marks) but never mentions
	// convoy control/coordination/command — the required group.
	answer := "It addresses route security against ambush risk, accounts for terrain and road condition, " +
		"sets timing for synchronisation, and plans fuel resupply for the whole journey which takes several hours."

	result := Score(answer, convoyScheme())

	if !result.RequiredGroupMissing {
		t.Fatal("expected the required 'Convoy control / coordination' group to be reported missing")
	}
	// Raw would be 8 (4 groups x 2 marks); the 50% ceiling on a 10-mark
	// question caps it at 5, even though every optional group matched.
	if result.Score != 5 {
		t.Fatalf("expected score capped at ceiling (5), got %d", result.Score)
	}
	if !contains(result.MissingGroups, "Convoy control / coordination") {
		t.Fatalf("expected missing groups to name the required group, got %v", result.MissingGroups)
	}
}

func TestScore_RepeatingAKeywordDoesNotAddMarks(t *testing.T) {
	// Anti-gaming: the same word repeated many times, in a long enough
	// answer to dodge the length guard, must still only credit once.
	answer := "security security security security security security security security " +
		"security security security security security security security security security security security security"

	result := Score(answer, convoyScheme())

	if result.WordCount < 15 {
		t.Fatalf("test setup broken: answer should be long enough to avoid the short-answer guard, got %d words", result.WordCount)
	}
	if result.FlaggedTooShort {
		t.Fatal("this answer should be long enough not to be flagged")
	}
	// Only "Route security" matches; required "Convoy control" is missing,
	// so the ceiling (5) applies but has no effect since raw (2) is already below it.
	if result.Score != 2 {
		t.Fatalf("expected keyword stuffing to be worth exactly one group's marks (2), got %d", result.Score)
	}
	if len(result.MatchedGroups) != 1 {
		t.Fatalf("expected exactly 1 matched group despite dozens of repeats, got %v", result.MatchedGroups)
	}
}

func TestScore_ShortAnswerIsFlaggedAndScoredZeroEvenIfKeywordsPresent(t *testing.T) {
	// Five isolated keywords, no real sentence — must not auto-credit.
	answer := "control security timing terrain fuel"

	result := Score(answer, convoyScheme())

	if !result.FlaggedTooShort {
		t.Fatal("expected a 5-word answer to be flagged as too short")
	}
	if result.Score != 0 {
		t.Fatalf("expected a too-short answer to score 0 regardless of keyword matches, got %d", result.Score)
	}
	// Still reports what it found, for the instructor reviewing the flag.
	if len(result.MatchedGroups) != 5 {
		t.Fatalf("expected matched groups still reported for a flagged answer, got %v", result.MatchedGroups)
	}
}

func TestScore_LightStemmingMatchesStatedExamples(t *testing.T) {
	// The two examples the design explicitly calls out: convoy/convoys and
	// secured/security should both match via the light prefix heuristic.
	answer := "The convoys were secured throughout the route to prevent any incident along the way today."

	result := Score(answer, convoyScheme())

	if !contains(result.MatchedGroups, "Route security") {
		t.Fatalf("expected 'secured' to match the 'security' term via light stemming, matched=%v", result.MatchedGroups)
	}
}

func TestScore_MultiWordSynonymMatchesWhenWordsAppearAnywhereInAnswer(t *testing.T) {
	answer := "There is a significant risk of ambush along this stretch of road which must be planned for carefully in advance."

	result := Score(answer, convoyScheme())

	if !contains(result.MatchedGroups, "Route security") {
		t.Fatalf("expected 'ambush' + 'risk' (in either order) to match the 'ambush risk' synonym, matched=%v", result.MatchedGroups)
	}
}

func TestScore_NeverExceedsTotalMarks(t *testing.T) {
	scheme := Scheme{
		TotalMarks: 3,
		Groups: []ConceptGroup{
			{Label: "A", Terms: []string{"alpha"}, Marks: 2},
			{Label: "B", Terms: []string{"beta"}, Marks: 2},
		},
		RequiredGroupCeilingPercent: 100,
		MinWordCount:                1,
	}
	result := Score("alpha and beta both appear in this answer for the test", scheme)
	if result.Score != 3 {
		t.Fatalf("expected score capped at TotalMarks=3, got %d", result.Score)
	}
}

func contains(items []string, target string) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
}

func TestScore_IsDeterministic(t *testing.T) {
	answer := "control coordination security terrain fuel timing all mentioned here in a reasonably long sentence for good measure."
	a := Score(answer, convoyScheme())
	b := Score(answer, convoyScheme())
	if !reflect.DeepEqual(a, b) {
		t.Fatalf("scoring the same answer twice produced different results:\n%+v\n%+v", a, b)
	}
}
