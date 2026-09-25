package api

// Candidate kiosk: the exam-day screens candidates use (sign-in, details and
// instructions, the exam, review, submit), served at /kiosk/ from files
// embedded in this binary, and the JSON endpoints under /kiosk/api/ they
// call. Everything is LAN-only and works with no internet.
//
// Sign-in is by service number + the PIN on the admission slip, checked
// against the venue roster (CBT_ROSTER_PATH). A successful sign-in gets a
// random token in an httpOnly cookie; the server keeps the token in memory,
// so a server restart just means signing in again — the candidate's paper,
// answers and deadline are in SQLite and carry on where they left off.

import (
	cryptorand "crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"net/http"
	"strings"
	"sync"
	"time"

	"cbt.army.mil.ng/local-exam-server/internal/models"
	"cbt.army.mil.ng/local-exam-server/internal/roster"
)

//go:embed kiosk
var kioskFiles embed.FS

const (
	kioskCookie  = "cbt_kiosk"
	submitGrace  = 60 * time.Second // answers arriving just after 00:00 (network lag) are still accepted
	maxFailures  = 5
	lockDuration = 10 * time.Minute
	maxAnswerLen = 20000
)

type kioskState struct {
	mu       sync.Mutex
	roster   *roster.Roster
	tokens   map[string]string // token -> service number
	failures map[string]*failure
	now      func() time.Time
}

type failure struct {
	count       int
	lockedUntil time.Time
}

func newKioskState() *kioskState {
	return &kioskState{tokens: map[string]string{}, failures: map[string]*failure{}, now: time.Now}
}

// SetRoster installs the venue's candidate list. Without one, kiosk sign-in
// is refused.
func (s *Server) SetRoster(r *roster.Roster) {
	s.kiosk.mu.Lock()
	s.kiosk.roster = r
	s.kiosk.mu.Unlock()
}

func (s *Server) registerKiosk(mux *http.ServeMux) {
	web, _ := fs.Sub(kioskFiles, "kiosk")
	files := http.FileServer(http.FS(web))
	mux.Handle("GET /kiosk/", withKioskHeaders(http.StripPrefix("/kiosk/", files)))
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/kiosk/"+queryString(r), http.StatusFound)
	})
	mux.HandleFunc("GET /kiosk/api/status", s.kioskStatus)
	mux.HandleFunc("POST /kiosk/api/login", s.kioskLogin)
	mux.HandleFunc("POST /kiosk/api/logout", s.kioskLogout)
	mux.HandleFunc("GET /kiosk/api/me", s.withCandidate(s.kioskMe))
	mux.HandleFunc("POST /kiosk/api/start", s.withCandidate(s.kioskStart))
	mux.HandleFunc("PUT /kiosk/api/answer", s.withCandidate(s.kioskAnswer))
	mux.HandleFunc("POST /kiosk/api/submit", s.withCandidate(s.kioskSubmit))
}

func queryString(r *http.Request) string {
	if r.URL.RawQuery == "" {
		return ""
	}
	return "?" + r.URL.RawQuery
}

func withKioskHeaders(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cache-Control", "no-store")
		h.ServeHTTP(w, r)
	})
}

// ---- auth ----

type candidateHandler func(w http.ResponseWriter, r *http.Request, c roster.Candidate)

func (s *Server) withCandidate(h candidateHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		cookie, err := r.Cookie(kioskCookie)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "sign in to continue")
			return
		}
		s.kiosk.mu.Lock()
		svc, ok := s.kiosk.tokens[cookie.Value]
		rs := s.kiosk.roster
		s.kiosk.mu.Unlock()
		if !ok || rs == nil {
			writeError(w, http.StatusUnauthorized, "sign in to continue")
			return
		}
		c, ok := rs.Get(svc)
		if !ok {
			writeError(w, http.StatusUnauthorized, "sign in to continue")
			return
		}
		h(w, r, c)
	}
}

func (s *Server) kioskStatus(w http.ResponseWriter, r *http.Request) {
	pkg, _, released := s.isReleased()
	s.kiosk.mu.Lock()
	loaded := s.kiosk.roster != nil
	s.kiosk.mu.Unlock()
	resp := map[string]any{"centre": s.cfg.CentreName, "released": released, "roster_loaded": loaded}
	if released {
		resp["title"] = pkg.Title
	}
	writeJSON(w, http.StatusOK, resp)
}

type loginRequest struct {
	ServiceNumber string `json:"service_number"`
	PIN           string `json:"pin"`
}

