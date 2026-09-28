package api

// Invigilator console: the exam-day screen for venue staff, served at
// /invigilator/ from files embedded in this binary. It is the missing piece
// between "Build package" in the instructor portal and candidates actually
// seeing questions — someone at the venue still has to paste the release key
// and press a button at the scheduled start time, and this is that button.
//
// There is deliberately no separate login: whoever has the release key
// already has the authority the rest of this system assumes they have (they
// got it from the exam officer through whatever sealed/out-of-band channel
// the venue uses), so knowing it is what unlocks this screen too.

import (
	"embed"
	"io/fs"
	"net/http"

	"cbt.army.mil.ng/local-exam-server/internal/roster"
)

//go:embed invigilator
var invigilatorFiles embed.FS

func (s *Server) registerInvigilator(mux *http.ServeMux) {
	web, _ := fs.Sub(invigilatorFiles, "invigilator")
	files := http.FileServer(http.FS(web))
	mux.Handle("GET /invigilator/", withKioskHeaders(http.StripPrefix("/invigilator/", files)))
	mux.HandleFunc("GET /invigilator/api/status", s.invigilatorStatus)
	mux.HandleFunc("POST /invigilator/api/release", s.handleRelease)
	mux.HandleFunc("GET /invigilator/api/candidates", s.invigilatorCandidates)
}

func (s *Server) invigilatorStatus(w http.ResponseWriter, r *http.Request) {
	pkg, _, released := s.isReleased()
	rs := s.rosterSnapshot()
	resp := map[string]any{
		"centre":        s.cfg.CentreName,
		"exam_id":       s.cfg.ExamID,
		"released":      released,
		"roster_loaded": rs != nil,
	}
	if rs != nil {
		resp["roster_size"] = rs.Len()
	}
	if released {
		resp["title"] = pkg.Title
		resp["duration_minutes"] = pkg.DurationMinutes
		resp["questions_per_candidate"] = pkg.QuestionsPerCandidate
		resp["publish_mode"] = pkg.PublishMode
	}
	writeJSON(w, http.StatusOK, resp)
}

type candidateStatus struct {
	ServiceNumber string `json:"service_number"`
	Rank          string `json:"rank"`
	FullName      string `json:"full_name"`
	Status        string `json:"status"` // "not_checked_in" | "checked_in" | "started" | "submitted"
	Reference     string `json:"reference,omitempty"`
	Violations    int    `json:"violations"` // tab hidden / window blur / left fullscreen — see kioskViolation
}

// invigilatorCandidates lists every roster candidate with their current
// progress, so the invigilator can see at a glance who hasn't sat down yet
// and who has finished, without walking the room.
func (s *Server) invigilatorCandidates(w http.ResponseWriter, r *http.Request) {
	pkg, _, released := s.isReleased()
	rs := s.rosterSnapshot()
	if rs == nil {
		writeError(w, http.StatusServiceUnavailable, "no roster loaded on this exam server")
		return
	}
	if !released {
		writeJSON(w, http.StatusOK, map[string]any{"candidates": []candidateStatus{}})
		return
	}
	violations, err := s.store.CountViolationsByExam(pkg.ExamID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load violation counts: "+err.Error())
		return
	}

	all := rs.All()
	out := make([]candidateStatus, len(all))
	for i, c := range all {
		out[i] = candidateStatus{ServiceNumber: c.ServiceNumber, Rank: c.Rank, FullName: c.FullName, Status: "not_checked_in", Violations: violations[c.ServiceNumber]}
		st, err := s.store.GetSessionState(pkg.ExamID, c.ServiceNumber)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to load session state: "+err.Error())
			return
		}
		switch {
		case st.SubmittedAt != nil:
			out[i].Status = "submitted"
			out[i].Reference = st.Reference
		case st.StartedAt != nil:
			out[i].Status = "started"
		case st.CheckedIn:
			out[i].Status = "checked_in"
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"candidates": out})
}

func (s *Server) rosterSnapshot() *roster.Roster {
	s.kiosk.mu.Lock()
	defer s.kiosk.mu.Unlock()
	return s.kiosk.roster
}
