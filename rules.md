# AnonLimit Repository Rules

## Non-Negotiable Engineering, Privacy, and Delivery Contract

This file governs every human- or agent-authored change in this repository.

Read these files before implementation:

1. **prd.md** defines required product behavior and acceptance criteria.
2. **architecture.md** defines the selected stack, runtime boundaries, flows, and repository structure.
3. **rules.md** defines how code must be written, reviewed, and verified.
4. **phases.md** defines the authoritative dependency schedule, Phase IDs 0 through 10, and cumulative gates.

If the documents disagree, do not silently choose the easiest interpretation. Preserve the bounded-use, retry-safety, idempotency, and privacy invariants; then update the conflicting documentation before continuing.

---

## 1. Rule language

- **MUST** and **MUST NOT** are non-negotiable.
- **SHOULD** and **SHOULD NOT** are defaults. A deviation requires a short written reason in the change.
- **MAY** identifies an optional implementation choice.
- A feature is incomplete if it violates a MUST, even when the visible demo appears to work.
- Never weaken an invariant, privacy check, or test merely to make the demo pass.

---

## 2. Product invariants

Every change MUST preserve these invariants:

1. A credential with bound L can produce at most L accepted distinct uses in one canonical quota scope.
2. An exact retry creates no additional use, outbox event, or external effect.
3. Invalid, expired, policy-rejected, and over-limit presentations consume no use.
4. One accepted use has one immutable operation and intent.
5. One accepted use causes at most one committed external effect.
6. Every accepted pending use has durable recovery work.
7. The verifier stores no real-world identity or credential-wide identifier.
8. Different legitimate uses remain unlinkable under the opaque provider contract.
9. Only retries of the same use are intentionally linkable.
10. The verifier does not maintain a per-holder or per-credential usage counter.
11. UI evidence comes from authoritative backend and action-simulator state.
12. Cryptographic claims are limited to the supplied opaque-interface guarantees.

---

## 3. Scope rules

### P0 is the submission

P0 MUST be complete before optional features are started:

- One issuer module.
- One browser Holder Wallet.
- One verifier API.
- One PostgreSQL-backed outbox worker.
- One independently idempotent Action Simulator.
- Default policy with exactly three uses.
- Three successful distinct presentations.
- Lost acknowledgement followed by an exact retry.
- One rejected over-limit presentation.
- Transactional use and outbox creation.
- Exactly one external effect per accepted use.
- Verifier storage and log privacy audit.
- Supplied linkability test.
- Required pairwise linkability checks with aggregate evidence, and automated schema, row, log, event, outbox, export, API-response, browser-bundle, and production-import scans.
- Deterministic reset, trace, and invariant summary.

### P1 is conditional

P1 Phase 9 MAY begin only after G8 passes and the core P0 scenario passes repeatedly. In that core scenario, the third allowed use is submitted normally; the concurrent-race variant uses twenty copies of that previously unused third-use presentation:

- Twenty-request concurrent race.
- Worker crash and redelivery.
- Conflicting replay demonstration; rejection and its regression tests remain P0.
- Optional matrix visualization of linkability results; pairwise checks and aggregate evidence remain P0.
- Sanitized evidence export.

A 24-hour P0 baseline MAY explicitly omit Phase 9, but MUST complete Phase 10 and every applicable privacy and release gate. It MUST report the omitted race/crash validation and MUST NOT claim full-project completion under Section 28. The underlying use-bound, idempotency, and durable-recovery requirements remain mandatory.

### P2 is excluded from the hackathon

Multiple windows, multiple audiences, authentication, cloud scaling, performance views, and production crypto integration MUST NOT begin during the hackathon.

### Prohibited scope expansion

Do not add these during the hackathon MVP:

- Full anonymous-credential or zero-knowledge cryptography.
- User accounts, KYC, profiling, or identity recovery.
- Per-human limits or multi-credential issuance prevention.
- Credential sharing prevention or device attestation.
- Real payments, healthcare actions, or irreversible effects.
- Kubernetes, a service mesh, Redis, Kafka, or another message broker.
- GraphQL, Redux, or additional microservices.
- Blockchain or a public usage ledger.

