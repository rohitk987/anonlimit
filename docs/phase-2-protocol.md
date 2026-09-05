# Phase 2 protocol kernel record

Date: 2026-09-05 (Asia/Calcutta)

Status: **Complete — G2 Contract freeze passed.**

## Delivered behavior

Phase 2 freezes the framework-independent vocabulary and rules that the durable acceptance path
will use. It does not add public product routes or persistence.

- Strict Zod wire contracts cover policy, issuance, challenge, presentation, identity-free
  action, use results, receipts, safe events and errors, evidence, demo controls, and trusted
  worker actions. Unknown fields are rejected at every public boundary.
- Canonical JSON and quota-scope functions produce stable, collision-safe encodings. Policy,
  scope, intent, proof-context, protected-nullifier, and action-key derivations use explicit domain
  separation and injected hash/HMAC adapters.
- Policy and challenge guards use injected clocks. Exact-retry classification is independent from
  freshness checks so accepted historical work can still return its original state or receipt.
- Exhaustive use-state guards cover rejection, acceptance, recovery, success, final failure, and
  exact terminal replay. The retry classifier distinguishes new work, same-use retries, nullifier
  conflicts, idempotency conflicts, and inconsistent ledger lookups.
- The pure evidence calculator preserves missing measurements as `NOT_RUN`, rejects contradictory
  authoritative observations, validates receipt ownership and uniqueness, and requires complete
  pairwise audit evidence before reporting unlinkability.
- The crypto package exposes separate holder, issuer, verifier, and audit entrypoints. Its
  simulated provider issues a fixed set of sealed per-slot capabilities, binds presentations to
  authoritative server context, protects durable lookup keys, and collapses proof failures to one
  public diagnostic.
- Protocol event and error serializers select explicit data properties before runtime validation;
  they do not copy unknown fields or execute accessors.

The provider design, trust assumptions, and production limitations are documented in
[the crypto boundary README](../packages/crypto/README.md).

## Contract evidence

The adapter suite verifies:

- Slots `0` through `L - 1` produce valid presentations; slot `L`, negative, fractional,
  non-finite, and other invalid selections fail.
- A credential, scope, and slot produce one stable nullifier. Valid slots are distinct, and
  changing request-controlled data does not create more nullifiers.
- Copying or reordering wallet capabilities preserves the same fixed nullifier set; appending a
  copied capability under a changed bound cannot verify.
- Audience, policy version/status, quota window, demo run, challenge ID/nonce, operation, action,
  intent, issuer parameters, expiry, encrypted ticket, authenticator, and public nullifier bindings
  are enforced.
- The audit adapter returns `SAME_USE` for an exact presentation replay and `UNLINKABLE` for two
  distinct valid slots under its documented simulation assumption.
- Browser conditions resolve the holder entrypoint and reject issuer, verifier, and audit
  entrypoints. Public presentation and verification results expose no slot, per-slot secret,
  holder identity, or credential-wide identifier.

## Verification observed

| Check                      | Result                                                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check:protocol`      | Passed: formatting, ESLint boundaries, strict type checking, 270 unit tests, 8 opaque-adapter contract tests, all package/app builds, and 22 privacy tests |
| Clean frozen install/build | Passed in `node:24-bookworm-slim` through `docker compose build api`; lockfile supply-chain policy passed                                                  |
| Compose startup            | PostgreSQL 17, migration, API, worker, Action Simulator, and web reached their expected healthy/completed states                                           |
| `pnpm test:integration`    | 2 foundation PostgreSQL/migration/role tests passed                                                                                                        |
| `pnpm test:e2e`            | 1 Chromium foundation readiness and recovery test passed                                                                                                   |

The Vite build still reports two harmless upstream Zod comment-annotation warnings already noted
in the Phase 1 record. No warning was suppressed.

## Deliberate boundary

There is still no issuer/verifier HTTP transport, IndexedDB wallet, acceptance transaction,
product table, outbox item, worker dispatch, or external receipt. The current application screen
therefore remains the honest foundation screen. Phase 3 can now build durable acceptance against
the frozen contracts and adapter behavior without inventing protocol semantics inside route or
database code.
