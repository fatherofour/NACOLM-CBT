# Nigerian Army College — LMS & CBT Platform

Two separate systems built independently:

- **CBT** (this repo's current focus) — question authoring, AI-assisted
  drafting from study material, instructor approval, and fully offline exam
  delivery at venues.
- **LMS** — not yet scaffolded.

## Architecture

- [`docs/architecture/cbt-architecture.drawio`](docs/architecture/cbt-architecture.drawio) —
  component architecture: online authoring zone vs. offline exam-venue zone.
- [`docs/architecture/cbt-process-flow.drawio`](docs/architecture/cbt-process-flow.drawio) —
  process flow across exam creation, exam day, and post-exam.

Open either in [diagrams.net](https://app.diagrams.net) (File → Open) or the
draw.io VS Code extension.

## Services

| Service | Language | Role |
|---|---|---|
| [`central-api`](central-api/) | Python (FastAPI) | Online: document library, RAG question drafting, exam package builder — also the AI/RAG engine `instructor-api` calls into |
| [`instructor-api`](instructor-api/) | TypeScript (NestJS + Prisma) | Online: the instructor question-setting workflow — auth, wizard, draft review/approval, theory marking schemes, blueprint coverage, paper freeze |
| [`instructor-web`](instructor-web/) | TypeScript (Next.js) | Online: the instructor portal UI — sign-in, wizard, review, marking schemes, freeze, question bank, study material, results |
| [`local-exam-server`](local-exam-server/) | Go | Offline: runs per venue, serves candidates over LAN, no internet needed on exam day |

The split follows where each language's ecosystem actually helps: Python for
the AI/document-processing pipeline, TypeScript/NestJS for the instructor
workflow's richer relational data model, Go because the exam-day delivery
point needs to ship as one dependency-free static binary onto venue hardware
you don't get to babysit.

`instructor-web` talks only to `instructor-api` (through its `/api` rewrite),
so the session cookie stays first-party and no CORS is needed. Sign-in uses
server-side sessions in `instructor-api` (instant revocation, roles for
Instructor vs. Exam Officer); accounts are created with
`instructor-api/scripts/create-user.mjs`, not self-registration.

## The past-question / study-material mix

Every exam's `past_question_ratio` controls how much of its question pool
comes from vetted past questions vs. AI-drafted-from-study-material
questions (`central-api/app/services/question_selection.py`). If the past-
question archive for a topic runs short, the pool builder automatically
backfills from AI-generated questions instead of failing — and vice versa.
Both sources go through the same draft → instructor-approval lifecycle
before either is eligible for an exam.

Each candidate then draws their own paper from that pool **offline, at the
venue** (`local-exam-server/internal/randomize`) — different question
subset, different order, different MCQ option order per candidate, with no
need to contact the central service on exam day.

## Candidates and exam day

Registering who's allowed to sit an exam is separate from the question
content, and travels to the venue a different way:

1. **Register candidates** in the portal (`/sessions/:id/candidates` in
   `instructor-web`) — one at a time or bulk-imported. A PIN is generated
   per candidate and shown exactly once, the same as a staff password; a
   lost admission slip means resetting the PIN and reprinting, not looking
   the old one up.
2. **Download the roster CSV** from that same screen right after
   registering — `service_number,rank,full_name,pin` — and hand it to
   whoever preps the venue machine.
3. **Package the question content** from the Freeze screen
   (`instructor-api` → `central-api`'s `/package-bridge/build`) — this
   produces the encrypted `.cbtpkg` and a release key. The roster does
   **not** travel inside this file.
4. At the venue, `local-exam-server` loads the package (`CBT_PACKAGE_PATH`)
   and the roster CSV (`CBT_ROSTER_PATH`) independently. Candidates sign
   into the embedded kiosk UI at `/kiosk/` with their service number + PIN,
   checked against the CSV with SHA-256 (constant-time compare) — no
   network round-trip, no dependency on `instructor-api` being reachable.

`local-exam-server/cmd/demo-package` writes a sample package, key and
roster in one shot if you want to try the kiosk without running the whole
authoring chain first.

## Getting started

```bash
# Central API
cd central-api
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements-dev.txt
pytest -v

# Instructor API (needs Postgres — see docker-compose.yml)
cd instructor-api
npm install
npx prisma migrate dev
npm test
npm run build
node scripts/create-user.mjs --service NA/00001 --rank Capt --name "Your Name" --role EXAM_OFFICER
node scripts/seed-demo.mjs   # optional: sample course/session/questions

# Instructor web
cd instructor-web
npm install
npm run build

# Local exam server
cd local-exam-server
go test ./...
go build ./...
```

Each service's README has the full setup and a note on what's implemented
vs. deferred.

## Cross-service interop

The riskiest integration point in this architecture is the encrypted
package: two independently-built services (Python writes it, Go reads it)
have to agree on the exact wire format. That's why
`central-api/scripts/generate_fixture_package.py` produces a real fixture
that `local-exam-server`'s Go tests decrypt — a genuine cross-language
proof, not just same-language round-trip tests on each side.
