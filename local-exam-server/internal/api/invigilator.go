package api

// Invigilator console: the exam-day screen for venue staff, served at
// /invigilator/ from files embedded in this binary. Someone at the venue has
// to paste the release key and press a button at the scheduled start time,
// and this is that button; after that it is where the room is watched.
//
// Access is by the release key itself: whoever has it already has the
// authority the rest of this system assumes they have (they got it from the
// exam officer through a sealed or out-of-band channel). Opening the exam, or
// signing in with the same key afterwards, gives the browser a console
// session; without one the roster, the incident log and the actions are
// refused, so a candidate on the same LAN can't read or act on them.

import (
	"crypto/sha256"
	"crypto/subtle"
	"embed"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode"

	"cbt.army.mil.ng/local-exam-server/internal/roster"
)

//go:embed invigilator
var invigilatorFiles embed.FS

const invigCookie = "cbt_invig"

type invigState struct {
	mu      sync.Mutex
	keyHash []byte          // SHA-256 of the release key, once released
	tokens  map[string]bool // console sessions
}

func newInvigState() *invigState { return &invigState{tokens: map[string]bool{}} }

func (s *Server) registerInvigilator(mux *http.ServeMux) {
	web, _ := fs.Sub(invigilatorFiles, "invigilator")
	files := http.FileServer(http.FS(web))
	mux.Handle("GET /invigilator/", withKioskHeaders(http.StripPrefix("/invigilator/", files)))
	mux.HandleFunc("GET /invigilator/api/status", s.invigilatorStatus)
	mux.HandleFunc("POST /invigilator/api/release", s.handleRelease)
	mux.HandleFunc("POST /invigilator/api/login", s.invigilatorLogin)
	mux.HandleFunc("POST /invigilator/api/logout", s.invigilatorLogout)
	mux.HandleFunc("GET /invigilator/api/candidates", s.withInvigilator(s.invigilatorCandidates))
	mux.HandleFunc("GET /invigilator/api/events", s.withInvigilator(s.invigilatorEvents))
	mux.HandleFunc("GET /invigilator/api/incidents.csv", s.withInvigilator(s.invigilatorIncidentsCSV))
	mux.HandleFunc("GET /invigilator/api/results.json", s.withInvigilator(s.invigilatorResults))
	mux.HandleFunc("POST /invigilator/api/unlock", s.withInvigilator(s.invigilatorUnlock))
	mux.HandleFunc("POST /invigilator/api/allow-move", s.withInvigilator(s.invigilatorAllowMove))
	mux.HandleFunc("POST /invigilator/api/extend", s.withInvigilator(s.invigilatorExtend))
}

// startConsoleSession is called once the release key has been proven.
func (s *Server) startConsoleSession(w http.ResponseWriter, key []byte) {
	sum := sha256.Sum256(key)
	token := randomHex(32)
	s.invig.mu.Lock()
	s.invig.keyHash = sum[:]
	s.invig.tokens[token] = true
	s.invig.mu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: invigCookie, Value: token, Path: "/invigilator", HttpOnly: true, Secure: s.cfg.TLSEnabled(), SameSite: http.SameSiteStrictMode})
}

func (s *Server) consoleSignedIn(r *http.Request) bool {
	c, err := r.Cookie(invigCookie)
	if err != nil {
		return false
	}
	s.invig.mu.Lock()
	defer s.invig.mu.Unlock()
	return s.invig.tokens[c.Value]
}

func (s *Server) withInvigilator(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if !s.consoleSignedIn(r) {
			writeError(w, http.StatusUnauthorized, "Sign in with the release key to use the invigilator console.")
			return
		}
		h(w, r)
	}
}

func (s *Server) invigilatorLogin(w http.ResponseWriter, r *http.Request) {
	var req releaseRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	s.invig.mu.Lock()
	want := s.invig.keyHash
	s.invig.mu.Unlock()
	if want == nil {
		writeError(w, http.StatusConflict, "The exam hasn’t been opened yet. Open it with the release key first.")
		return
	}
	key, err := hex.DecodeString(strings.TrimSpace(req.KeyHex))
	sum := sha256.Sum256(key)
	if err != nil || subtle.ConstantTimeCompare(sum[:], want) != 1 {
		time.Sleep(500 * time.Millisecond)
		writeError(w, http.StatusUnauthorized, "That isn’t the release key for this exam.")
		return
	}
	s.startConsoleSession(w, key)
	writeJSON(w, http.StatusOK, map[string]any{"signed_in": true})
}

