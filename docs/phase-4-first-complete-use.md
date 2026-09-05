# Phase 4 — first complete end-to-end use

Phase 4 completes the first real vertical slice: a browser-held credential is issued, one holder presentation is accepted by the verifier, the durable outbox worker delivers an allowlisted action, and the browser receives a stable receipt.

## Implemented path

```text
Browser IndexedDB wallet
  -> Verifier API challenge and presentation
  -> PostgreSQL use + outbox acceptance
  -> Worker lease and HTTP delivery
  -> Action Simulator unique action_key commit
  -> Worker atomic receipt/use/outbox completion
  -> Browser status polling and receipt
```

The Action Simulator requires its internal bearer token, stores one result per action key, replays the original receipt for the same payload digest, and returns an integrity conflict for changed content. The worker uses bounded `FOR UPDATE SKIP LOCKED` claims, commits leases before network calls, retries transient failures with bounded backoff, and records terminal success or failure with a safe protocol event. The worker never receives holder credentials, proofs, hidden slots, or raw nullifiers.

The wallet uses native IndexedDB stores for the opaque credential, local slot cursor, and pending operation. It writes the operation, intent digest, nullifier, challenge, and serialized presentation before the first presentation request. Refresh recovery reuses the same operation and polls the verifier status endpoint.

## G4 evidence

After a clean demo reset, the live Compose database reported:

| Measure           | Observed |
| ----------------- | -------: |
| Accepted uses     |        1 |
| Outbox events     |        1 |
| External actions  |        1 |
| Distinct receipts |        1 |

No mock server, hard-coded receipt, frontend counter, or direct API write to action tables is involved.

## Verification

- `pnpm format:check` — passed.
- `pnpm lint` — passed.
- `pnpm typecheck` — passed.
- `pnpm test:unit` — 277 passed.
- `pnpm test:contract` — 8 passed.
- `pnpm test:integration` — 23 passed, including action idempotency/conflict and worker lease/completion tests.
- `pnpm test:privacy` — 24 passed.
- `pnpm test:e2e` — 1 passed: issuance, one use, receipt, and refresh recovery.

Phase 5 begins with lost acknowledgement and exact retry recovery.