When time is short, remove optional features before removing tests, evidence, reset behavior, or correctness controls.

---

## 4. Approved stack

Use the stack selected in architecture.md:

- Node.js 24 LTS.
- TypeScript strict mode.
- pnpm workspaces.
- React with Vite.
- Tailwind CSS and local UI primitives.
- TanStack Query.
- IndexedDB through idb.
- Fastify.
- Zod.
- PostgreSQL 17.
- Drizzle ORM with node-postgres and explicit SQL where needed.
- Pino with privacy-safe serializers.
- Vitest, Testcontainers, and Playwright.
- Docker Compose.

New infrastructure or framework dependencies require an architecture.md update and a concrete explanation of what risk or substantial code they remove.

Prefer platform APIs and existing dependencies. A new dependency MUST:

- Have a clear owner and purpose.
- Be compatible with Node 24 and the chosen build.
- Not introduce telemetry or identity collection.
- Not weaken browser/server crypto boundaries.
- Be locked in pnpm-lock.yaml.

---

## 5. Repository boundaries

All cross-package imports MUST use declared workspace package exports. Never deep-import another package's src directory or use relative paths between apps.

```text
web
  -> contracts
  -> domain
  -> crypto/holder

api
  -> contracts
  -> domain
  -> crypto/issuer
  -> crypto/verifier
  -> crypto/audit
  -> db/verifier
  -> observability

worker
  -> domain
  -> db/verifier
  -> observability

action-simulator
  -> contracts/internal-action
  -> db/action
  -> observability

testing
  -> may import all packages
  -> MUST NOT be imported by production
```

Additional rules:

- packages/domain MUST remain pure and import no React, Fastify, HTTP, database, environment, or application code.
- packages/contracts owns runtime wire schemas and public-field allowlists.
- apps/web MUST NOT import database code or issuer/verifier crypto.
- Only @anonlimit/crypto/holder is browser-safe.
- apps/api MUST NOT import db/action or write external-action rows directly.
- apps/worker MUST NOT import holder or issuer crypto.
- apps/action-simulator MUST NOT import verifier repositories or read verifier tables.
- Production code MUST NOT import packages/testing, test fixtures, credential grouping labels, or fault helpers.
- Package export maps and ESLint no-restricted-imports MUST enforce these boundaries.
- Circular package dependencies are prohibited.
- Do not create a broad crypto barrel export that could bundle server-only code into the browser.

---

## 6. TypeScript rules

- Enable strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, noImplicitOverride, and useUnknownInCatchVariables.
- Production code MUST NOT use any to bypass typing.
- Narrow unknown values explicitly.
- @ts-ignore is prohibited.
- @ts-expect-error is allowed only in a negative type test with a reason.
- Unchecked casts and non-null assertions SHOULD be avoided. An unavoidable use requires a local invariant comment.
- Use named exports and type-only imports where applicable.
- Prefer discriminated unions and exhaustive switches for use state, worker state, and error codes.
- Persisted state names MUST come from shared domain definitions.
- Domain inputs and results SHOULD be immutable.
- Every promise MUST be awaited, returned, or deliberately handled.
- API handlers MUST NOT launch undurable background work.
- Inject clocks, ID generators, crypto adapters, and external clients so tests remain deterministic.
- Route handlers remain thin: validate, call one application service, and map the typed result.
- Business rules do not live in React components, Fastify handlers, or database models.
- Wire types are inferred from Zod schemas. Do not maintain duplicate handwritten wire interfaces.
- Prefer small, purpose-specific modules over generic utility collections.

### Naming

- Files: kebab-case.
- React components and exported types/classes: PascalCase.
- Functions and variables: camelCase.
- Constants: UPPER_SNAKE_CASE.
- Database tables and columns: snake_case.
- HTTP paths: lowercase kebab-case where multiple words are required.
- Error codes and persisted enum values: UPPER_SNAKE_CASE.

---

## 7. Opaque cryptography rules