func (s *Server) invigilatorLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(invigCookie); err == nil {
		s.invig.mu.Lock()
		delete(s.invig.tokens, c.Value)
		s.invig.mu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: invigCookie, Value: "", Path: "/invigilator", MaxAge: -1, HttpOnly: true, Secure: s.cfg.TLSEnabled(), SameSite: http.SameSiteStrictMode})
	writeJSON(w, http.StatusOK, map[string]any{"signed_out": true})
}

func (s *Server) invigilatorStatus(w http.ResponseWriter, r *http.Request) {
	pkg, _, released := s.isReleased()
	rs := s.rosterSnapshot()
	signedIn := s.consoleSignedIn(r)
	resp := map[string]any{
		"centre":        s.cfg.CentreName,
		"exam_id":       s.cfg.ExamID,
		"released":      released,
		"roster_loaded": rs != nil,
		"signed_in":     signedIn,
		"lock_after":    s.cfg.LockAfter,
		"seb_required":  s.cfg.RequireSEB,
	}
	if rs != nil {
		resp["roster_size"] = rs.Len()
	}
	if released && signedIn {
		resp["title"] = pkg.Title
		resp["duration_minutes"] = pkg.DurationMinutes
		resp["questions_per_candidate"] = pkg.QuestionsPerCandidate
		resp["publish_mode"] = pkg.PublishMode
	}
	writeJSON(w, http.StatusOK, resp)
}

type candidateStatus struct {
	ServiceNumber string     `json:"service_number"`
	Rank          string     `json:"rank"`
	FullName      string     `json:"full_name"`
	Status        string     `json:"status"` // "not_checked_in" | "checked_in" | "started" | "submitted"
	Reference     string     `json:"reference,omitempty"`
	Flags         int        `json:"flags"` // serious integrity events, see store.SeriousKinds
	Violations    int        `json:"violations"`
	Seat          string     `json:"seat,omitempty"`
	IP            string     `json:"ip,omitempty"`
	Online        bool       `json:"online"`
	LastSeen      *time.Time `json:"last_seen,omitempty"`
	Locked        bool       `json:"locked"`
	LockReason    string     `json:"lock_reason,omitempty"`
	Deadline      *time.Time `json:"deadline,omitempty"`
}

// invigilatorCandidates lists every roster candidate with their progress,
// where they are sitting, whether their computer is still in touch, and any
// integrity flags or pause, so the invigilator sees the room at a glance.
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
	flags, err := s.store.CountFlagsByExam(pkg.ExamID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load integrity flags: "+err.Error())
		return
	}
	k := s.kiosk
	k.mu.Lock()
	now := k.now()
	seen := map[string]presence{}
	for svc, p := range k.presence {
		seen[svc] = *p
	}
	k.mu.Unlock()

	all := rs.All()
	out := make([]candidateStatus, len(all))
	for i, c := range all {
		out[i] = candidateStatus{ServiceNumber: c.ServiceNumber, Rank: c.Rank, FullName: c.FullName, Status: "not_checked_in", Flags: flags[c.ServiceNumber], Violations: flags[c.ServiceNumber]}
		if p, ok := seen[c.ServiceNumber]; ok {
			last := p.lastSeen
			out[i].Seat, out[i].IP, out[i].LastSeen, out[i].Online = p.seat, p.ip, &last, now.Sub(p.lastSeen) < onlineWindow
		}
		st, err := s.store.GetSessionState(pkg.ExamID, c.ServiceNumber)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to load session state: "+err.Error())
			return
		}
		out[i].Deadline = st.DeadlineAt
		switch {
		case st.SubmittedAt != nil:
			out[i].Status = "submitted"
			out[i].Reference = st.Reference
		case st.StartedAt != nil:
			out[i].Status = "started"
		case st.CheckedIn:
			out[i].Status = "checked_in"
		}
		ls, err := s.store.GetLock(pkg.ExamID, c.ServiceNumber)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to load pause state: "+err.Error())
			return
		}
		out[i].Locked, out[i].LockReason = ls.LockedAt != nil, ls.Reason
	}
	writeJSON(w, http.StatusOK, map[string]any{"candidates": out})
}

func (s *Server) invigilatorEvents(w http.ResponseWriter, r *http.Request) {
	c, ok := s.rosterCandidate(r.URL.Query().Get("candidate"))
	if !ok {
		writeError(w, http.StatusNotFound, "no such candidate on the roster")
		return
	}
	events, err := s.store.Events(s.cfg.ExamID, c.ServiceNumber)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load events")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": events})
}

