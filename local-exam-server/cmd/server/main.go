// Command server runs the offline local exam server for one venue, for one
// exam. It serves the candidate kiosk client and the invigilator console
// over LAN only — see docs/architecture/cbt-architecture.drawio for where
// this sits relative to the central authoring service.
package main

import (
	"log"
	"net/http"

	"cbt.army.mil.ng/local-exam-server/internal/api"
	"cbt.army.mil.ng/local-exam-server/internal/config"
	"cbt.army.mil.ng/local-exam-server/internal/store"
)

func main() {
	cfg, err := config.FromEnv()
	if err != nil {
		log.Fatalf("config error: %v", err)
	}

	st, err := store.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("failed to open local store: %v", err)
	}
	defer st.Close()

	server := api.NewServer(cfg, st)

	log.Printf("local exam server listening on %s (exam=%s, package=%s)", cfg.ListenAddr, cfg.ExamID, cfg.PackagePath)
	log.Printf("waiting for POST /release before any candidate can check in")
	if err := http.ListenAndServe(cfg.ListenAddr, server.Router()); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
