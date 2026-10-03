package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"testing"
)

func TestSignedResultsExport(t *testing.T) {
	r := newRig(t, nil)
	c, inv := r.started("A-1")
	_, start := c.do("POST", "/kiosk/api/start", nil)
	for _, q := range start["questions"].([]any) {
		q := q.(map[string]any)
		if q["type"] == "mcq" {
			c.do("PUT", "/kiosk/api/answer", map[string]any{"position": q["position"], "selected_index": 0})
		}
	}
	if code, body := c.do("POST", "/kiosk/api/submit", nil); code != http.StatusOK || body["theory_on_paper"].(float64) != 2 {
		t.Fatalf("submit: %d %v", code, body)
	}

	if code, _ := r.raw(r.client(), "GET", "/invigilator/api/results.json", nil, nil); code != http.StatusUnauthorized {
		t.Fatalf("results without console session: want 401, got %d", code)
	}
	code, body := r.raw(inv, "GET", "/invigilator/api/results.json", nil, nil)
	if code != http.StatusOK {
		t.Fatalf("export: %d %s", code, body)
	}
	var env resultsEnvelope
	if err := json.Unmarshal([]byte(body), &env); err != nil {
		t.Fatal(err)
	}
	payload, _ := base64.StdEncoding.DecodeString(env.Payload)
	key, _ := hex.DecodeString(testResultsKey)
	mac := hmac.New(sha256.New, key)
	mac.Write(payload)
	if env.Signature != hex.EncodeToString(mac.Sum(nil)) || env.Format != resultsFormat || env.ExamID != testExam {
		t.Fatalf("signature or header wrong: %+v", env)
	}
	var p resultsPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		t.Fatal(err)
	}
	if len(p.Candidates) != 1 || len(p.NotSubmitted) != 1 || p.NotSubmitted[0] != "NA/2" {
		t.Fatalf("expected one submitted (NA/1) and one not submitted (NA/2): %+v", p)
	}
	rc := p.Candidates[0]
	mcq := 0
	for _, it := range rc.Items {
		if it.Type == "mcq" {
			mcq++
		}
	}
	if rc.ServiceNumber != "NA/1" || rc.ObjectiveTotal != mcq || rc.ObjectiveCorrect > rc.ObjectiveTotal || rc.ResponseHash == "" || rc.Reference == "" {
		t.Fatalf("candidate row wrong: %+v", rc)
	}
}