// invigilatorIncidentsCSV is the sitting's incident log for the exam record.
func (s *Server) invigilatorIncidentsCSV(w http.ResponseWriter, r *http.Request) {
	events, err := s.store.Events(s.cfg.ExamID, "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load events")
		return
	}
	rs := s.rosterSnapshot()
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="incidents-%s.csv"`, safeFileName(s.cfg.ExamID)))
	out := csv.NewWriter(w)
	_ = out.Write([]string{"time_utc", "service_number", "rank", "full_name", "event", "detail", "counted_towards_pause"})
	for _, e := range events {
		rank, name := "", ""
		if rs != nil {
			if c, ok := rs.Get(e.CandidateID); ok {
				rank, name = c.Rank, c.FullName
			}
		}
		counted := "no"
		if e.Counted && isSerious(e.Kind) {
			counted = "yes"
		}
		_ = out.Write([]string{e.At.UTC().Format(time.RFC3339), csvSafe(e.CandidateID), csvSafe(rank), csvSafe(name), e.Kind, csvSafe(e.Detail), counted})
	}
	out.Flush()
}

// csvSafe stops a cell being read as a formula when the file is opened in a spreadsheet.
func csvSafe(v string) string {
	if v != "" && strings.ContainsRune("=+-@\t\r", rune(v[0])) {
		return "'" + v
	}
	return v
}

func safeFileName(v string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-' || r == '_' {
			return r
		}
		return '_'
	}, v)
}

type candidateAction struct {
	ServiceNumber string `json:"service_number"`
	Minutes       int    `json:"minutes"`
	Reason        string `json:"reason"`
}

func (s *Server) readAction(w http.ResponseWriter, r *http.Request) (candidateAction, roster.Candidate, bool) {
	var req candidateAction
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return req, roster.Candidate{}, false
	}
	c, ok := s.rosterCandidate(req.ServiceNumber)
	if !ok {
		writeError(w, http.StatusNotFound, "no such candidate on the roster")
		return req, c, false
	}
	return req, c, true
}

func (s *Server) invigilatorUnlock(w http.ResponseWriter, r *http.Request) {
	_, c, ok := s.readAction(w, r)
	if !ok {
		return
	}
	n, err := s.store.CountedSerious(s.cfg.ExamID, c.ServiceNumber)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load warnings")
		return
	}
	unlocked, err := s.store.Unlock(s.cfg.ExamID, c.ServiceNumber, n)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to unlock")
		return
	}
	if unlocked {
		s.event(c.ServiceNumber, "unlocked", "by the invigilator", false)
	}
	writeJSON(w, http.StatusOK, map[string]any{"unlocked": unlocked})
}

// invigilatorAllowMove lets a candidate sign in on a different computer even
// though their current one is still active (e.g. a faulty keyboard).
func (s *Server) invigilatorAllowMove(w http.ResponseWriter, r *http.Request) {
	_, c, ok := s.readAction(w, r)
	if !ok {
		return
	}
	k := s.kiosk
	k.mu.Lock()
	if p := k.presence[c.ServiceNumber]; p != nil {
		p.allowMove = true
	}
	k.mu.Unlock()
	s.event(c.ServiceNumber, "relogin_allowed", "by the invigilator", false)
	writeJSON(w, http.StatusOK, map[string]any{"allowed": true})
}

// invigilatorExtend gives extra time, e.g. after a computer failure or for an
// approved access arrangement. A reason is required for the record.
func (s *Server) invigilatorExtend(w http.ResponseWriter, r *http.Request) {
	req, c, ok := s.readAction(w, r)
	if !ok {
		return
	}
	reason := strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, req.Reason))
	if req.Minutes < 1 || req.Minutes > 120 {
		writeError(w, http.StatusBadRequest, "Give between 1 and 120 minutes.")
		return
	}
	if len(reason) < 3 || len(reason) > 200 {
		writeError(w, http.StatusBadRequest, "Say why the extra time is given (3 to 200 characters).")
		return
	}
	deadline, err := s.store.ExtendDeadline(s.cfg.ExamID, c.ServiceNumber, time.Duration(req.Minutes)*time.Minute)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to extend")
		return
	}
	if deadline == nil {
		writeError(w, http.StatusConflict, "Extra time can only be given to a candidate who has started and not yet submitted.")
		return
	}
	s.event(c.ServiceNumber, "time_extended", fmt.Sprintf("+%d min: %s", req.Minutes, reason), false)
	writeJSON(w, http.StatusOK, map[string]any{"deadline": deadline})
}

func (s *Server) rosterCandidate(serviceNumber string) (roster.Candidate, bool) {
	rs := s.rosterSnapshot()
	if rs == nil || serviceNumber == "" {
		return roster.Candidate{}, false
	}
	return rs.Get(serviceNumber)
}

func (s *Server) rosterSnapshot() *roster.Roster {
	s.kiosk.mu.Lock()
	defer s.kiosk.mu.Unlock()
	return s.kiosk.roster
}
