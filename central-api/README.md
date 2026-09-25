# CBT Central Authoring & Management API

Python (FastAPI) service for the **online zone**: document library, RAG-based
question drafting from study material, instructor approval workflow, and
building the encrypted exam packages synced to venues. See
[`../docs/architecture/cbt-architecture.drawio`](../docs/architecture/cbt-architecture.drawio)
for how this fits into the whole system.

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate            # Windows
pip install -r requirements-dev.txt
```

## Run the test suite

```bash
pytest -v
```

Tests run against plain Python objects / SQLite where possible — no
Postgres or API keys required. The interesting logic (`app/services/`) is
covered directly:

- `test_question_selection.py` — the two-stage randomization: mixing past
  questions with AI-generated ones by ratio, backfilling when one source
  runs short, and proving the correct-answer index survives option
  shuffling.
- `test_crypto.py` — the AES-256-GCM envelope used for exam packages.
- `test_question_generation_parsing.py` — parsing LLM output into drafts.
- `test_documents_crud.py` — upload/list/delete for the past-question and
  study-material folders (deleting from the UI deletes the file on disk too).
- `test_draft_staging.py` — the instructor's source picker when setting
  questions for a session: past questions only (no LLM call), study material
  only (fully AI-drafted), or both (reuses bank items first, generates only
  the shortfall via AI).

## Run the API locally

```bash
docker compose -f ../docker-compose.yml up
```

This starts Postgres with the `pgvector` extension and the API on
`:8000` (`/health`, interactive docs at `/docs`). Tables are created
automatically on startup (`app/main.py`'s lifespan hook) — see the note
there about replacing this with Alembic migrations before production.

To point the API at Anthropic for question generation, set
`CBT_ANTHROPIC_API_KEY`. Without it, `app/api/routes/documents.py`'s
generate-questions endpoint fails fast with a clear error; everything else
still works.

## Regenerating the cross-language test fixture

`local-exam-server` (Go) has a test that decrypts a package this service
produced, to prove the two independently-built services actually agree on
the wire format. If you change `app/services/crypto.py`'s envelope shape,
regenerate it:

```bash
python scripts/generate_fixture_package.py
```

## What's here vs. what's a follow-up

Implemented: domain models, the pool-selection/randomization engine, the
RAG ingestion + generation pipeline (behind swappable `EmbeddingProvider` /
`LLMProvider` interfaces so it's testable without a live API key), package
encryption, and enough routes to drive the whole flow end to end.

Deliberately deferred (flag if you need these sooner):
- Alembic migrations (currently `create_all` on startup)
- Auth/RBAC enforcement on routes (models support roles; routes don't check yet)
- Async task queue for generation (currently synchronous per-request)
- Real embedding/LLM provider wiring beyond the Anthropic text-completion path
