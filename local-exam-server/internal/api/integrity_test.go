package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"cbt.army.mil.ng/local-exam-server/internal/config"
	"cbt.army.mil.ng/local-exam-server/internal/roster"
	"cbt.army.mil.ng/local-exam-server/internal/store"
)

// clock is a settable kiosk clock so tests can step past the timing windows.
type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) now() time.Time      { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *clock) add(d time.Duration) { c.mu.Lock(); c.t = c.t.Add(d); c.mu.Unlock() }

type rig struct {
	t     *testing.T
	url   string
	key   string
	srv   *Server
	clock *clock
}

func newRig(t *testing.T, tweak func(*config.Config)) *rig {
	t.Helper()
	dir := t.TempDir()
	pkgPath, key := writePackage(t, dir, "instructor_controlled")
	st, err := store.Open(filepath.Join(dir, "exam.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	cfg := config.Config{PackagePath: pkgPath, ExamID: testExam, CentreName: "Hall A", LockAfter: 3}
	if tweak != nil {
		tweak(&cfg)
	}
	srv := NewServer(cfg, st)
	rs, err := roster.Parse(strings.NewReader("service_number,rank,full_name,pin\nNA/1,Lt,Test One,123456\nNA/2,Capt,Test Two,654321\n"))
	if err != nil {
		t.Fatal(err)
	}
	srv.SetRoster(rs)
	clk := &clock{t: time.Now()}
	srv.kiosk.now = clk.now
	ts := httptest.NewServer(srv.Router())
	t.Cleanup(ts.Close)
	return &rig{t: t, url: ts.URL, key: key, srv: srv, clock: clk}
}

func (r *rig) client() client {
	jar, _ := cookiejar.New(nil)
	return client{t: r.t, url: r.url, c: &http.Client{Jar: jar}}
}

func (r *rig) raw(c client, method, path string, body any, headers map[string]string) (int, string) {
	r.t.Helper()
	var buf io.Reader = http.NoBody
	if body != nil {
		b, _ := json.Marshal(body)
		buf = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, r.url+path, buf)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := c.c.Do(req)
	if err != nil {
		r.t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(b)
}

// signedIn returns a kiosk client for NA/1 at the given seat, with the paper
// released (by an invigilator client, also returned) and started.
func (r *rig) started(seat string) (client, client) {
	r.t.Helper()
	inv := r.client()
	if code, body := inv.do("POST", "/invigilator/api/release", map[string]string{"key_hex": r.key}); code != http.StatusOK {
		r.t.Fatalf("release: %d %v", code, body)
	}
	c := r.client()
	if code, body := c.do("POST", "/kiosk/api/login", map[string]string{"service_number": "NA/1", "pin": "123456", "seat": seat}); code != http.StatusOK {
		r.t.Fatalf("login: %d %v", code, body)
	}
	if code, body := c.do("POST", "/kiosk/api/start", nil); code != http.StatusOK {
		r.t.Fatalf("start: %d %v", code, body)
	}
	return c, inv
}

func TestOldIDOnlyEndpointsAreGone(t *testing.T) {
	r := newRig(t, nil)
	c, _ := r.started("A-1")
	for _, tc := range []struct{ method, path string }{{"POST", "/checkin"}, {"GET", "/paper?candidate_id=NA/1"}, {"POST", "/submit"}} {
		if code, _ := c.do(tc.method, tc.path, map[string]any{"candidate_id": "NA/1"}); code != http.StatusNotFound && code != http.StatusMethodNotAllowed {
			t.Errorf("%s %s: want it gone, got %d", tc.method, tc.path, code)
		}
	}
}

func TestInvigilatorConsoleNeedsTheReleaseKey(t *testing.T) {
	r := newRig(t, nil)
	stranger := r.client()
	if code, _ := stranger.do("GET", "/invigilator/api/candidates", nil); code != http.StatusUnauthorized {
		t.Fatalf("roster without console session: want 401, got %d", code)
	}
	if code, _ := stranger.do("POST", "/invigilator/api/login", map[string]string{"key_hex": r.key}); code != http.StatusConflict {
		t.Fatalf("login before release: want 409, got %d", code)
	}
	inv := r.client()
	inv.do("POST", "/invigilator/api/release", map[string]string{"key_hex": r.key})
	if code, _ := inv.do("GET", "/invigilator/api/candidates", nil); code != http.StatusOK {
		t.Fatalf("roster after opening the exam: want 200, got %d", code)
	}
	if code, _ := stranger.do("POST", "/invigilator/api/login", map[string]string{"key_hex": strings.Repeat("ab", 32)}); code != http.StatusUnauthorized {
		t.Fatalf("wrong key: want 401, got %d", code)
	}
	if code, _ := stranger.do("POST", "/invigilator/api/unlock", map[string]string{"service_number": "NA/1"}); code != http.StatusUnauthorized {
		t.Fatalf("unlock without session: want 401, got %d", code)
	}
	second := r.client()
	if code, _ := second.do("POST", "/invigilator/api/login", map[string]string{"key_hex": r.key}); code != http.StatusOK {
		t.Fatalf("second console with the right key: want 200, got %d", code)
	}
	if _, status := second.do("GET", "/invigilator/api/status", nil); status["signed_in"] != true || status["title"] == nil {
		t.Fatalf("status for a signed-in console should include the paper: %v", status)
	}
	if _, status := stranger.do("GET", "/invigilator/api/status", nil); status["title"] != nil {
		t.Fatalf("status must not show the paper to a stranger: %v", status)
	}
}

func TestOnlyOneActiveSignInPerCandidate(t *testing.T) {
	r := newRig(t, nil)
	first, inv := r.started("A-1")

	other := r.client()
	code, body := other.do("POST", "/kiosk/api/login", map[string]string{"service_number": "NA/1", "pin": "123456", "seat": "B-7"})
	if code != http.StatusConflict {
		t.Fatalf("second computer while first is active: want 409, got %d %v", code, body)
	}

	// The same computer signing in again (a browser restart) is fine.
	again := r.client()
	if code, _ := again.do("POST", "/kiosk/api/login", map[string]string{"service_number": "NA/1", "pin": "123456", "seat": "A-1"}); code != http.StatusOK {
		t.Fatalf("same computer re-sign-in: want 200, got %d", code)
	}

	// After the invigilator allows it, the candidate can move.
	if code, _ := inv.do("POST", "/invigilator/api/allow-move", map[string]string{"service_number": "NA/1"}); code != http.StatusOK {
		t.Fatalf("allow-move: got %d", code)
	}
	if code, _ := other.do("POST", "/kiosk/api/login", map[string]string{"service_number": "NA/1", "pin": "123456", "seat": "B-7"}); code != http.StatusOK {
		t.Fatalf("move after invigilator allowed it: want 200, got %d", code)
	}
	code, body = again.do("GET", "/kiosk/api/me", nil)
	if code != http.StatusUnauthorized || !strings.Contains(body["error"].(string), "another computer") {
		t.Fatalf("old computer after the move: want 401 explaining why, got %d %v", code, body)
	}
	_ = first

	// A computer that has gone quiet frees the candidate without the invigilator.
	r.clock.add(2 * time.Minute)
	third := r.client()
	if code, _ := third.do("POST", "/kiosk/api/login", map[string]string{"service_number": "NA/1", "pin": "123456", "seat": "C-3"}); code != http.StatusOK {
		t.Fatalf("after the previous computer went quiet: want 200, got %d", code)
	}

	_, ev := inv.do("GET", "/invigilator/api/events?candidate=NA/1", nil)
	raw, _ := json.Marshal(ev["events"])
	for _, kind := range []string{"concurrent_login_blocked", "relogin_allowed", "session_moved", "signed_in"} {
		if !strings.Contains(string(raw), kind) {
			t.Errorf("event log missing %s: %s", kind, raw)
		}
	}
}

func TestWarningsPauseTheExamUntilTheInvigilatorUnlocks(t *testing.T) {
	r := newRig(t, nil) // LockAfter 3
	c, inv := r.started("A-1")
	answer := map[string]any{"position": 1, "answer_text": "some words"}

	report := func(kind string) map[string]any {
		t.Helper()
		code, body := c.do("POST", "/kiosk/api/violation", map[string]string{"kind": kind})
		if code != http.StatusOK {
			t.Fatalf("violation %s: %d %v", kind, code, body)
		}
		return body["integrity"].(map[string]any)
	}

	report("tab_hidden")
	r.clock.add(time.Second)
	if v := report("window_blur"); v["warnings"].(float64) != 1 {
		t.Fatalf("blur straight after hidden is the same episode: want 1 warning, got %v", v)
	}
	r.clock.add(10 * time.Second)
	report("fullscreen_exit")
	r.clock.add(10 * time.Second)
	v := report("print_attempt")
	if v["locked"] != true {
		t.Fatalf("third counted warning should pause the exam: %v", v)
	}
	if code, body := c.do("PUT", "/kiosk/api/answer", answer); code != http.StatusLocked || body["locked"] != true {
		t.Fatalf("answer while paused: want 423 locked, got %d %v", code, body)
	}
	_, hb := c.do("POST", "/kiosk/api/heartbeat", map[string]any{})
	if hb["integrity"].(map[string]any)["locked"] != true {
		t.Fatalf("heartbeat should report the pause: %v", hb)
	}
	_, roster := inv.do("GET", "/invigilator/api/candidates", nil)
	row := roster["candidates"].([]any)[0].(map[string]any)
	if row["locked"] != true || row["flags"].(float64) != 4 || row["seat"] != "A-1" || row["online"] != true {
		t.Fatalf("console row should show the pause, all 4 flags, seat and online: %v", row)
	}

	if code, body := inv.do("POST", "/invigilator/api/unlock", map[string]string{"service_number": "NA/1"}); code != http.StatusOK || body["unlocked"] != true {
		t.Fatalf("unlock: %d %v", code, body)
	}
	if code, _ := c.do("PUT", "/kiosk/api/answer", answer); code != http.StatusOK {
		t.Fatalf("answer after unlock: want 200, got %d", code)
	}
	r.clock.add(10 * time.Second)
	if v := report("tab_hidden"); v["locked"] == true || v["warnings"].(float64) != 1 {
		t.Fatalf("after unlock the candidate starts a fresh allowance: %v", v)
	}
}

func TestPausingCanBeTurnedOff(t *testing.T) {
	r := newRig(t, func(c *config.Config) { c.LockAfter = 0 })
	c, _ := r.started("A-1")
	for i := 0; i < 6; i++ {
		r.clock.add(10 * time.Second)
		c.do("POST", "/kiosk/api/violation", map[string]string{"kind": "tab_hidden"})
	}
	if code, _ := c.do("PUT", "/kiosk/api/answer", map[string]any{"position": 1, "answer_text": "x"}); code != http.StatusOK {
		t.Fatalf("with CBT_LOCK_AFTER=0 the exam never pauses, got %d", code)
	}
}

func TestViolationReportsAreValidated(t *testing.T) {
	r := newRig(t, nil)
	c, inv := r.started("A-1")
	if code, _ := c.do("POST", "/kiosk/api/violation", map[string]string{"kind": "anything_i_like"}); code != http.StatusBadRequest {
		t.Fatalf("unknown kind: want 400, got %d", code)
	}
	c.do("POST", "/kiosk/api/violation", map[string]string{"kind": "blocked_shortcut", "detail": "Ctrl+P"})
	r.clock.add(3 * time.Second)
	c.do("POST", "/kiosk/api/violation", map[string]string{"kind": "blocked_shortcut", "detail": "<img src=x onerror=alert(1)>"})
	_, ev := inv.do("GET", "/invigilator/api/events?candidate=NA/1", nil)
	raw, _ := json.Marshal(ev["events"])
	if !strings.Contains(string(raw), "Ctrl+P") || strings.Contains(string(raw), "onerror") {
		t.Fatalf("detail should keep plain shortcuts and drop anything else: %s", raw)
	}
}

func TestInvigilatorCanGiveExtraTimeWithAReason(t *testing.T) {
	r := newRig(t, nil)
	c, inv := r.started("A-1")
	_, me := c.do("GET", "/kiosk/api/me", nil)
	before, _ := time.Parse(time.RFC3339, me["session"].(map[string]any)["deadline"].(string))

	if code, _ := inv.do("POST", "/invigilator/api/extend", map[string]any{"service_number": "NA/1", "minutes": 10}); code != http.StatusBadRequest {
		t.Fatalf("extra time without a reason: want 400, got %d", code)
	}
	if code, body := inv.do("POST", "/invigilator/api/extend", map[string]any{"service_number": "NA/1", "minutes": 10, "reason": "Computer A-1 froze for 8 minutes"}); code != http.StatusOK {
		t.Fatalf("extend: %d %v", code, body)
	}
	_, hb := c.do("POST", "/kiosk/api/heartbeat", map[string]any{})
	after, _ := time.Parse(time.RFC3339, hb["deadline"].(string))
	if after.Sub(before) != 10*time.Minute {
		t.Fatalf("deadline should move by 10 minutes: before %v after %v", before, after)
	}
	if code, _ := inv.do("POST", "/invigilator/api/extend", map[string]any{"service_number": "NA/2", "minutes": 10, "reason": "not started"}); code != http.StatusConflict {
		t.Fatalf("extra time for a candidate who hasn't started: want 409, got %d", code)
	}
}

func TestIncidentLogDownload(t *testing.T) {
	r := newRig(t, nil)
	c, inv := r.started("A-1")
	c.do("POST", "/kiosk/api/violation", map[string]string{"kind": "screenshot_key"})
	code, body := r.raw(inv, "GET", "/invigilator/api/incidents.csv", nil, nil)
	if code != http.StatusOK || !strings.HasPrefix(body, "time_utc,service_number") || !strings.Contains(body, "screenshot_key") || !strings.Contains(body, "Test One") {
		t.Fatalf("incident CSV: %d\n%s", code, body)
	}
	if code, _ := r.raw(r.client(), "GET", "/invigilator/api/incidents.csv", nil, nil); code != http.StatusUnauthorized {
		t.Fatalf("incident CSV without console session: want 401, got %d", code)
	}
}

func TestSafeExamBrowserRequired(t *testing.T) {
	configKey := strings.Repeat("c0ffee", 10) + "c0ff"
	r := newRig(t, func(c *config.Config) { c.RequireSEB = true; c.SEBConfigKeys = []string{configKey} })
	c := r.client()
	hashFor := func(path string) string {
		u := r.url + path
		sum := sha256.Sum256([]byte(u + configKey))
		return hex.EncodeToString(sum[:])
	}
	if code, _ := r.raw(c, "GET", "/kiosk/api/status", nil, nil); code != http.StatusForbidden {
		t.Fatalf("plain browser: want 403, got %d", code)
	}
	if code, body := r.raw(c, "GET", "/kiosk/", nil, nil); code != http.StatusForbidden || !strings.Contains(body, "Safe Exam Browser") {
		t.Fatalf("plain browser kiosk page: want 403 page, got %d", code)
	}
	if code, _ := r.raw(c, "GET", "/kiosk/api/status", nil, map[string]string{"X-SafeExamBrowser-ConfigKeyHash": hashFor("/kiosk/api/status")}); code != http.StatusOK {
		t.Fatalf("SEB with the right config key: want 200, got %d", code)
	}
	if code, _ := r.raw(c, "GET", "/kiosk/api/status", nil, map[string]string{"X-SafeExamBrowser-ConfigKeyHash": hashFor("/kiosk/")}); code != http.StatusForbidden {
		t.Fatalf("a hash for a different URL must not pass: got %d", code)
	}
	if code, _ := r.raw(c, "GET", "/invigilator/api/status", nil, nil); code != http.StatusOK {
		t.Fatalf("the invigilator console isn't behind SEB: got %d", code)
	}
}
