// Package randomize is the offline, per-candidate draw: stage 2 of the
// two-stage selection described in
// central-api/app/services/question_selection.py. Stage 1 (run centrally,
// before the package is even built) picks a pool larger than any one
// candidate needs, mixing past-question and study-material-derived
// questions. This package draws one candidate's actual paper from that
// pool, entirely offline, with three properties layered on top of a plain
// random draw:
//
//   - Topic-stratified: each candidate's paper matches the pool's overall
//     topic proportions, so no one gets an accidentally lopsided paper
//     (all networking, none security) purely by luck of the draw.
//   - Exposure-controlled: draws are weighted against how often an item has
//     already been given out this sitting, so coverage of the pool stays
//     balanced across the whole cohort instead of drifting on chance —
//     the same recency-weighting idea used centrally in
//     question_selection.py's stage-1 pool build, applied here within one
//     exam sitting instead of across sessions.
//   - Unpredictable before release: the seed mixes in a per-sitting salt
//     that doesn't exist until the exam is actually released (see
//     Store.GetOrCreateSalt), so knowing the exam id and candidate id ahead
//     of time is not enough to predict any candidate's question order.
package randomize

import (
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"math"
	"math/rand"
	"sort"

	"cbt.army.mil.ng/local-exam-server/internal/models"
)

// DeriveSeed makes the per-candidate draw reproducible for a given sitting
// (so re-generating an instance after a kiosk restart gives the same
// candidate the same paper) while remaining unpredictable ahead of time:
// salt is generated only at release, never before.
func DeriveSeed(examID, candidateID string, salt []byte) int64 {
	h := sha256.New()
	h.Write([]byte(examID))
	h.Write([]byte{0})
	h.Write([]byte(candidateID))
	h.Write([]byte{0})
	h.Write(salt)
	sum := h.Sum(nil)
	return int64(binary.BigEndian.Uint64(sum[:8]))
}

// GenerateInstance draws `count` questions for one candidate from `pool`,
// stratified by topic and weighted against exposureCounts (question item id
// -> number of times already drawn this sitting; a missing entry means 0).
// Final question order and, for MCQ items, option order are then shuffled.
func GenerateInstance(
	pool []models.PoolItem, seed int64, count int, exposureCounts map[string]int,
) ([]models.CandidateQuestion, error) {
	if len(pool) < count {
		return nil, fmt.Errorf("insufficient pool: need %d questions, only %d available", count, len(pool))
	}
	if exposureCounts == nil {
		exposureCounts = map[string]int{}
	}

	rng := rand.New(rand.NewSource(seed))
	// Squared falloff: a mildly-overused item is only somewhat less likely
	// to be drawn again, but a heavily-overused one becomes sharply less
	// likely — this keeps exposure balanced across the cohort much tighter
	// than a linear 1/(1+n) penalty does.
	weight := func(item models.PoolItem) float64 {
		n := float64(1 + exposureCounts[item.ID])
		return 1.0 / (n * n)
	}

	chosen := stratifiedExposureSample(rng, pool, count, weight)
	rng.Shuffle(len(chosen), func(i, j int) { chosen[i], chosen[j] = chosen[j], chosen[i] })

	result := make([]models.CandidateQuestion, 0, count)
	for _, item := range chosen {
		cq := models.CandidateQuestion{
			QuestionItemID: item.ID,
			Type:           item.Type,
			Topic:          item.Topic,
			Source:         item.Source,
			Stem:           item.Stem,
		}
		if item.Type == "mcq" {
			cq.Options, cq.CorrectIndex = shuffleOptions(rng, item.Options, item.CorrectIndex)
		} else {
			cq.ModelAnswer = item.ModelAnswer
			cq.Rubric = item.Rubric
		}
		result = append(result, cq)
	}
	return result, nil
}