func (s *Server) kioskLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	key := roster.Normalize(req.ServiceNumber)

	k := s.kiosk
	k.mu.Lock()
	rs := k.roster
	f := k.failures[key]
	if f != nil && k.now().Before(f.lockedUntil) {
		k.mu.Unlock()
		writeError(w, http.StatusTooManyRequests, "Too many wrong attempts. Raise your hand for the invigilator.")
		return
	}
	k.mu.Unlock()

	if rs == nil {
		writeError(w, http.StatusServiceUnavailable, "The candidate list isn't loaded on this exam server. Tell the invigilator.")
		return
	}
	c, ok := rs.Check(req.ServiceNumber, req.PIN)
	if !ok {
		k.mu.Lock()
		if f == nil {
			f = &failure{}
			k.failures[key] = f
		}
		f.count++
		if f.count >= maxFailures {
			f.count = 0
			f.lockedUntil = k.now().Add(lockDuration)
		}
		k.mu.Unlock()
		writeError(w, http.StatusUnauthorized, "Those details don’t match. Check your service number and PIN against your admission slip.")
		return
	}

	token := randomHex(32)
	k.mu.Lock()
	delete(k.failures, key)
	k.tokens[token] = c.ServiceNumber
	k.mu.Unlock()

	http.SetCookie(w, &http.Cookie{Name: kioskCookie, Value: token, Path: "/kiosk", HttpOnly: true, SameSite: http.SameSiteStrictMode})
	writeJSON(w, http.StatusOK, map[string]any{"candidate": c})
}

func (s *Server) kioskLogout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(kioskCookie); err == nil {
		s.kiosk.mu.Lock()
		delete(s.kiosk.tokens, cookie.Value)
		s.kiosk.mu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: kioskCookie, Value: "", Path: "/kiosk", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteStrictMode})
	writeJSON(w, http.StatusOK, map[string]any{"signed_out": true})
}

// ---- exam ----

type paperMeta struct {
	Title           string `json:"title"`
	DurationMinutes int    `json:"duration_minutes"`
	Questions       int    `json:"questions"`
	Objective       int    `json:"objective"`
	Theory          int    `json:"theory"`
	PublishMode     string `json:"publish_mode"`
}

func metaFor(pkg *models.ExamPackage) paperMeta {
	m := paperMeta{Title: pkg.Title, DurationMinutes: pkg.DurationMinutes, Questions: pkg.QuestionsPerCandidate, PublishMode: pkg.PublishMode}
	// The per-candidate split follows the pool's proportions (see
	// internal/randomize), so estimate it from the pool for the
	// instructions screen; the paper itself is authoritative once drawn.
	var obj, th int
	for _, q := range pkg.Pool {
		if q.Type == "theory" {
			th++
		} else {
			obj++
		}
	}
	if obj+th > 0 {
		m.Theory = (pkg.QuestionsPerCandidate*th + (obj+th)/2) / (obj + th)
		m.Objective = pkg.QuestionsPerCandidate - m.Theory
	}
	return m
}

type sessionView struct {
	Started     bool       `json:"started"`
	Deadline    *time.Time `json:"deadline,omitempty"`
	SubmittedAt *time.Time `json:"submitted_at,omitempty"`
	Reference   string     `json:"reference,omitempty"`
}

func (s *Server) kioskMe(w http.ResponseWriter, r *http.Request, c roster.Candidate) {
	pkg, _, released := s.isReleased()
	resp := map[string]any{"candidate": c, "centre": s.cfg.CentreName, "released": released, "server_now": time.Now().UTC()}
	if released {
		st, err := s.store.GetSessionState(pkg.ExamID, c.ServiceNumber)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to load session")
			return
		}
		resp["paper"] = metaFor(pkg)
		resp["session"] = sessionView{Started: st.StartedAt != nil, Deadline: st.DeadlineAt, SubmittedAt: st.SubmittedAt, Reference: st.Reference}
	}
	writeJSON(w, http.StatusOK, resp)
}

type kioskQuestion struct {
	Position int      `json:"position"`
	Type     string   `json:"type"` // "mcq" | "theory"
	Stem     string   `json:"stem"`
	Options  []string `json:"options,omitempty"`
}

// kioskStart draws the candidate's paper if needed, starts their clock the
// first time only, and returns the paper (never the answers key), any
// answers already saved, and the deadline.
func (s *Server) kioskStart(w http.ResponseWriter, r *http.Request, c roster.Candidate) {
	pkg, salt, released := s.isReleased()
	if !released {
		writeError(w, http.StatusLocked, "The invigilator hasn’t opened this paper yet.")
		return
	}
	if status, err := s.ensurePaper(pkg, salt, c.ServiceNumber); err != nil {
		writeError(w, status, err.Error())
		return
	}
	if err := s.store.StartClock(pkg.ExamID, c.ServiceNumber, time.Now(), time.Duration(pkg.DurationMinutes)*time.Minute); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start the clock")
		return
	}
	st, err := s.store.GetSessionState(pkg.ExamID, c.ServiceNumber)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load session")
		return
	}
	stored, err := s.store.LoadCandidatePaper(pkg.ExamID, c.ServiceNumber)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load paper")
		return
	}
	questions := make([]kioskQuestion, len(stored))
	for i, q := range stored {
		questions[i] = kioskQuestion{Position: q.Position, Type: q.QuestionType, Stem: q.Stem, Options: q.Options}
	}
	answers, err := s.store.LoadAnswers(pkg.ExamID, c.ServiceNumber)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load answers")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"paper":      metaFor(pkg),
		"questions":  questions,
		"answers":    answers,
		"session":    sessionView{Started: true, Deadline: st.DeadlineAt, SubmittedAt: st.SubmittedAt, Reference: st.Reference},
		"server_now": time.Now().UTC(),
	})
}