- Issuance, presentation creation, proof verification, and linkability checks MUST use packages/crypto interfaces.
- Application code MUST NOT recreate, bypass, or reinterpret the provider's cryptographic guarantees.
- Random IDs, ordinary hashes, signatures, and hidden test labels MUST NOT be presented as proof of anonymity.
- UI and documentation MUST label cryptographic guarantees as opaque-provider assumptions.
- Opaque credential and hidden slots remain in the wallet.
- Issuer private material remains server-side, outside source control, and outside browser bundles.
- The verifier may handle an opaque proof and raw nullifier only in request memory.
- The worker and Action Simulator MUST never receive a credential, proof, hidden slot, or raw nullifier.
- Production-shaped proof failures collapse to PRESENTATION_REJECTED.
- Detailed reasons such as BOUND_EXCEEDED are allowed only as private demo diagnostics while DEMO_MODE is true.

### Canonical scope

The effective quota scope is:

```text
issuerKeyId
|| policyId
|| policyVersion
|| verifierAudience
|| quotaWindowId
```

- The issuer authorizes the scope.
- The verifier reconstructs it.
- Client input MUST NOT override the effective scope.

### Nullifier contract

The conceptual nullifier is:

```text
PRF(
  credentialSecret,
  "AnonLimit/v1" || canonicalScope || hiddenSlot
)
```

- The same credential, scope, and slot MUST produce the same nullifier.
- Different valid slots MUST remain unlinkable under the provider contract.
- Different verifier scopes MUST have separate nullifier domains.
- Operation ID, action payload, request digest, challenge, timestamp, and other request-controlled values MUST NOT affect nullifier derivation.
- The declared bound is enforced by the opaque hidden-slot proof plus per-use database uniqueness.
- No holder record or credential counter may be added as a shortcut.

### Persistent lookup

Persist only:

```text
HMAC-SHA-256(
  verifierLedgerKey,
  H(canonicalScope) || rawNullifier
)
```

The raw nullifier MUST be discarded after request processing.

---

## 8. Intent and proof binding

- Canonicalize the identity-free action before hashing.
- The intent digest MUST bind protocol version, operation ID, HTTP method, resource, and canonical action payload.
- The proof context MUST bind protocol version, canonical scope, intent digest, and verifier challenge.
- The server MUST recompute all canonical values; it MUST NOT trust client-provided digests as authoritative.
- Wrong audience, policy version, quota window, challenge, issuer parameters, or intent MUST fail before usage state is written.
- An accepted nullifier is permanently bound to its original operation and intent.
- The same nullifier with different intent returns NULLIFIER_REUSE_CONFLICT.
- The same operation ID with changed content returns IDEMPOTENCY_CONFLICT.

Canonicalization MUST be shared between browser and server and covered by fixed test vectors, including reordered JSON keys and Unicode input.

---

## 9. Wallet and retry rules

Before the first send, the wallet MUST durably save:

- Credential handle.
- Selected hidden slot.
- Operation ID.
- Canonical intent.
- Intent digest.
- Nullifier.
- Serialized presentation envelope.
- Submission state.

A timeout or lost acknowledgement MUST NOT allocate another slot.

An exact retry is the same:

```text
canonicalScope
+ nullifier
+ operationId
+ intentDigest
```

Exact retry behavior:

- Pending use: return RETRY_IN_PROGRESS for the same use; create no new work.
- Succeeded use: return the cached receipt with usageDelta equal to zero.
- Failed-final use: return the cached terminal failure with usageDelta equal to zero.
- Changed intent: reject as a conflict.

Existing-use resolution MUST happen before rejecting a stale challenge or changed policy. Once acceptance has committed, the historical decision remains authoritative.

---

## 10. API and contract rules

- Public routes use /v1.
- Internal Action Simulator routes use /internal/v1.
- Every request body, path, query, response, and SSE event MUST have a Zod schema.
- Boundary object schemas MUST reject unknown fields rather than silently strip them.
- Mutating routes MUST validate content type and enforce a strict request-size limit before parsing.
- The business-action schema MUST be a strict identity-free allowlist.
- Stable error codes are API contracts. Clients branch on codes, never human-readable text.
- Malformed input returns 400.
- Exact-use or idempotency conflicts return 409.
- New pending acceptance returns 202.
- Retryable infrastructure failure returns 503 where appropriate.
- Unexpected failure returns a safe INTERNAL_ERROR and random trace ID.
- Responses MUST NOT contain stack traces, SQL, configuration, provider prose, secrets, or unreviewed request data.
- Internal endpoints require a service token and private-network exposure.
- CORS permits only the configured web origin.
- Hosted environments use TLS.
- Demo-only endpoints are unavailable when DEMO_MODE is false.

