package api

// Exam integrity controls on the server side: one active sign-in per
// candidate, the integrity event log and the pause-after-warnings rule, the
// kiosk heartbeat, and the optional Safe Exam Browser check. The kiosk page
// does the detecting (see kiosk/app.js); everything that decides anything
// happens here, so a candidate editing the page in their browser can stop
// reporting events but cannot unpause themselves or move their deadline.

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"regexp"
	"strings"
	"time"

	"cbt.army.mil.ng/local-exam-server/internal/roster"
	"cbt.army.mil.ng/local-exam-server/internal/store"
)

const (
	// A sign-in seen within this window is "active": a second computer can't
	// take it over without the invigilator. Longer than the heartbeat (10s)
	// so a brief network drop doesn't count as gone; short enough that a
	// crashed computer frees the candidate to move without anyone's help.
	activeWindow = 90 * time.Second
	onlineWindow = 30 * time.Second
	// Leaving the window fires blur, hidden and fullscreen-exit together;
	// within this gap they are one episode and count once.
	episodeGap = 3 * time.Second
	// Repeats of the same event closer than this are dropped.
	repeatGap = 2 * time.Second
)

// presence is a candidate's current sign-in.
type presence struct {
	token     string
	seat      string
	ip        string
	lastSeen  time.Time
	allowMove bool // the invigilator has cleared this candidate to sign in elsewhere
}

// clientKinds are the events the kiosk page may report; the bool says
// whether a short detail (e.g. the shortcut pressed) is accepted with it.
var clientKinds = map[string]bool{
	"tab_hidden": false, "window_blur": false, "fullscreen_exit": false,
	"multi_screen": false, "print_attempt": false, "screenshot_key": false,
	"bulk_insert": false, "paste_attempt": false, "blocked_shortcut": true,
}

var leaveKinds = map[string]bool{"tab_hidden": true, "window_blur": true, "fullscreen_exit": true}

var (
	safeDetail = regexp.MustCompile(`^[A-Za-z0-9+ ]{1,40}$`)
	safeSeat   = regexp.MustCompile(`^[A-Za-z0-9 ._/-]{1,20}$`)
)

func isSerious(kind string) bool {
	for _, k := range store.SeriousKinds {
		if k == kind {
			return true
		}
	}
	return false
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func where(seat, ip string) string {
	if seat != "" {
		return fmt.Sprintf("computer %s (%s)", seat, ip)
	}
	return ip
}

// event records an integrity event against this sitting. Logging must never
// break the exam itself, so a failure is only reported, not returned.
func (s *Server) event(candidate, kind, detail string, counted bool) {
	if err := s.store.RecordViolation(s.cfg.ExamID, candidate, kind, detail, counted, time.Now()); err != nil {
		fmt.Printf("integrity log: failed to record %s for %s: %v\n", kind, candidate, err)
	}
}

// ---- Safe Exam Browser ----

// sebOK checks SEB's request headers. SEB sends, on every request, SHA-256
// of the absolute URL followed by the Config Key (X-SafeExamBrowser-
// ConfigKeyHash) and by the Browser Exam Key (X-SafeExamBrowser-RequestHash).
func (s *Server) sebOK(r *http.Request) bool {
	if !s.cfg.RequireSEB {
		return true
	}
	if len(s.cfg.SEBConfigKeys) == 0 && len(s.cfg.SEBBrowserExamKeys) == 0 {
		return strings.Contains(r.UserAgent(), "SEB/")
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	url := scheme + "://" + r.Host + r.URL.RequestURI()
	match := func(header string, keys []string) bool {
		got := strings.ToLower(r.Header.Get(header))
		if got == "" {
			return false
		}
		for _, k := range keys {
			sum := sha256.Sum256([]byte(url + k))
			if hex.EncodeToString(sum[:]) == got {
				return true
			}
		}
		return false
	}
	return match("X-SafeExamBrowser-ConfigKeyHash", s.cfg.SEBConfigKeys) || match("X-SafeExamBrowser-RequestHash", s.cfg.SEBBrowserExamKeys)
}

func (s *Server) requireSEB(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.sebOK(r) {
			h.ServeHTTP(w, r)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/kiosk/api/") {
			writeError(w, http.StatusForbidden, "This exam must be taken in the Safe Exam Browser. Raise your hand for the invigilator.")
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Content-Security-Policy", "default-src 'none'")
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`<!doctype html><meta charset="utf-8"><title>Secure exam browser required</title>` +
			`<h1>Secure exam browser required</h1><p>This exam can only be taken in the Safe Exam Browser set up for this exam centre. Raise your hand for the invigilator.</p>`))
	})
}

