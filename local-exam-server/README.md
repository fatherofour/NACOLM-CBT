# CBT Local Exam Server

Go service for the **offline zone**: runs on one machine per exam venue,
serves candidate kiosk workstations and the invigilator console over LAN
only, and needs no internet access on exam day. Ships as a single static
binary (pure-Go SQLite driver, no CGO) — copy it to the venue PC and run it.

See [`../docs/architecture/cbt-architecture.drawio`](../docs/architecture/cbt-architecture.drawio)
and [`../docs/architecture/cbt-process-flow.drawio`](../docs/architecture/cbt-process-flow.drawio)
for how this fits into the exam-day flow.

## Build & test

```bash
go build ./...
go test ./...
```

`internal/crypto` and `internal/exam` include tests that decrypt a fixture
package produced by the Python `central-api` service
(`central-api/scripts/generate_fixture_package.py`) — this is the real
cross-service interop check, not a same-language round-trip.

## Run it

```bash
CBT_PACKAGE_PATH=path\to\exam.cbtpkg CBT_EXAM_ID=<exam-uuid> CBT_DB_PATH=data\exam.db go run .\cmd\server
```

The server starts air-gapped-safe: `/checkin` and `/submit` are refused
with `423 Locked` until `/release` is called with the AES key (hex-encoded).
That call is the runtime equivalent of the invigilator triggering the
release key at the scheduled exam start time — the key is never read from
disk alongside the package.

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness + whether the exam has been released |
| POST | `/release` | `{"key_hex": "..."}` — decrypts the package, unlocks check-in |
| POST | `/checkin` | `{"candidate_id": "..."}` — draws and persists that candidate's randomized paper |
| GET | `/paper?candidate_id=...` | re-fetch a candidate's paper (e.g. after a kiosk restart) |
| POST | `/submit` | records responses, auto-marks MCQ locally, respects `publish_mode` |

## Randomization (`internal/randomize`)

This is stage 2 of the two-stage selection described in
`central-api/app/services/question_selection.py`. Stage 1 (central, online)
picks a pool larger than any one candidate needs, mixing past-question and
study-material-derived items. This package draws each candidate's actual
paper from that pool with three properties layered on top of a plain
random draw:

- **Topic-stratified** — a candidate's paper matches the pool's overall
  topic proportions (largest-remainder rounding), so no one gets an
  accidentally lopsided paper by chance; thin topics backfill from the rest
  of the pool rather than erroring out.
- **Exposure-controlled** — draws are weighted by how often an item has
  already been given out this sitting (squared falloff — a heavily-reused
  item becomes sharply less likely), keeping coverage balanced across the
  whole cohort instead of leaving it to chance. Exposure counts persist in
  SQLite (`pool_exposure` table) and survive a server restart.
- **Unpredictable before release** — the seed mixes in a per-sitting random
  salt that doesn't exist until `/release` is first called
  (`Store.GetOrCreateSalt`, CSPRNG-generated and persisted), so knowing the
  exam id and candidate id ahead of time is not enough to predict anyone's
  question order.

Check-in is idempotent: re-checking in an already-registered candidate (e.g.
after a kiosk restart) returns their existing stored paper rather than
drawing — and exposure-counting — a new one.

## Theory marking (`internal/marking`)

A keyword-based marking scheme for scoring theory answers offline with no
AI: the instructor breaks a model answer into concept groups (a canonical
term + synonyms, a mark value, and whether the group is required), and the
engine checks presence, sums credited marks, caps the score if a required
group is missing, and flags (zero-scores) answers that are too short to be
a real attempt regardless of keyword hits. Every match is reported by label,
so a disputed mark is explainable ("credited route security; missing
convoy control") rather than a black box.

This produces a **provisional** score — same as an AI-suggested mark would
— meant to sit in an instructor review queue before results are released,
not to auto-finalize like objective questions do.

## What's here vs. what's a follow-up

Implemented: package decryption (interop-tested against Python), the
stratified/exposure-controlled/salted randomization engine above, the
keyword theory-marking engine, SQLite persistence, and a working check-in →
answer → submit → auto-mark HTTP flow.

Deliberately deferred:
- Sync client that pulls the package pre-exam and pushes results post-exam
  (the architecture diagram's "Reconnect & sync" step) — not yet built
- Wiring `internal/marking`'s Scheme end to end: it isn't yet part of the
  package JSON format or the Store, so theory answers aren't auto-scored at
  submit time yet — the engine itself is implemented and tested standalone
- Kiosk-mode candidate UI (this is an API only right now)
- TLS on the LAN listener (local CA) and auth on the HTTP endpoints