// stratifiedExposureSample allocates `count` draws across the pool's topics
// proportional to each topic's share of the pool (largest-remainder
// rounding so the allocation sums to exactly `count`), then draws within
// each topic with exposure-weighted sampling without replacement. If a
// topic doesn't have enough items to fill its allocation, the shortfall is
// backfilled from whatever's left in the rest of the pool, so a lopsided
// pool never causes a hard failure.
func stratifiedExposureSample(
	rng *rand.Rand, pool []models.PoolItem, count int, weight func(models.PoolItem) float64,
) []models.PoolItem {
	byTopic := map[string][]models.PoolItem{}
	for _, item := range pool {
		byTopic[item.Topic] = append(byTopic[item.Topic], item)
	}

	allocation := allocateByTopic(byTopic, len(pool), count)

	selected := make([]models.PoolItem, 0, count)
	usedID := map[string]bool{}

	topics := make([]string, 0, len(byTopic))
	for topic := range byTopic {
		topics = append(topics, topic)
	}
	sort.Strings(topics)

	for _, topic := range topics {
		want := allocation[topic]
		if want == 0 {
			continue
		}
		drawn := weightedSampleWithoutReplacement(rng, byTopic[topic], want, weight)
		for _, item := range drawn {
			selected = append(selected, item)
			usedID[item.ID] = true
		}
	}

	shortfall := count - len(selected)
	if shortfall > 0 {
		var remaining []models.PoolItem
		for _, item := range pool {
			if !usedID[item.ID] {
				remaining = append(remaining, item)
			}
		}
		selected = append(selected, weightedSampleWithoutReplacement(rng, remaining, shortfall, weight)...)
	}

	return selected
}

// allocateByTopic splits `count` proportional to each topic's share of the
// pool using the largest-remainder method, so the allocation always sums to
// exactly `count` (ordinary rounding wouldn't guarantee that).
func allocateByTopic(byTopic map[string][]models.PoolItem, poolSize, count int) map[string]int {
	topics := make([]string, 0, len(byTopic))
	for topic := range byTopic {
		topics = append(topics, topic)
	}
	sort.Strings(topics)

	type share struct {
		topic     string
		floor     int
		remainder float64
	}
	shares := make([]share, 0, len(topics))
	sumFloor := 0
	for _, topic := range topics {
		exact := float64(len(byTopic[topic])) / float64(poolSize) * float64(count)
		floor := int(math.Floor(exact))
		shares = append(shares, share{topic: topic, floor: floor, remainder: exact - float64(floor)})
		sumFloor += floor
	}

	sort.SliceStable(shares, func(i, j int) bool { return shares[i].remainder > shares[j].remainder })

	remaining := count - sumFloor
	allocation := make(map[string]int, len(shares))
	for i, s := range shares {
		c := s.floor
		if i < remaining {
			c++
		}
		allocation[s.topic] = c
	}
	return allocation
}

func weightedSampleWithoutReplacement(
	rng *rand.Rand, items []models.PoolItem, k int, weight func(models.PoolItem) float64,
) []models.PoolItem {
	if k > len(items) {
		k = len(items)
	}
	remaining := make([]models.PoolItem, len(items))
	copy(remaining, items)

	selected := make([]models.PoolItem, 0, k)
	for i := 0; i < k; i++ {
		total := 0.0
		weights := make([]float64, len(remaining))
		for i, item := range remaining {
			w := weight(item)
			weights[i] = w
			total += w
		}
		r := rng.Float64() * total
		idx := len(remaining) - 1 // guard against float rounding landing past the last cumulative bucket
		cum := 0.0
		for i, w := range weights {
			cum += w
			if r <= cum {
				idx = i
				break
			}
		}
		selected = append(selected, remaining[idx])
		remaining = append(remaining[:idx], remaining[idx+1:]...)
	}
	return selected
}

func shuffleOptions(rng *rand.Rand, options []string, originalCorrectIndex *int) ([]string, *int) {
	order := rng.Perm(len(options))
	shuffled := make([]string, len(options))
	var newCorrectIndex *int
	for newPos, origPos := range order {
		shuffled[newPos] = options[origPos]
		if originalCorrectIndex != nil && origPos == *originalCorrectIndex {
			pos := newPos
			newCorrectIndex = &pos
		}
	}
	return shuffled, newCorrectIndex
}
