package api

// The results file the invigilator downloads after the sitting and the exam
// officer imports into the portal. The payload is signed with an HMAC key
// that only the portal and the (encrypted) package know, so the portal can
// tell whether the file was changed on the way.

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"cbt.army.mil.ng/local-exam-server/internal/store"
)

const resultsFormat = "nacolm-results-v1"

type resultCandidate struct {
	ServiceNumber    string             `json:"service_number"`
	SubmittedAt      time.Time          `json:"submitted_at"`
	Reference        string             `json:"reference"`
	ResponseHash     string             `json:"response_hash"`
	ObjectiveCorrect int                `json:"objective_correct"`
	ObjectiveTotal   int                `json:"objective_total"`
	Items            []store.ResultItem `json:"items"`
}

type resultsPayload struct {
	Format       string            `json:"format"`
	ExamID       string            `json:"exam_id"`
	Title        string            `json:"title"`
	Centre       string            `json:"centre"`
	ExportedAt   time.Time         `json:"exported_at"`
	Candidates   []resultCandidate `json:"candidates"`
	NotSubmitted []string          `json:"not_submitted"`
}

type resultsEnvelope struct {
	Format    string `json:"format"`
	ExamID    string `json:"exam_id"`
	Payload   string `json:"payload"`   // base64 of the exact signed JSON bytes
	Signature string `json:"signature"` // hex HMAC-SHA256 of those bytes
}

func signResults(keyHex string, payload []byte) (string, error) {
	key, err := hex.DecodeString(keyHex)
	if err != nil || len(key) < 16 {
		return "", fmt.Errorf("invalid results key in the package")
	}
	mac := hmac.New(sha256.New, key)
	mac.Write(payload)
	return hex.EncodeToString(mac.Sum(nil)), nil
}

func (s *Server) invigilatorResults(w http.ResponseWriter, r *http.Request) {
	pkg, _, released := s.isReleased()
	if !released {
		writeError(w, http.StatusConflict, "Open the exam first.")
		return
	}
	if pkg.ResultsKeyHex == "" {
		writeError(w, http.StatusConflict, "This exam package was built before signed results existed. Rebuild the package in the portal for the next sitting.")
		return
	}
	rs := s.rosterSnapshot()
	if rs == nil {
		writeError(w, http.StatusServiceUnavailable, "no roster loaded on this exam server")
		return
	}
	p := resultsPayload{Format: resultsFormat, ExamID: pkg.ExamID, Title: pkg.Title, Centre: s.cfg.CentreName, ExportedAt: time.Now().UTC(), Candidates: []resultCandidate{}, NotSubmitted: []string{}}
	for _, c := range rs.All() {
		st, err := s.store.GetSessionState(pkg.ExamID, c.ServiceNumber)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to load session state")
			return
		}
		if st.SubmittedAt == nil {
			p.NotSubmitted = append(p.NotSubmitted, c.ServiceNumber)
			continue
		}
		items, err := s.store.ResultItems(pkg.ExamID, c.ServiceNumber)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to load answers")
			return
		}
		rc := resultCandidate{ServiceNumber: c.ServiceNumber, SubmittedAt: *st.SubmittedAt, Reference: st.Reference, ResponseHash: st.ResponseHash, Items: items}
		for _, it := range items {
			if it.Type == "mcq" {
				rc.ObjectiveTotal++
				if it.Correct {
					rc.ObjectiveCorrect++
				}
			}
		}
		p.Candidates = append(p.Candidates, rc)
	}
	payload, err := json.Marshal(p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to build results")
		return
	}
	sig, err := signResults(pkg.ResultsKeyHex, payload)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.event("invigilator", "results_exported", fmt.Sprintf("%d submitted, %d not submitted", len(p.Candidates), len(p.NotSubmitted)), false)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="results-%s.json"`, safeFileName(pkg.ExamID)))
	writeJSON(w, http.StatusOK, resultsEnvelope{Format: resultsFormat, ExamID: pkg.ExamID, Payload: base64.StdEncoding.EncodeToString(payload), Signature: sig})
}
