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

The server starts air-gapped-safe: candidates can sign in but can't start
(`423 Locked`) until `/release` is called with the AES key (hex-encoded).
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

Releasing the paper and watching the room is done at
`http://<exam-server>:8080/invigilator/` (`internal/api/invigilator/`, same
embedded-static-files pattern as the kiosk). Access is by the release key:
whoever has it already has the authority the rest of the system assumes.

- **Before release:** paste the release key (hex) handed down by the exam
  officer and press **Open exam**. That browser is then signed in to the
  console. Scripting the release with `POST /release` still works.
- **A second console** (another invigilator, another PC) signs in with the
  same key. Without a console session the roster, incident log and actions
  are refused, so a candidate on the LAN can't read or use them.
- **The roster** refreshes every 5 seconds: progress (not checked in /
  checked in / started / submitted), the computer each candidate is on,
  whether that computer is still in touch (online, or offline since when),
  integrity **flags**, and a **Paused** badge.
- **Open a candidate** to see the timeline of everything recorded for them,
  and to act:
  - **Unlock** a paused exam. Their computer resumes within seconds and
    they get a fresh allowance of warnings.
  - **Allow sign-in on another computer**, e.g. after a hardware fault.
  - **Give extra time** (1 to 120 minutes) with a reason, which is recorded.
    The candidate's timer updates within seconds.
- **Download incident log (CSV):** every event for the sitting with time,
  candidate, event, detail and whether it counted towards a pause, for the
  exam record.
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
- **Integrity controls:** see [Exam integrity](#exam-integrity) below.

## Exam integrity

A web page can detect and discourage, but never truly *prevent*, someone
switching windows: browsers reserve those keys. So there are two layers:

1. **Lock the computer down** with [Safe Exam Browser](#safe-exam-browser)
   (recommended) or the browser's kiosk mode. That removes the address bar,
   other applications, task switching and screenshots.
2. **Detect, record and respond** in the kiosk itself, which works in any
   browser and still matters under SEB (a second display, a sign-in from
   another computer, an auto-typing tool).

What the kiosk and server do:

| Control | How |
|---|---|
| One candidate, one computer | A second sign-in while the first computer is active is refused and flagged. Signing in again on the same computer (a browser restart) is fine; so is moving after the old computer has been silent for 90 seconds, or when the invigilator allows it. |
| Copying content out | Right-click, copy, cut, text selection outside the answer box and dragging are blocked. Printing is blocked and replaced with a notice. Print Screen is recorded and the clipboard overwritten where the browser allows. |
| Bringing content in | Paste and drop are blocked and recorded. A large block of text appearing in one go (an auto-typing tool, an extension) is recorded. Autocomplete and spellcheck are off. |
| Shortcuts | Save, print, find, view source, developer tools, reload, history, address bar and back/forward are blocked and recorded. |
| Leaving the exam | Full screen on Start, with a prompt and a record if they leave it. Losing focus or the tab being hidden is recorded. The browser's own "leave this page?" prompt guards closing. |
| Second display | Detected where the browser exposes it (Chrome, Edge); shown to the candidate and recorded. |
| Photos of the screen | The candidate's service number, name and computer are watermarked faintly across the exam. |
| Pause after warnings | After `CBT_LOCK_AFTER` counted warnings (default 5; `0` turns it off) the exam pauses until the invigilator unlocks it. The clock keeps running. Leaving the window fires several events together; within 3 seconds they count once. |
| Liveness | The kiosk checks in every 10 seconds, so the console shows a computer that has gone quiet. |
| Timing | Server-side deadline; extra time only by the invigilator, with a reason. |
| Tamper resistance | All decisions (pause, unlock, deadline, sign-in) are made by the server; editing the page can stop reports but can't unpause or add time. Answers lock at submit (SQLite triggers) and are hashed. |
| Record | Every event is stored with time and detail and downloadable as CSV from the console. |

Events are evidence for the invigilator's judgement, not proof of
malpractice on their own: a window can lose focus for innocent reasons.

### Safe Exam Browser

[Safe Exam Browser](https://safeexambrowser.org) (SEB) is the open-source
lockdown browser widely used for this. Create an exam configuration in the
SEB Config Tool:

- **Start URL:** `http://<exam-server>:8080/kiosk/?seat=<computer>` (one
  config per computer, or set the seat label on each machine).
- **Allowed URLs:** only the exam server.
- **Security:** disallow quitting without the quit password, block
  screen capture and screen sharing, block virtual machines, enable
  "Send Browser Exam Key and Config Key" in the request headers.
- Copy the **Config Key** (or the Browser Exam Key) shown in the tool.

Then start the server with:

```
CBT_SEB_CONFIG_KEYS=<config key>[,<another>]      # or CBT_SEB_BROWSER_EXAM_KEYS=...
```

Every kiosk request must then carry SEB's hash of that key and the exact
URL; anything else gets "Safe Exam Browser required". `CBT_REQUIRE_SEB=true`
without keys only checks SEB's user agent, which anyone can fake, so use
keys for a real sitting. The invigilator console is not behind SEB.

If SEB isn't available, run each computer's browser in kiosk mode under a
locked-down exam user account:
`msedge --kiosk "http://<exam-server>:8080/kiosk/?seat=A-14" --edge-kiosk-type=fullscreen`.

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
| GET | `/status` | centre name, whether the paper is open, the pause threshold |
| POST | `/login` | `{"service_number","pin","seat"}` → httpOnly session cookie |
| POST | `/logout` | end the kiosk session |
| GET | `/me` | candidate, paper details, whether started/submitted, integrity state |
| POST | `/start` | draw the paper if needed, start the clock once, return questions + saved answers + deadline |
| PUT | `/answer` | `{"position","selected_index"}` or `{"position","answer_text"}`; `423` while paused |
| POST | `/violation` | `{"kind","detail"}`: an integrity event; returns the warning count and whether the exam is now paused |
| POST | `/heartbeat` | keeps the computer online on the console; returns deadline and pause state |
| POST | `/submit` | close the paper, mark objective answers, return the result the candidate may see |

### Invigilator endpoints (`/invigilator/api/…`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/status` | centre, whether released, whether this browser is signed in |
| POST | `/release` | `{"key_hex"}`: open the exam; signs this browser in |
| POST | `/login` | `{"key_hex"}`: sign another console in after release |
| GET | `/candidates` | roster with progress, computer, online, flags, pause (signed in) |
| GET | `/events?candidate=` | one candidate's timeline (signed in) |
| POST | `/unlock`, `/allow-move` | `{"service_number"}` (signed in) |
| POST | `/extend` | `{"service_number","minutes","reason"}` (signed in) |
| GET | `/incidents.csv` | the sitting's incident log (signed in) |
| GET | `/results.json` | the signed results file for the portal: each submitted candidate's objective score and per-question answers, HMAC-signed with the key carried in the package (signed in) |

### Other endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness + whether the exam has been released |
| POST | `/release` | `{"key_hex": "..."}`: decrypts the package (for scripted release) |

The earlier id-only `/checkin`, `/paper` and `/submit` endpoints are gone:
they let any device on the LAN read or submit any candidate's paper.

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
answer → submit → auto-mark kiosk flow, the invigilator console (release,
live status, unlock, extra time, incident log), the exam integrity controls
and Safe Exam Browser check, TLS on the LAN listener, and DB-enforced immutability
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
