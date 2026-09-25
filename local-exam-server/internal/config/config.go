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
}

func FromEnv() (Config, error) {
	cfg := Config{
		ListenAddr:  getOr("CBT_LISTEN_ADDR", ":8080"),
		DBPath:      getOr("CBT_DB_PATH", "./data/exam.db"),
		PackagePath: os.Getenv("CBT_PACKAGE_PATH"),
		ExamID:      os.Getenv("CBT_EXAM_ID"),
	}
	if cfg.PackagePath == "" {
		return cfg, fmt.Errorf("CBT_PACKAGE_PATH is required (path to the synced .cbtpkg file)")
	}
	if cfg.ExamID == "" {
		return cfg, fmt.Errorf("CBT_EXAM_ID is required")
	}
	return cfg, nil
}

func getOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
