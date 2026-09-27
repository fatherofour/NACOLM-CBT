# Standards and controls: status

Working notes on where NACOLM CBT stands against the CBT industry
standards/controls checklist it was evaluated against. Each area below was a
deliberate scope decision, not an oversight — see the linked doc for the
ones with more to say.

| Area | Status |
|---|---|
| Interoperability (QTI, LTI, ISO/IEC 23988, IEEE P1484.20.1) | QTI 2.1 export implemented; LTI and the rest planned, not built — see [interoperability.md](./interoperability.md) |
| TLS in transit | Implemented on the local-exam-server LAN listener (`CBT_TLS_CERT`/`CBT_TLS_KEY`, `cmd/gen-cert` for a per-venue self-signed cert) |
| Immutable submissions | Implemented: DB-level triggers block editing a candidate's responses once submitted, plus a SHA-256 tamper-evidence hash stamped at submit time (`local-exam-server/internal/store`) |
| Concurrent capacity | No auto-scaling infrastructure, by request. Tuned and load-tested toward a 10,000-concurrent target on a single deployment — see [capacity.md](./capacity.md) |
| Lockdown browser | **Deferred.** Kiosk mode today relies on the OS-level `chromium --kiosk` flag only; no in-app tab-switch/screenshot detection |
| Remote proctoring (AI identity/gaze/audio) | **Deferred, alongside lockdown browser.** Not applicable to the current in-person, invigilated exam model — revisit only if remote sitting is ever introduced |
| Data privacy (GDPR/CCPA/COPPA-style program) | **Out of scope, by request.** Note that the actually-relevant law for a Nigerian Army institution is the NDPR, not the US/EU regimes this checklist named |
