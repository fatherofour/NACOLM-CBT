package api

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"cbt.army.mil.ng/local-exam-server/internal/config"
	"cbt.army.mil.ng/local-exam-server/internal/models"
	"cbt.army.mil.ng/local-exam-server/internal/roster"
	"cbt.army.mil.ng/local-exam-server/internal/store"
)

const testExam = "kiosk-test-exam"

// writePackage encrypts a small pool the same way central-api does.
func writePackage(t *testing.T, dir, publish string) (string, string) {
	t.Helper()
	i := func(v int) *int { return &v }
	model := "security access dispersion"
	pkg := models.ExamPackage{ExamID: testExam, Title: "Kiosk test paper", DurationMinutes: 30, QuestionsPerCandidate: 3, PublishMode: publish,
		Pool: []models.PoolItem{
			{ID: "a", Type: "mcq", Topic: "T", Stem: "Pick B", Options: []string{"A", "B", "C"}, CorrectIndex: i(1)},
			{ID: "b", Type: "mcq", Topic: "T", Stem: "Pick A", Options: []string{"A", "B"}, CorrectIndex: i(0)},
			{ID: "c", Type: "theory", Topic: "T", Stem: "Explain", ModelAnswer: &model},
		}}
	plain, _ := json.Marshal(pkg)
	key := bytes.Repeat([]byte{7}, 32)
	nonce := bytes.Repeat([]byte{1}, 12)
	block, _ := aes.NewCipher(key)
	gcm, _ := cipher.NewGCM(block)
	env, _ := json.Marshal(map[string]any{"version": 1, "nonce": base64.StdEncoding.EncodeToString(nonce), "ciphertext": base64.StdEncoding.EncodeToString(gcm.Seal(nil, nonce, plain, []byte(testExam)))})
	path := filepath.Join(dir, "exam.cbtpkg")
	if err := os.WriteFile(path, env, 0o600); err != nil {
		t.Fatal(err)
	}
	return path, hex.EncodeToString(key)
}

type client struct {
	t   *testing.T
	url string
	c   *http.Client
}

func (c client) do(method, path string, body any) (int, map[string]any) {
	c.t.Helper()
	var r *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	} else {
		r = bytes.NewReader(nil)
	}
	req, _ := http.NewRequest(method, c.url+path, r)
	res, err := c.c.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer res.Body.Close()
	out := map[string]any{}
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

