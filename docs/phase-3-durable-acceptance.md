# Phase 3 — Durable acceptance

Status: complete. G3 passed on 2026-09-05.

Phase 3 turns one real HTTP presentation into durable accepted work. The verifier validates the frozen protocol and opaque simulated provider, then commits the usage record, consumed challenge, recovery outbox item, and privacy-safe event together. PostgreSQL is authoritative for uniqueness and recovery state.

## Delivered

- The migration job owns an idempotent bootstrap for `verifier_api`, `verifier_worker`, `action_service`, and `evidence_reader`, creates the `verifier` and `action_sim` schemas, and applies role-specific grants without exposing database credentials to the PostgreSQL container.
- Product migrations create `demo_runs`, `quota_policies`, `verification_challenges`, `use_records`, `outbox_events`, `protocol_events`, `demo_faults`, `action_results`, and `action_faults`. Named checks, foreign keys, indexes, and uniqueness constraints are mirrored in Drizzle metadata.
- The migration runner takes an advisory lock, checks checksums, rejects edited or removed history, orders each schema numerically, rejects duplicate versions, and refuses a new lower version after later migrations have been applied. Bootstrap and product changes run transactionally.
- The default policy seed is idempotent and immutable. It creates the active three-use demo policy and one active demo run.
- `GET /v1/policies/:id/versions/:version`, `POST /v1/issuer/credentials`, `POST /v1/verifier/challenges`, and `POST /v1/verifier/presentations` use strict runtime schemas, JSON and body-size checks, an idempotency header, and reviewed public error fields.

## Acceptance behavior

The request derives the protected lookup value in memory, resolves an existing accepted use before rejecting stale freshness, validates the stored challenge and authoritative policy, and calls the opaque verifier before opening the acceptance transaction. The transaction locks the run, policy, and challenge, rechecks their current state with the database clock, inserts `ACCEPTED_PENDING_ACTION`, consumes the challenge, inserts one `READY` outbox event, records one `USE_ACCEPTED` event, and commits. Uniqueness failures and a consumed-challenge race reload the winning use and return the exact retry result; they do not create a second use.

The database-clock check occurs after row locks, so a request waiting on a competing transaction cannot accept an already expired challenge. Provider exceptions return `SERVICE_UNAVAILABLE`; invalid proofs return `PRESENTATION_REJECTED`. A rollback removes every acceptance mutation. The worker keeps its least-privilege connection liveness check separate from API readiness, which reads policy and run state.

The verifier schema stores protected lookup values and digests only. It has no identity, device, session, wallet, credential-wide identifier, hidden slot, raw credential, raw proof, or raw nullifier field. Public responses and logs use allowlisted fields.

## Verification

Observed locally on 2026-09-05:

- `pnpm check:phase3`: passed — format, lint, strict type checks, builds, 277 unit tests, 8 contract tests, 18 isolated PostgreSQL tests, and 24 privacy tests.
- `pnpm test:integration`: passed — 20 tests, including live Compose role checks.
- `pnpm test:e2e`: passed — one real readiness, outage/recovery, and responsive browser flow.
- `docker compose config --quiet`, image build, and `docker compose up -d --no-build --wait --wait-timeout 120`: passed. PostgreSQL, API, worker, Action Simulator, and web were healthy; migration and seed jobs exited 0.
- Live HTTP probe: policy lookup, issuance, challenge creation, presentation acceptance, and exact replay returned `200`, `200`, `201`, `202`, and `202`; replay reused the same use with usage deltas `1` then `0`.

The schema TypeScript build uses a package-local `skipLibCheck` config only for Drizzle 0.45.2 dependency declarations that are incompatible with TypeScript 6.0.3. Project schema source remains strictly checked; the main database typecheck remains strict.

## Boundary for Phase 4

Durable acceptance ends at `ACCEPTED_PENDING_ACTION`. Phase 4 adds the Action Simulator action endpoint, worker outbox leasing and delivery, atomic receipt persistence, and the browser IndexedDB wallet so one use reaches one stable external receipt. Lost acknowledgement recovery, the full three-use bound, evidence, and the guided judge flow follow in later phases.