type answerRequest struct {
	Position      int     `json:"position"`
	SelectedIndex *int    `json:"selected_index"`
	AnswerText    *string `json:"answer_text"`
}

// openForAnswers reports whether the candidate may still change answers.
func (s *Server) openForAnswers(examID, candidate string) (int, string) {
	st, err := s.store.GetSessionState(examID, candidate)
	if err != nil {
		return http.StatusInternalServerError, "failed to load session"
	}
	if st.StartedAt == nil {
		return http.StatusConflict, "Press Start before answering."
	}
	if st.SubmittedAt != nil {
		return http.StatusConflict, "Your answers have already been submitted."
	}
	if st.DeadlineAt != nil && time.Now().After(st.DeadlineAt.Add(submitGrace)) {
		return http.StatusConflict, "Time is up."
	}
	return 0, ""
}

func (s *Server) kioskAnswer(w http.ResponseWriter, r *http.Request, c roster.Candidate) {
	pkg, _, released := s.isReleased()
	if !released {
		writeError(w, http.StatusLocked, "The invigilator hasn’t opened this paper yet.")
		return
	}
	var req answerRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.AnswerText != nil && len(*req.AnswerText) > maxAnswerLen {
		writeError(w, http.StatusRequestEntityTooLarge, "That answer is too long.")
		return
	}
	if status, msg := s.openForAnswers(pkg.ExamID, c.ServiceNumber); status != 0 {
		writeError(w, status, msg)
		return
	}
	paper, err := s.store.LoadCandidatePaper(pkg.ExamID, c.ServiceNumber)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load paper")
		return
	}
	var q *kioskQuestion
	for _, sq := range paper {
		if sq.Position == req.Position {
			q = &kioskQuestion{Position: sq.Position, Type: sq.QuestionType, Options: sq.Options}
		}
	}
	if q == nil {
		writeError(w, http.StatusBadRequest, "no such question")
		return
	}
	if q.Type == "mcq" {
		if req.SelectedIndex != nil && (*req.SelectedIndex < 0 || *req.SelectedIndex >= len(q.Options)) {
			writeError(w, http.StatusBadRequest, "option out of range")
			return
		}
		req.AnswerText = nil
	} else {
		req.SelectedIndex = nil
	}
	if err := s.store.RecordResponse(pkg.ExamID, c.ServiceNumber, req.Position, req.SelectedIndex, req.AnswerText); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save answer")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"saved": true, "position": req.Position})
}

func (s *Server) kioskSubmit(w http.ResponseWriter, r *http.Request, c roster.Candidate) {
	pkg, _, released := s.isReleased()
	if !released {
		writeError(w, http.StatusLocked, "The invigilator hasn’t opened this paper yet.")
		return
	}
	st, err := s.store.GetSessionState(pkg.ExamID, c.ServiceNumber)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load session")
		return
	}
	if st.StartedAt == nil {
		writeError(w, http.StatusConflict, "This paper hasn’t been started.")
		return
	}

	if st.SubmittedAt == nil {
		ref := strings.ToUpper(randomHex(2) + "-" + randomHex(2))
		if _, err := s.store.MarkSubmitted(pkg.ExamID, c.ServiceNumber, ref, time.Now()); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to record submission")
			return
		}
		if st, err = s.store.GetSessionState(pkg.ExamID, c.ServiceNumber); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to load session")
			return
		}
	}

	correct, total, err := s.store.AutoMarkMCQ(pkg.ExamID, c.ServiceNumber)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to mark")
		return
	}
	paper, _ := s.store.LoadCandidatePaper(pkg.ExamID, c.ServiceNumber)
	theory := 0
	for _, q := range paper {
		if q.QuestionType == "theory" {
			theory++
		}
	}
	resp := map[string]any{
		"submitted":    true,
		"submitted_at": st.SubmittedAt,
		"reference":    st.Reference,
		"publish_mode": pkg.PublishMode,
		"theory":       theory,
	}
	if pkg.PublishMode == "immediate" {
		resp["objective_correct"] = correct
		resp["objective_total"] = total
	}
	writeJSON(w, http.StatusOK, resp)
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := cryptorand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