---

## 11. Presentation acceptance order

POST /v1/verifier/presentations MUST follow this order:

1. Enforce content type and request-size limit.
2. Parse with the strict shared schema.
3. Reject unknown public fields.
4. Canonicalize the allowlisted action.
5. Recompute scope, intent digest, and proof context.
6. Calculate the HMAC-protected nullifier lookup in memory.
7. Look for an accepted use by scoped nullifier or operation ID.
8. Return an exact retry's existing state or receipt.
9. Reject immutable-intent conflicts.
10. Validate challenge, audience, policy, window, and expiry.
11. Call the opaque verifier without writing usage state.
12. Begin one PostgreSQL transaction.
13. Lock and recheck authoritative policy and challenge state inside that transaction.
14. Atomically insert the use, consume the challenge, insert the outbox event, and append a safe protocol event.
15. Commit.
16. If a uniqueness race is lost, roll back, load the winning record, and classify it as retry or conflict.

Do not reorder these steps without updating architecture.md, the failure matrix, and all affected tests.

---

## 12. Database and transaction rules

- PostgreSQL constraints are authoritative for uniqueness and concurrency.
- Process-local locks, frontend counters, and pre-insert existence checks are not correctness mechanisms.
- All queries MUST be parameterized.
- Persist lifecycle timestamps as timestamptz using database-generated UTC time.
- Immutable accepted-use fields MUST never be updated:
  - demo_run_id
  - scope_hash
  - nullifier_key
  - operation_id
  - intent_digest
  - action_key
- Workers may update only lifecycle state, retry metadata, terminal result, and timestamps.
- Proof verification occurs before the acceptance transaction and performs no writes.
- No HTTP request, provider call, sleep, or other unbounded I/O may occur while a transaction or row lock is open.
- A uniqueness violation is an expected race result, not an internal server error.
- Catch uniqueness failures by constraint name, roll back, load the winning row, and apply the retry classifier.
- Use and outbox rows MUST never commit independently.
- The verifier and action schemas MUST NOT participate in a distributed database transaction.
- Database roles receive only the privileges defined in architecture.md.

### Required acceptance transaction

One transaction MUST:

1. Lock and recheck the policy and challenge.
2. Insert one ACCEPTED_PENDING_ACTION use record.
3. Mark the challenge CONSUMED.
4. Insert one READY outbox event.
5. Insert one privacy-safe USE_ACCEPTED event.
6. Commit all changes together.

### Required constraints

```sql
UNIQUE (demo_run_id, scope_hash, nullifier_key)
UNIQUE (demo_run_id, scope_hash, operation_id)
UNIQUE (action_key)
UNIQUE (use_id, event_type)
```

### Use consumption

- Invalid proof: zero use.
- Expired first-use challenge: zero use.
- Policy rejection: zero use.
- Database rollback: zero use.
- Committed acceptance transaction: exactly one use.
- Lost response, exact retry, or worker retry: zero additional use.

---

## 13. Outbox and Action Simulator rules

- Every accepted pending use MUST have exactly one durable outbox event.
- Worker claims use bounded batches with SELECT FOR UPDATE SKIP LOCKED.
- It writes a lease and commits before making an HTTP call.
- Worker delivery always uses the persisted action key and payload digest.
- Retryable failures use bounded exponential backoff.
- Exhausted work becomes visible DEAD_LETTER state; it is never silently discarded.
- A worker crash allows the lease to expire and another worker to resume.
- The Action Simulator MUST atomically enforce unique action_key.
- Same action key and same payload digest returns the original receipt.
- Same action key and different payload digest is an integrity conflict.
- Successful worker completion MUST atomically:
  1. Cache the receipt.
  2. Mark the use SUCCEEDED.
  3. Mark the outbox event DELIVERED.
  4. Append a privacy-safe completion event.