// ---- kiosk: events, heartbeat, pause ----

type integrityView struct {
	Locked     bool   `json:"locked"`
	LockReason string `json:"lock_reason,omitempty"`
	Warnings   int    `json:"warnings"`
	LockAfter  int    `json:"lock_after"`
}

func (s *Server) integrityFor(candidate string) (integrityView, error) {
	v := integrityView{LockAfter: s.cfg.LockAfter}
	ls, err := s.store.GetLock(s.cfg.ExamID, candidate)
	if err != nil {
		return v, err
	}
	n, err := s.store.CountedSerious(s.cfg.ExamID, candidate)
	if err != nil {
		return v, err
	}
	v.Locked = ls.LockedAt != nil
	v.LockReason = ls.Reason
	v.Warnings = max(0, n-ls.FlagsCleared)
	return v, nil
}

type violationRequest struct {
	Kind   string `json:"kind"`
	Detail string `json:"detail"`
}

// kioskViolation records an event the kiosk detected and, once the
// candidate's warnings reach CBT_LOCK_AFTER, pauses their exam until the
// invigilator unlocks it. The clock keeps running while paused.
func (s *Server) kioskViolation(w http.ResponseWriter, r *http.Request, c roster.Candidate) {
	if _, _, released := s.isReleased(); !released {
		writeJSON(w, http.StatusOK, map[string]any{"recorded": false})
		return
	}
	var req violationRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 512)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	allowsDetail, ok := clientKinds[req.Kind]
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid violation kind")
		return
	}
	detail := ""
	if allowsDetail && safeDetail.MatchString(req.Detail) {
		detail = req.Detail
	}

	k := s.kiosk
	k.mu.Lock()
	now := k.now()
	key := c.ServiceNumber + "|" + req.Kind
	if now.Sub(k.lastEvent[key]) < repeatGap {
		k.mu.Unlock()
		v, _ := s.integrityFor(c.ServiceNumber)
		writeJSON(w, http.StatusOK, map[string]any{"recorded": false, "integrity": v})
		return
	}
	k.lastEvent[key] = now
	counted := isSerious(req.Kind)
	if leaveKinds[req.Kind] {
		if now.Sub(k.lastLeave[c.ServiceNumber]) < episodeGap {
			counted = false
		}
		k.lastLeave[c.ServiceNumber] = now
	}
	k.mu.Unlock()

	if err := s.store.RecordViolation(s.cfg.ExamID, c.ServiceNumber, req.Kind, detail, counted, time.Now()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to record")
		return
	}
	v, err := s.integrityFor(c.ServiceNumber)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load integrity state")
		return
	}
	if counted && !v.Locked && s.cfg.LockAfter > 0 && v.Warnings >= s.cfg.LockAfter {
		reason := fmt.Sprintf("%d integrity warnings", v.Warnings)
		if locked, err := s.store.Lock(s.cfg.ExamID, c.ServiceNumber, reason, time.Now()); err == nil && locked {
			s.event(c.ServiceNumber, "locked", reason, false)
			v.Locked, v.LockReason = true, reason
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"recorded": true, "integrity": v})
}

// kioskHeartbeat keeps the candidate shown as online on the invigilator
// console (withCandidate records the time) and hands back what the server
// decided since the last beat: a pause, an unlock, extra time.
func (s *Server) kioskHeartbeat(w http.ResponseWriter, r *http.Request, c roster.Candidate) {
	resp := map[string]any{"server_now": time.Now().UTC()}
	if pkg, _, released := s.isReleased(); released {
		st, err := s.store.GetSessionState(pkg.ExamID, c.ServiceNumber)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to load session")
			return
		}
		resp["deadline"] = st.DeadlineAt
		v, err := s.integrityFor(c.ServiceNumber)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to load integrity state")
			return
		}
		resp["integrity"] = v
	}
	writeJSON(w, http.StatusOK, resp)
}