func setup(t *testing.T, publish string) (client, string) {
	dir := t.TempDir()
	pkgPath, key := writePackage(t, dir, publish)
	st, err := store.Open(filepath.Join(dir, "exam.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	srv := NewServer(config.Config{PackagePath: pkgPath, ExamID: testExam, CentreName: "Hall A"}, st)
	rs, err := roster.Parse(strings.NewReader("service_number,rank,full_name,pin\nNA/1,Lt,Test One,123456\n"))
	if err != nil {
		t.Fatal(err)
	}
	srv.SetRoster(rs)
	ts := httptest.NewServer(srv.Router())
	t.Cleanup(ts.Close)
	jar, _ := cookiejar.New(nil)
	return client{t: t, url: ts.URL, c: &http.Client{Jar: jar}}, key
}

func TestKioskFlow(t *testing.T) {
	c, key := setup(t, "immediate")

	if code, _ := c.do("GET", "/kiosk/api/me", nil); code != http.StatusUnauthorized {
		t.Fatalf("me before sign-in: want 401, got %d", code)
	}
	if code, _ := c.do("POST", "/kiosk/api/login", map[string]string{"service_number": "NA/1", "pin": "000000"}); code != http.StatusUnauthorized {
		t.Fatalf("wrong PIN: want 401, got %d", code)
	}
	if code, _ := c.do("POST", "/kiosk/api/login", map[string]string{"service_number": "na/1", "pin": "123456"}); code != http.StatusOK {
		t.Fatalf("sign-in: want 200, got %d", code)
	}
	if code, _ := c.do("POST", "/kiosk/api/start", nil); code != http.StatusLocked {
		t.Fatalf("start before release: want 423, got %d", code)
	}
	if code, _ := c.do("POST", "/release", map[string]string{"key_hex": key}); code != http.StatusOK {
		t.Fatalf("release: got %d", code)
	}

	code, start := c.do("POST", "/kiosk/api/start", nil)
	if code != http.StatusOK {
		t.Fatalf("start: got %d %v", code, start)
	}
	raw, _ := json.Marshal(start["questions"])
	if strings.Contains(string(raw), "correct") || strings.Contains(string(raw), "model_answer") {
		t.Fatalf("paper sent to the kiosk must not include answers: %s", raw)
	}
	qs := start["questions"].([]any)
	if len(qs) != 3 {
		t.Fatalf("want 3 questions, got %d", len(qs))
	}
	deadline := start["session"].(map[string]any)["deadline"]

	// Options are shuffled per candidate, so answer by option text.
	indexOf := func(m map[string]any, text string) int {
		for i, o := range m["options"].([]any) {
			if o == text {
				return i
			}
		}
		t.Fatalf("option %q not found", text)
		return -1
	}
	for _, q := range qs {
		m := q.(map[string]any)
		pos := int(m["position"].(float64))
		switch m["stem"] {
		case "Pick B":
			if code, _ := c.do("PUT", "/kiosk/api/answer", map[string]any{"position": pos, "selected_index": 9}); code != http.StatusBadRequest {
				t.Fatalf("out-of-range option: want 400, got %d", code)
			}
			c.do("PUT", "/kiosk/api/answer", map[string]any{"position": pos, "selected_index": indexOf(m, "B")})
		case "Pick A":
			c.do("PUT", "/kiosk/api/answer", map[string]any{"position": pos, "selected_index": indexOf(m, "A")})
		default:
			if code, _ := c.do("PUT", "/kiosk/api/answer", map[string]any{"position": pos, "answer_text": "A secure site with road access."}); code != http.StatusOK {
				t.Fatalf("theory answer: got %d", code)
			}
		}
	}

	// Signing in again (kiosk restart) keeps the paper, answers and deadline.
	_, again := c.do("POST", "/kiosk/api/start", nil)
	if again["session"].(map[string]any)["deadline"] != deadline {
		t.Fatal("deadline must not move on restart")
	}
	if n := len(again["answers"].([]any)); n != 3 {
		t.Fatalf("want 3 saved answers after restart, got %d", n)
	}

	code, res := c.do("POST", "/kiosk/api/submit", nil)
	if code != http.StatusOK || res["objective_correct"].(float64) != 2 || res["objective_total"].(float64) != 2 {
		t.Fatalf("submit: got %d %v", code, res)
	}
	if code, _ := c.do("PUT", "/kiosk/api/answer", map[string]any{"position": 0, "selected_index": 0}); code != http.StatusConflict {
		t.Fatalf("answer after submit: want 409, got %d", code)
	}
	_, again2 := c.do("POST", "/kiosk/api/submit", nil)
	if again2["reference"] != res["reference"] {
		t.Fatal("submitting twice must return the same submission")
	}
}

func TestKioskHeldResultsAndLockout(t *testing.T) {
	c, key := setup(t, "instructor_controlled")
	c.do("POST", "/release", map[string]string{"key_hex": key})
	for i := 0; i < 5; i++ {
		c.do("POST", "/kiosk/api/login", map[string]string{"service_number": "NA/1", "pin": "999999"})
	}
	if code, _ := c.do("POST", "/kiosk/api/login", map[string]string{"service_number": "NA/1", "pin": "123456"}); code != http.StatusTooManyRequests {
		t.Fatalf("after 5 wrong PINs: want 429, got %d", code)
	}
}

func TestKioskHeldResultsHideScore(t *testing.T) {
	c, key := setup(t, "instructor_controlled")
	c.do("POST", "/release", map[string]string{"key_hex": key})
	c.do("POST", "/kiosk/api/login", map[string]string{"service_number": "NA/1", "pin": "123456"})
	c.do("POST", "/kiosk/api/start", nil)
	_, res := c.do("POST", "/kiosk/api/submit", nil)
	if _, shown := res["objective_correct"]; shown {
		t.Fatalf("held results must not reach the kiosk: %v", res)
	}
}

func TestKioskServesPage(t *testing.T) {
	c, _ := setup(t, "immediate")
	res, err := c.c.Get(c.url + "/kiosk/")
	if err != nil || res.StatusCode != 200 {
		t.Fatalf("kiosk page: %v %v", err, res)
	}
	if res.Header.Get("Content-Security-Policy") == "" {
		t.Fatal("kiosk page must send a CSP")
	}
}
