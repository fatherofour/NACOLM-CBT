# Capacity: no auto-scaling infrastructure, sized for 10,000 concurrent users

This is a deliberate choice: no Kubernetes, no auto-scaling group, no
orchestration. instructor-api runs as one deployable unit that can use more
of the box it's on (via clustering, below) — capacity comes from sizing that
one deployment correctly, not from spinning up more of them automatically.
This document records what was actually measured, what was tuned, and what
tuning is still an operational decision (Postgres sizing, OS limits) rather
than something to hardcode into the app.

## What was tuned

**DB connection pool** (`src/prisma/prisma.service.ts`) — Prisma 7's
`@prisma/adapter-pg` wraps node-postgres's `Pool`, whose default `max` is
10. That's now `DB_POOL_MAX` (default 10, unchanged, but now a knob instead
of a hardcoded default buried in a library). This is a **per-process**
limit.

**Clustering** (`src/main.ts`) — Node runs JavaScript on a single thread, so
one process is a one-core ceiling regardless of how much traffic arrives.
Setting `WEB_CONCURRENCY=<n>` forks `n` worker processes (capped at the
machine's actual core count) that share the listen port via Node's built-in
`cluster` module — more throughput from the same box, no new infrastructure.
Left unset, behavior is exactly what it was before this change: one
process. **This is the main lever for approaching 10,000 concurrent** on
real hardware; everything else here is secondary.

**The one thing that multiplies**: total Postgres connections =
`WEB_CONCURRENCY x DB_POOL_MAX`. An 8-core box running `WEB_CONCURRENCY=8`
with `DB_POOL_MAX=10` opens up to 80 connections to Postgres. Postgres's own
default `max_connections` is 100 — comfortable at that setting, but this
product has to be checked against whatever the production Postgres is
actually configured for (or fronted with a pooler like PgBouncer) before
turning either number up further. This isn't something the app can safely
default its way out of; it's an operational sizing decision every time the
core count or the pool size changes.

## What was measured (this dev machine, not production)

Run with `npx autocannon -c <connections> -d 10 <url>`, against a build
running locally, on a laptop also running several other dev services at the
same time. These numbers describe *this environment*, not a capacity
guarantee — they're here so the next measurement has something to compare
against, and so "clustering helped" is a checked claim, not an assumption.

| Endpoint | Path (touches DB?) | Concurrency | Median latency | Req/sec (avg) |
|---|---|---|---|---|
| `/health` | no | 500 | 38 ms | ~2,300 |
| `/health` | no | 2,000 | 41 ms | ~2,400 (accepted all 2,000 connections without dropping any) |
| `/courses` | yes (session lookup + query) | 300, 1 process | 922 ms | ~240 |
| `/courses` | yes | 300, 1 process, `DB_POOL_MAX=50` | 1073 ms | ~210 (no improvement — pool size was not the bottleneck here) |
| `/courses` | yes | 300, `WEB_CONCURRENCY=4` | 110 ms | ~390 |

**Reading these honestly**: `/health` shows the HTTP layer itself easily
holds thousands of concurrent connections. `/courses` is far more expensive
per request because `AuthGuard` does a database round trip to validate the
session on *every* request, on top of the handler's own query — and raising
the connection pool alone didn't fix that, which means the constraint on
this machine is query latency / shared local Postgres contention, not pool
starvation. Clustering to 4 processes measurably helped (latency dropped
~9x, throughput +60%), which is the expected shape of a CPU/event-loop-bound
workload, but the absolute numbers here are capped by a laptop sharing its
cores with everything else running on it — they should be re-measured
against the actual production Postgres and hardware before quoting a real
number to anyone.

## The other real lever, not yet built: caching session validation

Every authenticated request pays for an `AuthSession` lookup
(`auth.service.ts`'s `validate()`). A short-TTL in-process cache (a few
seconds) of validated tokens would cut that in roughly half for
authenticated traffic — but it trades against revocation latency: a
deactivated account or a forced logout would take up to the cache TTL to
actually take effect instead of being instant. That's a real security
property this system currently guarantees (instant revocation, per
`AuthSession.revokedAt`) and trades away for throughput — worth doing
deliberately, with an explicit TTL decision, not as a silent side effect of
a capacity pass. Flagged here rather than built.

## What stays an ops decision, not app code

- Postgres's own `max_connections`, and whether a pooler (PgBouncer) sits in
  front of it once several `WEB_CONCURRENCY` workers (or several deployed
  instances, if that's ever revisited) are in play.
- OS file-descriptor limits (`ulimit -n` on Linux) for genuinely holding
  10,000 concurrent sockets open — the default on many systems is 1024,
  which would need raising well before that ceiling is real.
- TLS termination, load balancing, and health-check wiring for however this
  actually gets deployed.

None of this belongs hardcoded into instructor-api; it belongs in whatever
deployment runbook accompanies the first real production rollout.
