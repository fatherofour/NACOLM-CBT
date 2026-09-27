# Interoperability standards: what's in place, and the plan for growth

NACOLM CBT is a closed, single-institution system today — there is no LMS on
the other end of anything, and no other institution to exchange content
with. Building full protocol integrations (LTI's OIDC launch flow, a QTI
import path) against a counterpart that doesn't exist would be untested,
unmaintainable code. This document is the plan for what to build, and when,
as that changes — plus what's already real.

## What's implemented today

**QTI 2.1 export** — `GET /papers/:paperVersionId/qti` on instructor-api
(`src/qti/`) exports any frozen paper version as a standard IMS QTI 2.1
content package: an `imsmanifest.xml`, one `assessmentItem` XML per
question, and an `assessmentTest` XML tying them together, zipped up the way
QTI-consuming tools expect. This is genuinely interoperable today — the
output validates as a normal ZIP and the XML follows the QTI 2.1 schema —
not a placeholder for later.

**Scope of the export, deliberately:**
- Objective (MCQ) items: stem, options, and the correct answer, using QTI's
  standard `choiceInteraction` + `match_correct` response processing.
- Theory items: stem plus an `extendedTextInteraction` free-response area,
  with no automated response processing (they're marked by a person or by
  NACOLM's own keyword engine, not by QTI's scoring model).
- **Not exported: the marking scheme.** NACOLM's keyword-marking rubric
  (`ConceptGroup`: canonical term, synonyms, marks, required-or-not) has no
  standard QTI equivalent. A receiving system gets the question, not how
  NACOLM would grade it. Mapping this onto QTI's `templateProcessing` /
  custom operators, or defining a NACOLM-specific extension namespace, is
  future work — only worth doing once there's an actual second system that
  needs it.
- Item metadata (topic, difficulty, source, citation) isn't in the package
  either, for the same reason: no consumer for it yet. It would go in each
  resource's `<metadata>` block (LOM) when one exists.

## What's planned, not built: LTI

There is no LMS to launch from or into, so an LTI 1.3 implementation would
be exercised by nothing and trusted by no one — it's not a good use of time
yet. The plan, so this isn't a rewrite when the day comes:

- **Direction**: NACOLM CBT would be the LTI **tool** (the thing launched
  into from an LMS's gradebook/assignment link), not the platform. A future
  custom-built LMS would send an OIDC login initiation + a signed JWT launch
  request; NACOLM verifies it against the platform's published keys and
  creates/reuses a session the same way `AuthGuard` does today.
- **Identity mapping**: `User.serviceNumber` is NACOLM's own identifier.
  LTI's launch claims include an external platform-scoped user ID (`sub`) —
  this would need a new nullable `User.externalId` (or a join table, if one
  external identity should ever map to several LMS platforms) rather than
  overloading `serviceNumber`.
- **Grade passback**: LTI's Assignment and Grade Services (AGS) would be how
  a candidate's result gets back into the LMS gradebook — this only makes
  sense once results have somewhere else to go, i.e. once a real LMS exists.
- **Deep linking**: how an instructor in the LMS would pick "this NACOLM
  paper" to attach to an assignment — relevant once there's a UI on the LMS
  side to deep-link from.

None of this is scheduled. It becomes real work the moment there's a
specific LMS (NACOLM's own or a third party) to integrate against, because
only then can the OIDC/JWT handshake actually be tested end to end.

## ISO/IEC 23988 and IEEE P1484.20.1

- **ISO/IEC 23988** (code of practice for IT-based assessment) is a set of
  operational practices, not a file format — there's nothing to "export."
  Where the system already aligns: encrypted-at-rest question packages,
  time-locked release, exposure-controlled randomization, tamper-evident
  submissions (see `local-exam-server/README.md` and the immutability work
  in `internal/store`). Where it doesn't yet: no TLS on the hosted
  instructor-api/instructor-web side is *configured* in this repo (expected
  to be handled by whatever reverse proxy fronts it in production — worth
  confirming explicitly whenever that deployment is set up), and there's no
  formal, written incident/malpractice-response procedure.
- **IEEE P1484.20.1** (competency/learning-objective definitions attached to
  items) — NACOLM's `QuestionBankItem.topic` is a free-text stand-in for
  this. Adopting the standard's structured competency identifiers only
  matters once something downstream (a transcript system, a future LMS)
  needs to consume them programmatically rather than just display the topic
  string. Not scheduled.

## Bottom line

Build the interoperability surface that has a real consumer today (QTI
export — done), document the shape of what needs an actual counterpart
before it's worth building (LTI), and revisit this file when a specific
integration target exists.