- The guarantee is at-least-once delivery with one committed effect at an idempotent destination.
- Never claim exactly-once network delivery.

---

## 14. State-transition rules

Allowed use transitions:

```text
UNSEEN
  -> REJECTED                  no durable use record
  -> ACCEPTED_PENDING_ACTION

ACCEPTED_PENDING_ACTION
  -> ACCEPTED_PENDING_ACTION  retry or recovery
  -> SUCCEEDED
  -> FAILED_FINAL

SUCCEEDED
  -> SUCCEEDED                exact retry only

FAILED_FINAL
  -> FAILED_FINAL             exact retry only
```

- State transitions MUST use dedicated domain functions.
- Do not implement unrestricted generic state updates.
- Terminal results are immutable.
- A rejected verification MUST NOT leave a use, outbox event, receipt, or action.
- An accepted use MUST NOT return to UNSEEN.

---

## 15. Privacy and data-minimization rules

The verifier MUST NOT create, derive, persist, log, emit, or export:

- Name, email, phone, account ID, patient ID, or real-world subject identifier.
- Credential ID, credential serial, holder key, hidden slot, or credential-wide pseudonym.
- Raw credential.
- Raw proof or complete presentation envelope.
- Raw nullifier.
- IP address, cookie, user agent, browser fingerprint, or session-replay identifier.
- Issuer eligibility record.
- Test-harness credential grouping label.
- Unbounded request body.

Verifier persistence is limited to:

- Policy and scope hashes.
- HMAC-protected per-use lookup.
- Random operation ID.
- Intent digest.
- Use state.
- Stable action key.
- Cached terminal result.
- Privacy-safe events.

Additional rules:

- Action payloads MUST use a strict identity-free allowlist.
- Unknown fields are rejected, not copied, stored, or logged.
- Linkability presentations and grouping labels are transient audit inputs.
- Do not add analytics, advertising, session replay, fingerprinting, or third-party tracking.
- demo_run_id is an operational scenario boundary, not a holder or credential identity.
- Evidence exports use an explicit safe-field allowlist.

---

## 16. Logging and observability rules

Application logs may contain only:

- HTTP method.
- Route template.
- Random safe trace ID.
- Status code.
- Duration.
- Safe domain error code.

Privacy-safe protocol events may additionally contain:

- Demo run ID.
- Policy ID and version.
- State transition.
- Usage and action deltas.
- Latency.
- Masked per-use reference.

Rules:

- Request and response bodies MUST NOT be logged.
- Headers, cookies, IP addresses, user agents, proofs, nullifiers, credentials, secrets, and arbitrary error objects MUST NOT be logged.
- Body logging is explicitly disabled on presentation and linkability-audit routes.
- Field allowlisting is the primary control; redaction is defense in depth.
- Unexpected errors are logged through a safe serializer, never by dumping the original object.
- Schema, rows, logs, events, outbox payloads, exports, and built assets MUST pass the forbidden-data scanner before release.

---

## 17. UI rules

- The UI MUST describe the product as a simulation using opaque cryptographic interfaces.
- It MUST NOT claim production anonymity or novel cryptography.
- Wallet counters and slots MUST be labeled local-only.
- Verifier views MUST NOT show or imply a stable holder identity.
- A new accepted use and an exact retry MUST have visually distinct states.
- A retry MUST NOT animate as another consumed use.
- Invariant cards MUST come from the Evidence API.
- The frontend MUST NOT maintain its own authoritative usage or action counts.
- Linkability output MUST distinguish UNLINKABLE distinct uses from SAME_USE retry recognition.
- Status MUST be communicated with text or icons in addition to color.
- The guided P0 demo MUST fit a standard laptop viewport and finish in under three minutes.

---

## 18. Demo-only controls

