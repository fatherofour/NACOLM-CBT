// Package api is the LAN-only HTTP surface the kiosk client and invigilator
// console talk to. Nothing here ever needs the internet.
package api

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"

	"cbt.army.mil.ng/local-exam-server/internal/config"
	"cbt.army.mil.ng/local-exam-server/internal/exam"
	"cbt.army.mil.ng/local-exam-server/internal/models"
	"cbt.army.mil.ng/local-exam-server/internal/store"
)

// Server holds the decrypted exam package only once it has been released —
// before that, the package sits on disk still encrypted, and check-in/submit
// are refused. This is the runtime side of the "time-locked release key"
// from the architecture: possessing the file is not enough, exam start must
// actually trigger release.
type Server struct {
	cfg   config.Config
	store *store.Store

	mu   sync.RWMutex
	pkg  *models.ExamPackage // nil until /release succeeds
	salt []byte              // per-sitting salt, set alongside pkg — see Store.GetOrCreateSalt

	kiosk *kioskState // candidate kiosk sign-in; see kiosk.go
}

func NewServer(cfg config.Config, st *store.Store) *Server {
	return &Server{cfg: cfg, store: st, kiosk: newKioskState()}
}

func (s *Server) Router() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("POST /release", s.handleRelease)
	mux.HandleFunc("POST /checkin", s.handleCheckIn)
	mux.HandleFunc("GET /paper", s.handlePaper)
	mux.HandleFunc("POST /submit", s.handleSubmit)
	s.registerKiosk(mux)
	return mux
}

func (s *Server) isReleased() (*models.ExamPackage, []byte, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.pkg, s.salt, s.pkg != nil
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	pkg, _, released := s.isReleased()
	resp := map[string]any{"status": "ok", "exam_released": released}
	if released {
		resp["exam_id"] = pkg.ExamID
		resp["title"] = pkg.Title
	}
	writeJSON(w, http.StatusOK, resp)
}

type releaseRequest struct {
	KeyHex string `json:"key_hex"`
}

// handleRelease is what the invigilator console calls at the scheduled
// start time, supplying the AES key from whatever out-of-band release
// mechanism the venue uses. Until this succeeds, no candidate can check in.
func (s *Server) handleRelease(w http.ResponseWriter, r *http.Request) {
	var req releaseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	key, err := hex.DecodeString(req.KeyHex)
	if err != nil {
		writeError(w, http.StatusBadRequest, "key_hex is not valid hex")
		return
	}

	pkg, err := exam.LoadPackage(s.cfg.PackagePath, s.cfg.ExamID, key)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "failed to decrypt package: "+err.Error())
		return
	}

	salt, err := s.store.GetOrCreateSalt(pkg.ExamID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to establish release salt: "+err.Error())
		return
	}

	s.mu.Lock()
	s.pkg = pkg
	s.salt = salt
	s.mu.Unlock()

	writeJSON(w, http.StatusOK, map[string]any{"released": true, "exam_id": pkg.ExamID, "title": pkg.Title})
}

type checkInRequest struct {
	CandidateID string `json:"candidate_id"`
}

func (s *Server) handleCheckIn(w http.ResponseWriter, r *http.Request) {
	pkg, salt, released := s.isReleased()
	if !released {
		writeError(w, http.StatusLocked, "exam has not been released yet")
		return
	}

	var req checkInRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.CandidateID == "" {
		writeError(w, http.StatusBadRequest, "candidate_id is required")
		return
	}

	if status, err := s.ensurePaper(pkg, salt, req.CandidateID); err != nil {
		writeError(w, status, err.Error())
		return
	}

	s.respondWithPaper(w, pkg.ExamID, req.CandidateID)
}

// ensurePaper draws and stores the candidate's paper on first check-in.
// Idempotent: a kiosk restart re-checking in an already-registered
// candidate gets back their existing paper, not a freshly (and differently)
// generated one, and exposure isn't double-counted.
func (s *Server) ensurePaper(pkg *models.ExamPackage, salt []byte, candidateID string) (int, error) {
	existing, err := s.store.LoadCandidatePaper(pkg.ExamID, candidateID)
	if err != nil {
		return http.StatusInternalServerError, fmt.Errorf("failed to check existing paper: %w", err)
	}
	if len(existing) > 0 {
		return 0, nil
	}

	exposureCounts, err := s.store.GetExposureCounts(pkg.ExamID)
	if err != nil {
		return http.StatusInternalServerError, fmt.Errorf("failed to load exposure counts: %w", err)
	}
	questions, err := exam.GenerateCandidateInstance(pkg, candidateID, salt, exposureCounts)
	if err != nil {
		return http.StatusUnprocessableEntity, err
	}
	if err := s.store.CheckIn(pkg.ExamID, candidateID, questions); err != nil {
		return http.StatusInternalServerError, fmt.Errorf("failed to record check-in: %w", err)
	}
	drawnIDs := make([]string, len(questions))
	for i, q := range questions {
		drawnIDs[i] = q.QuestionItemID
	}
	if err := s.store.IncrementExposure(pkg.ExamID, drawnIDs); err != nil {
		return http.StatusInternalServerError, fmt.Errorf("failed to update exposure counts: %w", err)
	}
	return 0, nil
}

func (s *Server) handlePaper(w http.ResponseWriter, r *http.Request) {
	pkg, _, released := s.isReleased()
	if !released {
		writeError(w, http.StatusLocked, "exam has not been released yet")
		return
	}
	candidateID := r.URL.Query().Get("candidate_id")
	if candidateID == "" {
		writeError(w, http.StatusBadRequest, "candidate_id is required")
		return
	}
	s.respondWithPaper(w, pkg.ExamID, candidateID)
}

func (s *Server) respondWithPaper(w http.ResponseWriter, examID, candidateID string) {
	paper, err := s.store.LoadCandidatePaper(examID, candidateID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load paper: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"questions": paper})
}

type submitRequest struct {
	CandidateID string `json:"candidate_id"`
	Responses   []struct {
		Position      int     `json:"position"`
		SelectedIndex *int    `json:"selected_index,omitempty"`
		AnswerText    *string `json:"answer_text,omitempty"`
	} `json:"responses"`
}

func (s *Server) handleSubmit(w http.ResponseWriter, r *http.Request) {
	pkg, _, released := s.isReleased()
	if !released {
		writeError(w, http.StatusLocked, "exam has not been released yet")
		return
	}

	var req submitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.CandidateID == "" {
		writeError(w, http.StatusBadRequest, "candidate_id and responses are required")
		return
	}

	for _, resp := range req.Responses {
		if err := s.store.RecordResponse(pkg.ExamID, req.CandidateID, resp.Position, resp.SelectedIndex, resp.AnswerText); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to record response: "+err.Error())
			return
		}
	}

	correct, total, err := s.store.AutoMarkMCQ(pkg.ExamID, req.CandidateID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to auto-mark: "+err.Error())
		return
	}

	result := map[string]any{"submitted": true, "mcq_correct": correct, "mcq_total": total}
	if pkg.PublishMode == "immediate" {
		// Theory questions (if any) still need instructor marking, so this
		// is a partial/objective-only score, not a final grade.
		result["objective_score_visible_to_candidate"] = true
	} else {
		result["objective_score_visible_to_candidate"] = false
		result["message"] = "Result held for instructor review and publish."
	}
	writeJSON(w, http.StatusOK, result)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
