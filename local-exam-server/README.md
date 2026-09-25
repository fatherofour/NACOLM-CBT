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
CBT_PACKAGE_PATH=path\to\exam.cbtpkg CBT_EXAM_ID=<exam-uuid> CBT_DB_PATH=data\exam.db CBT_ROSTER_PATH=roster.csv CBT_CENTRE_NAME="Hall A" go run .\cmd\server
```

The server starts air-gapped-safe: `/checkin` and `/submit` are refused
with `423 Locked` until `/release` is called with the AES key (hex-encoded).
That call is the runtime equivalent of the invigilator triggering the
release key at the scheduled exam start time — the key is never read from
disk alongside the package.

## Candidate kiosk

The server also serves the candidate exam screens at `/kiosk/` — sign-in,
details and instructions, the exam, review, submit — from files embedded in
the binary (`internal/api/kiosk/`: plain HTML, CSS and JavaScript, no build
step, no internet). Open it on each exam computer in the browser's kiosk
mode, with the computer's label in the URL:

```
chromium --kiosk "http://<exam-server>:8080/kiosk/?seat=A-14"
```

- **Sign-in:** service number + the PIN on the admission slip, checked
  against the venue roster (`CBT_ROSTER_PATH`). Five wrong PINs lock that
  service number for 10 minutes.
- **Instructions** wait for `/release` ("Waiting for the invigilator to open
  this paper…"), then the candidate ticks the box and starts.
- **Timer:** the deadline is set on the server the first time the candidate
  presses Start and never moves, even if the computer restarts. At 00:00 the
  kiosk submits automatically; the server refuses changes after the deadline
  plus 60 seconds.
- **Autosave:** every answer is sent as it's given. If the LAN drops, answers
  queue in the browser and send when it's back; the screen says so.
- **Submit:** objective answers are marked immediately. With
  `publish_mode: immediate` the candidate sees their objective score;
  otherwise they're told results come from the instructor.
- The paper sent to the kiosk never includes correct answers or model
  answers. The page sends a strict Content-Security-Policy and blocks
  right-click, copy and paste during the exam.

### Roster CSV

```
service_number,rank,full_name,pin
NA/24/0412,2Lt,A. Okafor,482913
```

### Try it with demo data

```bash
go run ./cmd/demo-package -out ./demo            # writes exam.cbtpkg, key.hex, roster.csv and prints the next steps
```

It prints the command to start the server, the kiosk URL, a candidate to
sign in as, and the `curl` that opens the paper.

### Kiosk endpoints (`/kiosk/api/…`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/status` | centre name, whether the paper is open |
| POST | `/login` | `{"service_number","pin"}` → httpOnly session cookie |
| POST | `/logout` | end the kiosk session |
| GET | `/me` | candidate, paper details, whether started/submitted |
| POST | `/start` | draw the paper if needed, start the clock once, return questions + saved answers + deadline |
| PUT | `/answer` | `{"position","selected_index"}` or `{"position","answer_text"}` |
| POST | `/submit` | close the paper, mark objective answers, return the result the candidate may see |

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/kiosk/` | the candidate kiosk (see above) |
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
- Invigilator console (release the paper, see who's signed in, reset a PIN)
- Theory answers at the centre: the kiosk collects them, but the keyword
  scheme isn't in the package yet, so they aren't auto-scored on submit
- TLS on the LAN listener (local CA) and auth on the HTTP endpoints
