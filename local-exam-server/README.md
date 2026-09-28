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

### The invigilator's own PC can be the server

This is one process, not a client/server pair of separate machines — it's
fine, and the recommended small-venue setup, for the invigilator's own PC to
run `cmd/server` while also being where they watch the
[invigilator console](#invigilator-console). `CBT_LISTEN_ADDR` binds every
network interface by default (`:8080`, i.e. `0.0.0.0:8080`), so the same
running process is reachable two ways at once:

- **Candidate PCs elsewhere on the venue LAN** open
  `http://<invigilator-PC-LAN-IP>:8080/kiosk/?seat=<label>` — find that IP
  with `ipconfig` (Windows) or `ip addr` (Linux) beforehand and write it on
  the whiteboard, or set `CBT_CENTRE_NAME` and let candidates confirm the
  centre name on the sign-in screen matches.
- **The invigilator, on that same PC**, just opens
  `http://localhost:8080/invigilator/` in a normal browser window — no
  network hop, no separate machine to provision.

For a venue with only a handful of computers this means no dedicated server
hardware at all: one of the exam PCs (the invigilator's) does double duty.
For a larger venue, running the server on its own machine and putting the
invigilator console on a second monitor there works exactly the same way —
nothing about the server cares which physical box it's on.

The server starts air-gapped-safe: `/checkin` and `/submit` are refused
with `423 Locked` until `/release` is called with the AES key (hex-encoded).
That call is the runtime equivalent of the invigilator triggering the
release key at the scheduled exam start time — the key is never read from
disk alongside the package.

## TLS

Without `CBT_TLS_CERT`/`CBT_TLS_KEY` the server runs plain HTTP, so
candidate PINs and answers travel unencrypted on the venue LAN. There's no
real CA reachable from an air-gapped exam room, so generate a self-signed
cert per venue with `cmd/gen-cert`:

```bash
go run ./cmd/gen-cert -host <venue-lan-ip>,localhost -out ./certs
CBT_TLS_CERT=./certs/cert.pem CBT_TLS_KEY=./certs/key.pem CBT_PACKAGE_PATH=... go run ./cmd/server
```

Candidate browsers will show a "not trusted" warning for the self-signed
cert — installing it on the venue's lab machines ahead of time avoids that,
but isn't required for the encryption itself to work. The kiosk's session
cookie automatically gets the `Secure` flag once TLS is on.

## Invigilator console

Releasing the paper and watching who's signed in is done at
`http://<exam-server>:8080/invigilator/` (`internal/api/invigilator/`, same
embedded-static-files pattern as the kiosk) — there is no separate login,
since whoever has the release key already has the authority the rest of the
system assumes they have.

- **Before release:** a form to paste the release key (hex) handed down by
  the exam officer and press **Open exam**. This calls the same `/release`
  endpoint the API exposes directly, so scripting the release (e.g. from a
  timed job) still works.
- **After release:** a live table of every roster candidate and their
  progress — not checked in / checked in / started / submitted, with the
  submission reference — refreshing every 5 seconds, so the invigilator can
  see who hasn't sat down yet without walking the room.
- If `CBT_ROSTER_PATH` isn't set, the console says so plainly instead of
  silently showing an empty room.

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
  answers.
- **Browser lockdown controls**, honestly scoped — a web page can detect and
  discourage, but never truly *prevent*, someone switching tabs or closing a
  window; there's no browser API for that. True lockdown needs a native
  kiosk browser or OS-level tooling, which is out of scope here. What the
  kiosk actually does:
  - Blocks right-click, copy, cut, paste and drag-drop during the exam, and
    sends a strict Content-Security-Policy.
  - Requests full-screen when the candidate presses Start, and shows a
    "return to full screen" prompt (with a reminder that it's recorded) if
    they leave it.
  - `beforeunload` triggers the browser's own native "leave this page?"
    confirmation if the candidate tries to close or navigate away.
  - Detects the tab being hidden or the window losing focus and reports it
    to the server as it happens.
  - Every one of those detections is logged per candidate
    (`POST /kiosk/api/violation`, `internal/store/violations.go`) and shown
    as a **Flags** count on the invigilator console's roster table — the
    point isn't to silently collect evidence, it's to put an actionable
    signal in front of the person actually in the room.

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
keyword theory-marking engine, SQLite persistence, a working check-in →
answer → submit → auto-mark HTTP flow, the invigilator console for release +
live candidate status, TLS on the LAN listener, and DB-enforced immutability
of submitted answers (a candidate's responses can't be changed once
submitted — enforced by SQLite triggers, not just handler code — and a
SHA-256 of the final answers is stamped at submit time so tampering is
detectable even if that were ever bypassed; see `internal/store/kiosk.go`'s
`MarkSubmitted`).

Deliberately deferred:
- Sync client that pulls the package pre-exam and pushes results post-exam
  (the architecture diagram's "Reconnect & sync" step) — not yet built
- Wiring `internal/marking`'s Scheme end to end: it isn't yet part of the
  package JSON format or the Store, so theory answers aren't auto-scored at
  submit time yet — the engine itself is implemented and tested standalone
- Resetting a candidate's PIN from the invigilator console — the console
  covers release and live status, but a forgotten/misprinted PIN still means
  regenerating the roster CSV and restarting with it
- Theory answers at the centre: the kiosk collects them, but the keyword
  scheme isn't in the package yet, so they aren't auto-scored on submit
- Auth on the HTTP endpoints (release, checkin, submit) — TLS is now done,
  see below
