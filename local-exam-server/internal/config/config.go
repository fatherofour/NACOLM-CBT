// Package config holds the local exam server's runtime configuration. Kept
// deliberately tiny: this process only ever serves one exam, at one venue,
// for one day — it is not a multi-tenant service.
package config

import (
	"encoding/hex"
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	ListenAddr    string
	DBPath        string
	PackagePath   string
	ExamID        string
	ReleaseKeyHex string // populated at exam start by the release mechanism, not before

	// Candidate kiosk (served at /kiosk/). RosterPath is a CSV of the
	// candidates allowed to sit this paper at this venue; without it no one
	// can sign in to the kiosk. CentreName is shown on the sign-in screen.
	RosterPath string
	CentreName string

	// TLS for the LAN listener. Without these the server falls back to
	// plain HTTP — candidate PINs and answers then travel in cleartext on
	// the venue LAN. cmd/gen-cert makes a self-signed cert per venue (there
	// is no real CA to reach from an air-gapped room), so this is "LAN
	// traffic isn't plaintext," not "browsers trust this certificate."
	TLSCertPath string
	TLSKeyPath  string

	// Exam integrity. LockAfter pauses a candidate's exam after that many
	// integrity warnings (leaving the exam screen, a second display, print or
	// screenshot attempts) until the invigilator unlocks it; 0 never pauses.
	LockAfter int

	// Safe Exam Browser. When RequireSEB is set, the kiosk is only served to
	// SEB. With keys configured each request must carry SEB's per-request
	// hash of one of them (the Config Key or Browser Exam Key from the SEB
	// Config Tool); without keys only SEB's user agent is checked, which is
	// a much weaker test.
	RequireSEB         bool
	SEBConfigKeys      []string
	SEBBrowserExamKeys []string
}

func (c Config) TLSEnabled() bool { return c.TLSCertPath != "" && c.TLSKeyPath != "" }

func FromEnv() (Config, error) {
	cfg := Config{
		ListenAddr:  getOr("CBT_LISTEN_ADDR", ":8080"),
		DBPath:      getOr("CBT_DB_PATH", "./data/exam.db"),
		PackagePath: os.Getenv("CBT_PACKAGE_PATH"),
		ExamID:      os.Getenv("CBT_EXAM_ID"),
		RosterPath:  os.Getenv("CBT_ROSTER_PATH"),
		CentreName:  getOr("CBT_CENTRE_NAME", "Exam centre"),
		TLSCertPath: os.Getenv("CBT_TLS_CERT"),
		TLSKeyPath:  os.Getenv("CBT_TLS_KEY"),
		LockAfter:   5,
	}
	if v := os.Getenv("CBT_LOCK_AFTER"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			return cfg, fmt.Errorf("CBT_LOCK_AFTER must be a whole number (0 turns pausing off)")
		}
		cfg.LockAfter = n
	}
	var err error
	if cfg.SEBConfigKeys, err = hexKeys("CBT_SEB_CONFIG_KEYS"); err != nil {
		return cfg, err
	}
	if cfg.SEBBrowserExamKeys, err = hexKeys("CBT_SEB_BROWSER_EXAM_KEYS"); err != nil {
		return cfg, err
	}
	cfg.RequireSEB = os.Getenv("CBT_REQUIRE_SEB") == "true" || len(cfg.SEBConfigKeys) > 0 || len(cfg.SEBBrowserExamKeys) > 0
	if cfg.PackagePath == "" {
		return cfg, fmt.Errorf("CBT_PACKAGE_PATH is required (path to the synced .cbtpkg file)")
	}
	if cfg.ExamID == "" {
		return cfg, fmt.Errorf("CBT_EXAM_ID is required")
	}
	if (cfg.TLSCertPath == "") != (cfg.TLSKeyPath == "") {
		return cfg, fmt.Errorf("CBT_TLS_CERT and CBT_TLS_KEY must both be set, or neither")
	}
	return cfg, nil
}

// hexKeys reads a comma-separated list of 64-character hex SEB keys.
func hexKeys(name string) ([]string, error) {
	var out []string
	for _, k := range strings.Split(os.Getenv(name), ",") {
		k = strings.ToLower(strings.TrimSpace(k))
		if k == "" {
			continue
		}
		if b, err := hex.DecodeString(k); err != nil || len(b) != 32 {
			return nil, fmt.Errorf("%s: each key must be 64 hex characters, as shown in the SEB Config Tool", name)
		}
		out = append(out, k)
	}
	return out, nil
}

func getOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
