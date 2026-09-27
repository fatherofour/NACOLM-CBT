// Package config holds the local exam server's runtime configuration. Kept
// deliberately tiny: this process only ever serves one exam, at one venue,
// for one day — it is not a multi-tenant service.
package config

import (
	"fmt"
	"os"
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
	}
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

func getOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
