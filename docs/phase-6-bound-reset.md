# Phase 6 — exact bound, rejection, and reset

Phase 6 completes the backend P0 scenario. A single opaque credential now carries three issuer-authenticated hidden slot markers. Slots 0, 1, and 2 can each be accepted once in the canonical scope. A test-only provider adapter can construct an authenticated boundary slot at index 3; the verifier may classify that proof as `BOUND_EXCEEDED` privately in demo mode, while the public API returns only `PRESENTATION_REJECTED`.

## Implemented behavior

- The simulated issuer seals each slot index inside the provider ticket. The browser credential and public presentation shape remain unchanged; hidden slot material stays in the wallet.
- The server verifier checks the sealed slot index after policy, challenge, context, ticket, and authenticator validation. A slot at or above the policy limit is a private demo diagnostic only. Non-demo verifier instances collapse it to `PRESENTATION_REJECTED`.
- The test-only `createSimulatedBoundTestAdapter` creates the authenticated out-of-range presentation without entering application or browser bundles. The API never serializes the diagnostic, slot index, credential, proof, or raw nullifier.
- The Action Simulator has a token-protected `POST /internal/v1/demo/reset` route available only in demo mode. It inserts a run tombstone under an advisory lock, deletes only that run’s action results, and returns a stable reset timestamp on replay. Later commits for the fenced run return `DEMO_RUN_RESET`.
- The public `POST /v1/demo/reset` contract accepts exactly `{}`. The API selects the active run, fences the Action Simulator, deletes only the selected verifier run’s challenges, uses, outbox rows, events, and fault target, then creates a fresh active run and records a `DEMO_RESET` event. Prior-run credentials fail because the server-owned run binding no longer matches.
- The browser reset control calls the server first and clears both IndexedDB stores only after a validated reset response. A failed server or storage operation keeps the local wallet available for recovery.
- Existing conflict and freshness guards remain in place: policy, audience, quota scope, challenge, proof, and conflicting reuse failures create no accepted-use state. Exact retries still return the original cached receipt with zero deltas.

## Reusable golden scenario

`packages/testing/src/scenarios/golden-scenario.ts` is a transport-neutral driver with backend checkpoints after every step. `tests/integration/phase6-golden-scenario.test.ts` supplies the real API, verifier database, worker, Action Simulator, deterministic clock, seeded randomness, and boundary adapter. It runs the complete flow twice and inserts a sentinel closed run/action to prove reset scope.

The scenario checks:

1. A server-owned reset returns a new run and zero active uses/actions.
2. Policy load and one credential issue preserve the zero backend state.
3. Slot 0 succeeds with one consumed challenge, use, outbox row, action, and receipt.
4. Slot 1 reaches durable acceptance, loses its acknowledgement, and recovers the same receipt on an exact retry with zero usage/action deltas.
5. Slot 2 succeeds normally.
6. Authenticated slot 3 returns public `PRESENTATION_REJECTED`; uses, outbox rows, actions, receipts, consumed challenges, and receipt identities remain unchanged.
7. A second reset receives a new run ID while the sentinel run remains intact.

## G6 result

The cumulative gate passed locally with bundled Node 24.19.0, pnpm 11.19.0, Docker Engine 29.2.1, and PostgreSQL 17:

```text
declared_limit                       = 3
accepted_distinct_uses               = 3
committed_external_actions           = 3
extra_uses_from_retry                = 0
extra_actions_from_retry             = 0
over_limit_mutations                 = 0
all_receipts_stable                  = true
```

Validation included 292 unit tests, 9 contract tests, 24 privacy tests, the Phase 3–5 cumulative integration suites, and the Phase 6 golden scenario. Formatting, lint, strict typechecking, package/app builds, and the web build also passed.