- Reset, fault injection, concurrent race control, private diagnostics, schema audit, and transient linkability auditing require DEMO_MODE=true.
- When DEMO_MODE is false, demo-only routes MUST fail closed and MUST NOT be registered on the public router.
- Internal Action Simulator routes require a service token and private network.
- The worker exposes no public port.
- Demo reset may delete only the explicitly selected demo-run state.
- The server owns the active demo run. Reset MUST invalidate prior-run demo credentials, challenges, and wallet pending operations. Verification MUST reject a prior-run credential even when submitted with a new run ID; clearing browser state alone is insufficient. Operational run isolation MUST NOT increase a credential's allowance or introduce verifier-side credential identity storage.
- Reset MUST NOT drop schemas, rerun migrations, or truncate unrelated data.
- Fault controls MUST be deterministic, one-shot by default, and visible in the protocol trace.
- Demo actions remain simulated and reversible.
- Test fixtures and fault helpers MUST NOT enter production bundles.

---

## 19. Error-handling rules

- Expected outcomes use a closed typed Result or error union.
- Do not inspect human database messages or provider prose to drive behavior.
- One global Fastify handler maps domain codes to safe HTTP responses.
- Never catch and ignore an error.
- Handle, convert to a typed outcome, retain durable retry work, or rethrow to the owning boundary.
- Worker failures are classified as retryable, permanent, or integrity failures.
- Integrity failures are visible and terminal; they MUST NOT be retried indefinitely.
- Transient failures retain their outbox row.
- Error responses MUST NOT expose stack traces, SQL, secrets, configuration, raw inputs, or provider diagnostics.

---

## 20. Configuration and secret rules

- Server configuration is parsed once through packages/config.
- Application modules MUST NOT read process.env directly.
- Browser configuration is parsed separately.
- Every VITE-prefixed value is public.
- VITE variables MUST NOT contain a key, token, database URL, private path, or credential.
- Required secrets and URLs have no insecure fallback.
- Missing or invalid security configuration causes startup to fail closed.
- Parse and bound booleans, integers, durations, ports, enums, and URLs explicitly.
- .env.example contains safe placeholders only.
- Real environment files, private keys, HMAC keys, database credentials, and service tokens MUST NOT be committed.
- Configuration values MUST NOT appear in logs, health responses, evidence exports, or errors.

---

## 21. Migration and seed rules

- SQL migrations are ordered and stored under packages/db/migrations/verifier and packages/db/migrations/action.
- Applied migrations are append-only. Never edit, reorder, or reuse a migration number.
- Roles, grants, constraints, indexes, state checks, and safe evidence views belong in migrations.
- API, worker, and Action Simulator processes MUST NOT auto-migrate.
- One short-lived migration job runs before services become ready.
- Migrations SHOULD be transactional where PostgreSQL permits.
- Non-transactional migration work requires a recovery note.
- Drizzle schema definitions MUST stay synchronized with SQL migrations.
- Use explicit SQL for critical constraints, row leases, SKIP LOCKED, roles, and views.
- Seeds are separate and idempotent.
- Seeds may create the default immutable demo policy but MUST NOT change schema.
- Every migration change is tested against an empty PostgreSQL instance.
- A verifier schema change also requires an updated privacy scan.

---

## 22. Testing rules

### General

- Test observable protocol properties, persisted state, and external effects—not only status codes or UI text.
- Tests MUST be deterministic through injected clocks, seeded randomness, explicit faults, and bounded waits.
- Do not use arbitrary sleep calls. Poll a condition with a deadline.
- Do not use automatic retries to hide flaky invariant failures.
- Each test owns isolated state.
- Every correctness, retry, fault, or privacy bug receives a regression test.
- Tests may inspect hidden slots and credential groups; production code may not import those helpers.
- Evidence assertions query verifier and Action Simulator state independently of frontend counters.

### Required unit coverage

- Canonical scope.
- Canonical action and intent digest.
- Retry/conflict classifier.
- State-transition guards.
- Action-key derivation.
- Event allowlists and redaction.
- Configuration and demo-mode guards.
- Invariant report.

### Opaque-adapter contract gate

The adapter suite MUST prove:

