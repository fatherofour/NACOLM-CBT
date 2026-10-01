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
	invig *invigState // invigilator console sessions; see invigilator.go
}

func NewServer(cfg config.Config, st *store.Store) *Server {
	return &Server{cfg: cfg, store: st, kiosk: newKioskState(), invig: newInvigState()}
}

func (s *Server) Router() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("POST /release", s.handleRelease)
	s.registerKiosk(mux)
	s.registerInvigilator(mux)
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

	// Whoever proved the key is the invigilator: this browser gets a console session.
	s.startConsoleSession(w, key)
	writeJSON(w, http.StatusOK, map[string]any{"released": true, "exam_id": pkg.ExamID, "title": pkg.Title})
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

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
