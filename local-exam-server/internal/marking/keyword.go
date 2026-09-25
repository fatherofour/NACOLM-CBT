// Package marking scores theory answers offline, deterministically, with
// no AI — a keyword marking scheme the instructor writes once per theory
// question, the same shape as an examiner's paper marking guide ("award 2
// marks for mentioning fuel resupply") made machine-checkable.
//
// This produces a PROVISIONAL score only. The event log (MatchedGroups /
// MissingGroups) is what makes a mark defensible before a review board —
// "credited convoy control and route security; missing timing and fuel" —
// but the engine cannot judge whether the reasoning stringing the keywords
// together is actually sound, so every score here is meant to sit in an
// instructor review queue before results are released, the same as
// AI-suggested marks would.
package marking

import (
	"math"
	"strings"
)

// ConceptGroup is one markable idea in the answer: a canonical term plus
// any synonyms, all equally acceptable — the instructor already decided
// what a good answer contains, the engine just checks for it.
type ConceptGroup struct {
	Label    string   // shown to the instructor/candidate on dispute, not matched against
	Terms    []string // canonical term + synonyms, e.g. ["control", "coordination", "command"]
	Marks    int
	Required bool // if absent, the whole question's score is capped — see Scheme.RequiredGroupCeilingPercent
}

type Scheme struct {
	TotalMarks int
	Groups     []ConceptGroup

	// If a Required group is absent, the score is capped at this percent of
	// TotalMarks even if every optional group matched — stops a candidate
	// padding an answer with buzzwords while missing the actual point.
	RequiredGroupCeilingPercent float64

	// Answers shorter than this (by word count, after normalization) are
	// flagged rather than auto-credited, even if they happen to contain the
	// right words — a handful of isolated keywords with no sentence around
	// them shouldn't score like a real answer.
	MinWordCount int
}

type Result struct {
	Score                int
	MaxScore             int
	MatchedGroups        []string // group Labels, for a defensible "credited X and Y" explanation
	MissingGroups        []string
	RequiredGroupMissing bool
	FlaggedTooShort      bool // if true, Score is forced to 0 regardless of matches — needs human review
	WordCount            int
}

// Score marks one candidate answer against a scheme. Deterministic: the
// same answer against the same scheme always produces the same result, and
// every credited/missing group is reported so the mark can be explained.
func Score(answer string, scheme Scheme) Result {
	tokens := tokenize(answer)
	wordCount := len(tokens)
	tooShort := wordCount < scheme.MinWordCount

	var matched, missing []string
	raw := 0
	requiredMissing := false

	for _, group := range scheme.Groups {
		if matchesGroup(tokens, group) {
			matched = append(matched, group.Label)
			raw += group.Marks
		} else {
			missing = append(missing, group.Label)
			if group.Required {
				requiredMissing = true
			}
		}
	}

	score := raw
	if requiredMissing {
		ceiling := int(math.Floor(float64(scheme.TotalMarks) * scheme.RequiredGroupCeilingPercent / 100.0))
		if score > ceiling {
			score = ceiling
		}
	}
	if score > scheme.TotalMarks {
		score = scheme.TotalMarks
	}
	if tooShort {
		// Deliberately zeroed, not just flagged-but-scored: an answer this
		// short auto-crediting any marks at all is the exact keyword-stuffing
		// failure mode this guard exists to close.
		score = 0
	}

	return Result{
		Score:                score,
		MaxScore:             scheme.TotalMarks,
		MatchedGroups:        matched,
		MissingGroups:        missing,
		RequiredGroupMissing: requiredMissing,
		FlaggedTooShort:      tooShort,
		WordCount:            wordCount,
	}
}

func matchesGroup(tokens []string, group ConceptGroup) bool {
	for _, term := range group.Terms {
		if termPresent(tokens, term) {
			return true // first hit counts — repeating a word doesn't add marks
		}
	}
	return false
}

// termPresent checks a (possibly multi-word) term against the answer's
// tokens. Multi-word terms ("ambush risk") match if every word in the term
// appears somewhere in the answer, not necessarily adjacent — simpler than
// phrase matching and forgiving of how a candidate actually phrases it.
func termPresent(tokens []string, term string) bool {
	for _, termWord := range strings.Fields(strings.ToLower(term)) {
		found := false
		for _, tok := range tokens {
			if wordMatches(termWord, tok) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

// wordMatches is deliberately a simple heuristic, not a real stemmer: exact
// match, or a shared 4+ character prefix (so "convoy"/"convoys" and
// "secured"/"security" match without a dictionary). Known limitation: it
// won't bridge irregular pairs like "timing"/"timed" (English drops the e
// before -ing) — the instructor's synonym list is the primary defense
// against that gap, this is just a nice-to-have on top of it.
func wordMatches(term, candidate string) bool {
	if term == candidate {
		return true
	}
	const prefixLen = 4
	if len(term) < prefixLen || len(candidate) < prefixLen {
		return false
	}
	return term[:prefixLen] == candidate[:prefixLen]
}

func tokenize(text string) []string {
	normalized := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == ' ':
			return r
		case r >= 'A' && r <= 'Z':
			return r + ('a' - 'A')
		default:
			return ' ' // strip punctuation by turning it into a separator
		}
	}, text)
	return strings.Fields(normalized)
}