- Slots zero through L minus one verify.
- Slot L and other out-of-range slots fail.
- Same credential, scope, and slot produce the same nullifier.
- Different allowed slots produce different nullifiers.
- Same-use retry returns SAME_USE.
- Distinct valid uses return UNLINKABLE.
- Changed audience, policy, window, challenge, operation, or intent fails where applicable.
- Public outputs contain no credential-wide identifier or hidden slot.
- Copying a credential does not increase its fixed nullifier set.

### PostgreSQL gate

Transaction, lock, lease, and concurrency tests MUST run against real PostgreSQL through Testcontainers. SQLite and in-memory substitutes are not acceptable for these tests.

Required assertions:

- Use record and outbox event commit together.
- Forced rollback leaves neither.
- Twenty simultaneous identical presentations create:
  - One use record.
  - One outbox event.
  - One action key.
  - One external effect.
  - One stable receipt.
- A synchronization barrier makes race requests genuinely overlap.
- Competing workers cannot own one live lease.
- An expired lease is recoverable.
- Redelivery returns the original action receipt.
- Same nullifier with changed intent leaves the original immutable.

### Fault-recovery gate

| Fault | Required result |
|---|---|
| Invalid proof | No use, outbox, receipt, or action |
| Challenge expires before first commit | No use consumed |
| Database fails before acceptance commit | Full rollback |
| API stops after acceptance commit | Retry finds existing use |
| Worker stops before delivery | Lease recovery completes existing work |
| Worker stops after external commit | Redelivery returns original receipt |
| Final acknowledgement drops | Wallet retains the same pending operation |
| Retry occurs after challenge expiry | Existing use is recovered |
| Retry changes content | Conflict; original result unchanged |
| Action service fails transiently | Bounded retry and one eventual effect |
| Audit adapter is unavailable | Audit is incomplete, never falsely PASS |

### Privacy gate

Fail the build if verifier schema, rows, logs, events, exports, API responses, or browser assets expose prohibited identity, credential, proof, nullifier, hidden-slot, or secret material.

The privacy suite MUST scan:

- information_schema columns.
- Persisted verifier and action rows.
- Captured structured logs.
- Outbox payloads.
- Evidence exports.
- Browser build output.
- Production import graph.

---

## 23. Golden scenario

One reusable scenario MUST drive integration tests, Playwright, and the live judge demo:

1. Reset and verify zero uses and actions.
2. Load the default policy with limit three.
3. Issue one credential to the wallet.
4. Submit allowed slot zero and receive receipt A.
5. Arm drop-next-ack.
6. Submit slot one; acceptance and external action commit, but the wallet sees an unknown outcome.
7. Retry the exact stored slot-one operation and recover the original receipt with zero deltas.
8. Submit the previously unused slot two normally for the core P0 gate. After Phase 9 is implemented following G8, race twenty copies of this fresh third-use presentation and require all requests to converge on one use, outbox event, action, and receipt.
9. Attempt slot three; reject it without durable mutation.
10. Run pairwise linkability checks.
11. Compute the invariant report from authoritative state.

Required final values:

```text
declared_limit                         = 3
accepted_distinct_uses                 = 3
committed_external_actions             = 3
extra_uses_from_retry                  = 0
extra_actions_from_retry_or_race       = 0
over_limit_mutations                   = 0
stored_holder_identities               = 0
stored_credential_wide_identifiers     = 0
linked_distinct_legitimate_use_pairs   = 0
all_receipts_stable                    = true
all_invariants                         = PASS
```

Run requirements:

- Once on every change that touches a P0 flow.
- Before P1 exists, the core P0 variant MUST pass.
- After P1 exists, the full race variant MUST replace the core variant in normal CI.
- At least ten consecutive full-scenario runs in normal release CI.
- One hundred consecutive full-scenario runs before final submission.
- For a disclosed P0 baseline, these run counts apply to the complete core P0 variant; they do not establish that omitted Phase 9 checks passed.
- Any intermittent failure blocks release.

---

## 24. Required local quality gate

