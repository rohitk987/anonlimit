# Phase 5 — lost acknowledgement and exact retry

Phase 5 makes an uncertain presentation outcome recoverable. A demo-only fault can now target one operation, wait until its accepted use, external action, outbox delivery, and receipt are durable, and then withhold a valid acknowledgement. The browser keeps the original slot and exact serialized request in IndexedDB until an explicit retry returns the prior receipt.

## Implemented behavior

- `POST /v1/demo/faults/drop-next-ack` uses the existing strict request/response contracts and is registered only when `DEMO_MODE=true`.
- Append-only verifier migration `0003-lost-ack-fault.sql` gives the durable one-shot fault an active-run and operation target. Migration `0004-fault-target-integrity.sql` adds the run foreign key and requires every enabled drop-next-ack fault to be one-shot and fully targeted.
- The API polls terminal state with a deadline and without holding a database transaction or row lock. A timeout or failed terminal outcome cancels the armed target and returns `SERVICE_UNAVAILABLE`; it cannot silently fall through to a normal acknowledgement.
- Fault consumption checks `SUCCEEDED`, a cached result, and a delivered outbox row. It disables the one-shot fault and inserts `ACK_DROPPED` in one transaction before the response is interrupted.
- The demo fault sends an incomplete acknowledgement after that transaction. Sending one partial byte prevents browser networking from silently replaying a POST that received no response bytes while still leaving the client without a valid acknowledgement.
- Exact retries still resolve before policy or challenge freshness checks. Pending work returns `RETRY_IN_PROGRESS`; completed work returns `RETRY_RESOLVED` with the cached receipt. Both responses have `usageDelta=0` and `actionDelta=0`.
- Safe protocol events record `RETRY_MATCHED`, `RETRY_IN_PROGRESS` or `RETRY_RESOLVED`, and `CACHED_RECEIPT_RETURNED` without storing the presentation, raw nullifier, credential, or holder identity.
- The browser stores the exact JSON wire body before its first send. A transport error, unreadable success response, server error, or receipt timeout changes the local operation to `OUTCOME_UNKNOWN` without advancing the slot.
- While an operation is pending or unknown, the wallet blocks new-slot use. `Retry last request` first posts the stored bytes and idempotency key. If that request was never accepted and its challenge has definitively expired, the wallet obtains a fresh challenge and proof for the same operation, slot, intent, action, and nullifier, persists the replacement body, and submits it without allocating another slot.
- An exact resend may be the first copy accepted by the verifier. The wallet treats that response as one new acceptance rather than requiring `replayed=true`.
- Credential creation, operation binding to the local credential and demo run, and terminal slot retirement are atomic IndexedDB transitions. Browser startup preserves `OUTCOME_UNKNOWN`, reconciles an accepted operation whose prior local slot update was interrupted, and refuses to apply results to a different local credential or run.
- A known pending use may resume status polling; a delayed result that remains uncertain becomes explicitly retryable. Definitive pre-commit failures release the unresolved-operation lock without advancing the slot.

## Verification

Observed locally on 2026-09-05 with bundled Node 24.19.0, pnpm 11.19.0, Docker Engine 29.2.1, Compose 5.0.2, and PostgreSQL 17:

| Check                           | Result                                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm check:phase5`             | Passed formatting, lint, strict type checking, builds, 285 unit, 8 contract, 24 focused integration, and 24 privacy tests                                          |
| `pnpm test:integration`         | Passed all 26 PostgreSQL integration tests, including two live Compose role/readiness checks                                                                       |
| Phase 5 real-socket integration | Passed durable lost acknowledgement, bounded fault timeout/cancellation, original receipt recovery, zero deltas, immutable conflicts, and API failure after commit |
| `pnpm test:e2e`                 | Passed 3 browser scenarios: durable lost-ack recovery, stored resend as first arrival, and expired-unaccepted proof rebuild                                        |
| Existing-volume migration       | `0003-lost-ack-fault.sql` and `0004-fault-target-integrity.sql` applied with matching checksums; migrate and seed exited 0                                         |
| Compose runtime                 | API, web, worker, Action Simulator, and PostgreSQL healthy                                                                                                         |
| Live safe-event trace           | One masked use produced `ACK_DROPPED`, `RETRY_MATCHED`, `RETRY_RESOLVED`, and `CACHED_RECEIPT_RETURNED`, each with zero usage and action delta                     |

The isolated PostgreSQL/Action Simulator gate measured the state immediately before and after the completed retry:

```text
                         before retry   after retry
accepted uses                 1             1
outbox events                 1             1
external actions              1             1
distinct receipts             1             1
```

The retry response returned the original use ID and receipt with `replayed=true`, `usageDelta=0`, and `actionDelta=0`. The same-nullifier changed-intent case returned `NULLIFIER_REUSE_CONFLICT`; the same-operation changed-content case returned `IDEMPOTENCY_CONFLICT`; both left the accepted row and cached receipt unchanged.

## G5 result

G5 Retry safety passed:

```text
retry usage delta       = 0
retry action delta      = 0
recovered receipt       = original receipt
additional wallet slot  = 0
new outbox event        = false
```

After recovery, the wallet acknowledges the original reserved slot exactly once. Phase 6 is the next slice: complete all three distinct allowed uses, reject the fourth without mutation, and add bounded demo reset.
