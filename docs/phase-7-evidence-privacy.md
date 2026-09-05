# Phase 7 — authoritative evidence and privacy

Date: 2026-09-06 (Asia/Calcutta)  
Branch: `codex/phase-2-protocol`

Phase 7 turns the durable verifier and Action Simulator state into an inspectable, backend-derived report. The report never reads a browser-maintained counter. It is scoped to the server-owned active demo run and is strict-validated before it leaves the API.

## What changed

- Added sanitized `verifier.evidence_uses` and `verifier.evidence_events` views and a verifier evidence query boundary. The public evidence shape contains masked per-use references, intent digests, states, stable action keys, receipts, policy measurements, and privacy column counts; raw use IDs, nullifier keys, operation IDs, presentations, and grouping labels remain outside the response.
- Added `GET /internal/v1/evidence?demoRunId=...` to the Action Simulator and `GET /v1/demo/evidence` to the API. The API joins independently queried verifier and action measurements and runs the domain invariant calculator.
- Added allowlisted protocol event persistence for issuance, rejection, conflict, and privacy-audit events. `GET /v1/demo/events/stream` returns bounded replay batches with `id` cursors and honors `after` or `Last-Event-ID` on reconnect.
- Added `POST /v1/demo/linkability-test`. Presentations are validated against the active run and accepted uses, passed transiently to the opaque audit adapter, compared across every distinct-use pair, and discarded after the request. Duplicate exact-use inputs are reported as `SAME_USE`; distinct uses are reported as `UNLINKABLE`. Missing or unavailable audit support returns `INCOMPLETE` and never passes.
- Added forbidden-data scanning helpers and `pnpm audit:privacy` for generated browser assets and local secret markers. Structured scanners cover forbidden keys and values without printing their contents.

## Gate evidence

The Phase 7 checks passed:

| Check                          | Result                                 |
| ------------------------------ | -------------------------------------- |
| `pnpm test:unit`               | 15 files, 297 tests passed             |
| `pnpm test:contract`           | 9 tests passed                         |
| `pnpm test:privacy`            | 24 tests passed                        |
| `pnpm test:integration:phase7` | 3 PostgreSQL/API evidence tests passed |
| `pnpm format:check`            | Passed                                 |
| `pnpm lint`                    | Passed                                 |
| `pnpm typecheck`               | Passed                                 |
| `pnpm build`                   | Passed                                 |
| `pnpm audit:privacy`           | 1 browser asset, zero findings         |

The integration coverage verifies the evidence views do not expose raw verifier columns, event replay stops at the supplied cursor, Action Simulator evidence is run-scoped, and the SSE route emits only allowlisted fields. Existing Phase 6 coverage continues to certify three committed uses, exact retry deltas of zero, fourth-use rejection, and scoped reset. The audit adapter contract and domain evidence suites cover `UNLINKABLE`, `SAME_USE`, failed comparisons, and deliberately unavailable audit data.

## Operational notes

The evidence route reports `INCOMPLETE` until a linkability audit has completed for the active run. Raw linkability presentations and grouping labels are held only in the request and short-lived process memory needed to serve the resulting report; they are not written to PostgreSQL, events, logs, outbox payloads, exports, or browser state.

The next phase is Phase 8: connect the real evidence, event stream, and linkability results to the guided Demo Lab and rehearse the under-three-minute judge flow.