Root package.json MUST expose these stable commands:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:privacy
pnpm build
pnpm test:e2e
```

Run narrow affected tests while developing. Before declaring a change complete, run the full applicable gate in the listed order.

Additional requirements:

- Migration or transaction changes run concurrency and recovery suites.
- Contract, crypto, logging, evidence, or browser-bundle changes run the privacy suite.
- No focused, skipped, quarantined, or placeholder P0 tests may remain.
- No unresolved P0 TODO or FIXME may remain on the submission branch.

---

## 25. Continuous integration rules

CI runs from a clean checkout with a frozen lockfile and empty PostgreSQL.

Gate order:

1. Formatting, lint, dependency boundaries, typecheck, and migration validation.
2. Unit and opaque-adapter contract tests.
3. All-app build and browser privacy scan.
4. PostgreSQL integration, concurrency, lease, outbox, and action-idempotency tests.
5. Privacy scans.
6. Docker Compose cold start and Playwright golden scenario.
7. Release-only 100-run soak and complete fault matrix.

Independent jobs SHOULD run in parallel after the static gate.

CI MUST fail on:

- Type, lint, formatting, or dependency-boundary errors.
- Migration failure from an empty database.
- Skipped or focused P0 tests.
- Any privacy-scanner finding.
- Any invariant that is not explicitly PASS.
- A golden test that relies on frontend counters.
- Server-only code or secret-shaped values in the web bundle.
- An intermittent golden-scenario failure.

P0 and privacy gates MUST NOT be marked non-blocking for the submission branch.

---

## 26. Developer workflow

Follow the dependency order and cumulative gates in phases.md: kickoff, workspace, contracts and opaque interfaces, durable acceptance, one complete use, safe retry, bound and conflicts, evidence and privacy, guided UI and G8, conditional Phase 9 resilience, then mandatory Phase 10 release. Acceptance transactions and destination idempotency precede the first complete receipt. P1 work MUST NOT begin before G8.

Rules for every change:

- Build a small vertical slice with its tests.
- Do not build the final UI against fake persistence before the real path works.
- Preserve unrelated user changes.
- Keep generated build output out of source control.
- Commit pnpm-lock.yaml and SQL migrations when they change.
- Never commit .env files, keys, database dumps, raw credential fixtures, or unsanitized logs.
- Update contracts before consumers.
- Update documentation when behavior, architecture, configuration, commands, or assumptions change.
- Do not hide an architecture change inside a refactor.
- Do not leave silent catches, placeholder assertions, or manual database steps.

---

## 27. Definition of done for a change

A change is done only when:

- Behavior matches prd.md.
- Boundaries match architecture.md.
- This file's rules remain satisfied.
- Runtime contracts are updated.
- Happy path and relevant failure paths are tested.
- Relevant retry, concurrency, and privacy regressions are covered.
- Database changes include a reviewed migration and constraint tests.
- Events and logs contain only approved fields.
- No disabled test, unresolved P0 TODO, silent catch, or placeholder remains.
- The complete applicable local gate passes.
- Documentation matches the implementation.

---

## 28. Definition of done for the project

The full AnonLimit project is complete only when the following checks pass. A disclosed 24-hour P0 baseline follows Section 3 and MUST NOT mark omitted Phase 9 checks as complete.

- A fresh checkout starts through the documented Docker Compose command.
- Migration and default-policy seed complete automatically.
- Reset produces deterministic empty demo state.
- The guided scenario finishes in under three minutes.
- Three legitimate uses succeed and the fourth attempt changes no durable state.
- Lost acknowledgement recovers the original result without another use or action.
- Twenty racing requests create one use, one outbox item, one action, and one receipt.
- API and worker crash cases recover without releasing a slot or duplicating an effect.
- Distinct legitimate uses pass the supplied linkability test.
- Verifier storage, logs, events, exports, and browser assets pass the privacy gate.
- Demo-only routes are unavailable when DEMO_MODE is false.
- All displayed totals come from authoritative backend evidence.
- The 100-run release soak passes.
- The demo labels opaque cryptographic guarantees honestly.
- No P0 defect, invariant failure, or manual workaround remains.

---

## 29. Final rule

When a shortcut conflicts with privacy, idempotency, recoverability, or proof of the use bound, reject the shortcut.

The final system must be able to prove:

> Three uses. Three actions. Zero identity. Zero duplicate consumption. No link between legitimate uses.
