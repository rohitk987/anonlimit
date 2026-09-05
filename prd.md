# AnonLimit

## Product Requirements Document

| Field | Value |
|---|---|
| Product | AnonLimit |
| Problem statement | 135. Bounded Anonymous-Credential Reuse Control Without Identity Disclosure |
| Document status | Ready for hackathon development |
| Version | 1.0 |
| Last updated | 2026-09-05 |
| Target | Functional, judge-ready software simulation |
| Default demo policy | Three uses per anonymous credential |

---

## 1. Executive summary

AnonLimit is a software simulation that lets a service enforce a fixed number of uses for an anonymous credential without learning the holder's identity or linking their separate legitimate uses.

The default demonstration issues one credential that permits three redemptions. Three distinct presentations succeed. A deliberately lost acknowledgement is retried without consuming an additional use or duplicating the external action. A fourth presentation is rejected. A supplied opaque linkability test then verifies that the three legitimate uses cannot be correlated to a stable identity.

The project does not implement a complete anonymous-credential cryptosystem. Issuance, proof generation, proof verification, and linkability testing are supplied through opaque interfaces. AnonLimit's contribution is the protocol state, retry behavior, reuse-control ledger, concurrency safety, recovery model, privacy-safe storage, and visible evidence that the required invariants hold.

### One-line pitch

Enforce a three-use benefit without learning who owns it or linking their three legitimate uses.

### Core product promise

For a credential with declared limit L and quota scope S:

- At most L distinct uses can be accepted in S.
- An exact retry never consumes another use.
- One accepted use causes at most one committed external action.
- Invalid and over-limit presentations cause no usage-state mutation.
- The verifier stores no real-world identity or credential-wide identifier.
- Distinct legitimate uses remain unlinkable under the supplied opaque test.

---

## 2. Problem

Ordinary usage limits are enforced by maintaining an account-level counter. That creates a stable identifier and makes every action linkable to the same person. Anonymous credentials avoid revealing identity, but naive anonymity makes reuse difficult to control.

The verifier therefore needs to answer two questions that appear to conflict:

1. Is this presentation one of the credential's allowed uses?
2. Has this particular allowed use already been committed?

It must answer those questions without learning which credential generated other legitimate presentations.

Network and infrastructure failures add a second difficulty. If a valid action commits but its acknowledgement is lost, the holder must be able to retry and recover the original result. The retry must be recognized as the same use, while two separate legitimate uses must remain unlinkable.

---

## 3. Product principles

1. **No identity-based counter.** The verifier never groups uses by person or credential.
2. **Bounded hidden slots.** The cryptographic interface proves that every presentation comes from one of a finite number of hidden use slots.
3. **One-use linkability only.** Retries of the same hidden slot are intentionally recognizable as the same use. Different valid slots are not.
4. **Database-enforced correctness.** Durable uniqueness constraints, not process-local locks or frontend counters, decide whether a use is new.
5. **Idempotent effects.** A stable action key prevents repeated delivery from causing repeated external effects.
6. **Evidence over claims.** The demo derives its invariant panel from persisted verifier records and the simulated action log.
7. **Honest scope.** The UI distinguishes protocol guarantees from assumptions provided by the opaque cryptographic adapter.

---

## 4. Goals

### 4.1 Required product goals

- Simulate one credential issuer, one holder wallet, one verifier, one reuse-control ledger, and one external action service.
- Issue an anonymous credential with a configurable bounded-use policy; use three as the default.
- Accept every valid presentation up to the declared bound.
- Reject a presentation outside the declared bound.
- Safely recover from a lost acknowledgement by returning the previously committed result.
- Ensure invalid proof attempts and pre-commit failures do not consume a use.
- Prevent duplicate or concurrent delivery from creating more than one use record or external action.
- Persist only per-use replay-control data at the verifier.
- Demonstrate that distinct allowed presentations cannot be correlated through a stable credential identifier.
- Provide a deterministic guided demonstration that a judge can run in under three minutes.

### 4.2 Hackathon success goals

- Make the privacy-versus-rate-limit paradox understandable within 20 seconds.
- Make each state transition visible without requiring the judge to read logs.
- Finish with machine-derived evidence for use bound, retry safety, action deduplication, and unlinkability.
- Keep all cryptographic operations behind replaceable interfaces.

---

## 5. Non-goals

- Designing or implementing a production anonymous-credential or zero-knowledge proof scheme.
- Limiting uses per real-world human. The guarantee is per issued credential and quota scope.
- Preventing one person from obtaining multiple credentials; issuance eligibility is an issuer responsibility.
- Preventing credential sharing, theft, or use from a compromised holder device.
- Identity recovery, KYC, user accounts, or holder profiling.
- Credential revocation, backup, multi-device synchronization, or recovery.
- Defending against traffic timing, IP correlation, browser fingerprinting, or global network surveillance.
- Supporting collusion between issuer and verifier unless the supplied opaque interfaces explicitly guarantee resistance.
- Delivering irreversible real payments, healthcare actions, or production services.
- Claiming exactly-once network delivery. The system guarantees one committed effect at an idempotent action boundary.

---

## 6. Personas

### Credential holder

Wants to redeem a limited benefit without creating an account or revealing a stable identity. If a response is lost, the holder needs a safe retry that does not waste an allowance.

### Service operator

Needs to enforce the declared use bound and ensure retries, duplicate requests, crashes, and delayed processing cannot duplicate an external action.

### Privacy and security auditor

Needs inspectable evidence that verifier storage contains no holder identity or credential-wide identifier, and that separate legitimate presentations pass the provided unlinkability test.

### Hackathon evaluator

Needs to reproduce the required scenario quickly and see an unambiguous pass or fail for every requirement.

---

## 7. Definitions

| Term | Meaning |
|---|---|
| Credential | Opaque issuer artifact held only by the wallet |
| Holder | Client that stores a credential and creates presentations |
| Policy | Issuer-authorized maximum use count, audience, scope, and validity window |
| Quota scope | Canonical domain in which the declared bound applies |
| Hidden slot | One of the credential's allowed positions from 0 through L minus 1 |
| Presentation | Opaque proof plus public, allowlisted protocol fields |
| Nullifier | Pseudorandom value that is stable for one credential slot and scope |
| Intent | The exact operation and canonical payload authorized by a presentation |
| Exact retry | A repeat of the same nullifier, operation ID, and intent |
| Conflicting replay | The same nullifier or operation ID presented for different intent |
| Use record | Verifier record for one accepted nullifier; it is not a holder record |
| Receipt | Stable response for one committed external action |
| Linkability test | Supplied opaque function that checks whether presentations reveal a common stable holder |

---

## 8. Scope and priorities

phases.md defines the authoritative dependency schedule, numbered 0 through 10. P0 reaches its lock at G8; Phase 9 may begin only after G8 passes. A 24-hour P0 baseline may explicitly omit Phase 9, but Phase 10 and all applicable privacy and release gates remain mandatory. Such a baseline is not the completed full project: the race and crash requirements in Sections 23 and 33 remain required for full completion.

### P0: required MVP

- One issuer, holder wallet, verifier, PostgreSQL database, and simulated external action.
- Configurable policy with default maximum of three uses.
- Opaque issuance, presentation, verification, and linkability-test adapters.
- Three successful distinct presentations.
- Lost-acknowledgement injection and exact retry recovery.
- Over-limit rejection.
- Transactional per-use reservation with database uniqueness.
- Idempotent simulated external action.
- Privacy-safe event trace and verifier evidence view.
- Backend-derived invariant summary.
- Deterministic reset and guided demo.
- Automated golden-path, retry, over-limit, and privacy tests.
- Required pairwise linkability checks with aggregate evidence, and automated scans of schema, rows, logs, events, outbox payloads, exports, API responses, browser assets, and production imports.

### P1: winning robustness

- Concurrent duplicate race demonstration.
- Worker crash and redelivery fault injection.
- Conflicting replay demonstration.
- Optional matrix visualization of linkability results; pairwise checks and aggregate evidence remain P0.
- One-click export of sanitized evidence as JSON.

### P2: post-hackathon only

- Multiple quota windows.
- Multiple verifier audiences to demonstrate domain separation.
- Policy-expiry demonstration; validation of expiry before first acceptance remains P0.
- Performance dashboard and seeded randomized fault runs.

---

## 9. User stories

- As a holder, I can obtain a credential with a declared use bound.
- As a holder, I can present it without transmitting my name, account ID, or stable credential identifier to the verifier.
- As a holder, I can safely retry an uncertain request and recover its original receipt.
- As a verifier, I can accept no more than the declared number of distinct valid uses.
- As a verifier, I can reject reuse of one allowed slot for a different action.
- As an operator, I can guarantee that one accepted use produces at most one external effect.
- As an auditor, I can inspect exactly which fields the verifier stores.
- As an auditor, I can compare every pair of legitimate presentations using the supplied linkability test.
- As a judge, I can run, reset, and replay the full scenario without editing source code or the database.

---

## 10. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-01 | Create and expose a canonical bounded-use policy | P0 |
| FR-02 | Issue an opaque credential to the holder without creating a verifier identity record | P0 |
| FR-03 | Generate a separate presentation for each hidden allowed slot | P0 |
| FR-04 | Verify issuer validity, policy, audience, scope, hidden-slot range, nullifier derivation, and request binding through the opaque adapter | P0 |
| FR-05 | Accept at most L distinct valid nullifiers from one credential in one quota scope | P0 |
| FR-06 | Atomically reserve an accepted nullifier and create recovery work | P0 |
| FR-07 | Return the existing state or receipt for an exact retry without another use delta | P0 |
| FR-08 | Reject the same nullifier used for a different intent | P0 |
| FR-09 | Reject invalid, expired, policy-mismatched, or out-of-range presentations without committing usage state | P0 |
| FR-10 | Commit at most one simulated external action per accepted use | P0 |
| FR-11 | Resume accepted pending work after a crash or retry | P0 |
| FR-12 | Persist no holder identity, credential-wide identifier, raw credential, raw proof, or hidden slot | P0 |
| FR-13 | Run the supplied linkability test over all distinct accepted presentations | P0 |
| FR-14 | Display a live, privacy-safe protocol trace and invariant panel | P0 |
| FR-15 | Reset every simulator component to a known empty state | P0 |
| FR-16 | Race identical presentations and prove convergence on one result | P1 |
| FR-17 | Export sanitized verifier evidence | P1 |

---

## 11. Protocol model

### 11.1 Canonical quota scope

The quota scope S is issuer-authorized and verifier-canonical. The client cannot choose arbitrary scope values.

    S =
      issuer_key_id ||
      policy_id ||
      policy_version ||
      verifier_audience ||
      quota_window_id

Including the verifier audience prevents services from correlating the same credential through a shared nullifier domain. A new quota window intentionally creates a new allowance.

### 11.2 Per-use nullifier

For credential secret x, declared limit L, and hidden slot i:

    NF_i = PRF_x("AnonLimit/v1" || S || i)

The nullifier intentionally excludes the request payload, challenge, and operation ID. If request-controlled values changed the nullifier, a holder could vary those values and create unlimited nullifiers from one allowed slot.

Required behavior:

- Reusing the same slot in the same scope produces the same nullifier.
- Different allowed slots produce computationally unlinkable nullifiers.
- A slot outside the range 0 ≤ i < L cannot produce a valid presentation.
- Copying the credential does not increase its allowance because every copy derives the same bounded nullifier set.

### 11.3 Request binding

Each intended operation has a random operation ID that remains stable across transport retries.

    intent_digest = H(
      protocol_version ||
      operation_id ||
      HTTP_method ||
      resource ||
      canonical_action_payload
    )

    proof_context = H(
      protocol_version ||
      quota_scope ||
      intent_digest ||
      verifier_challenge
    )

The proof binds the stable per-use nullifier to this context. The holder cannot reuse one slot for modified intent without the verifier detecting the same nullifier with a different digest.

### 11.4 Opaque proof statement

Without revealing the credential secret, hidden slot, or a credential identifier, the proof adapter must establish:

- The holder possesses a valid credential issued under a trusted issuer key.
- The credential is authorized for the canonical policy and quota scope.
- The hidden slot is within the declared range.
- The public nullifier was correctly derived from that credential, scope, and slot.
- The proof is bound to the submitted verifier audience, challenge, operation ID, and intent digest.

### 11.5 Required opaque-provider guarantees

- Credential and proof unforgeability.
- Blind or unlinkable issuance.
- Zero-knowledge presentation.
- Sound hidden-slot range proof.
- Deterministic nullifier derivation for one credential, scope, and slot.
- No alternate valid nullifier for the same slot.
- Unlinkability across different allowed slots.
- Domain separation across verifier scopes.
- Binding to the supplied public context.

The application must not infer these guarantees from random IDs or ordinary hashes. They are explicit contracts of the supplied cryptographic interface.

### 11.6 Opaque adapter contracts

Reference interface:

    issueAnonymousCredential(
      blindedHolderRequest,
      quotaPolicy
    ) -> opaqueCredential

    createPresentation(
      opaqueCredential,
      hiddenSlot,
      proofContext
    ) -> {
      nullifier,
      opaqueProof
    }

    verifyPresentation(
      issuerPublicParameters,
      quotaPolicy,
      proofContext,
      nullifier,
      opaqueProof
    ) -> {
      valid,
      diagnosticCode
    }

    testLinkability(
      presentationA,
      presentationB
    ) -> SAME_USE | UNLINKABLE

Production-shaped responses should collapse cryptographic failure reasons into PRESENTATION_REJECTED. A test-only adapter may expose BOUND_EXCEEDED in the private demo trace to demonstrate the over-limit case.

---

## 12. Holder behavior

Before its first submission, the wallet must durably save:

- Credential handle.
- Selected hidden slot.
- Random operation ID.
- Canonical action payload.
- Intent digest.
- Nullifier.
- Serialized presentation envelope.
- Submission status and eventual receipt.

If the response is lost or times out, the wallet resends the stored operation. It must not allocate the next slot merely because the result is unknown.

The identity of an exact retry is:

    quota_scope + nullifier + operation_id + intent_digest

The normal lost-acknowledgement path resends the exact stored envelope. If a request failed before verifier commitment because its challenge expired, the wallet may create a fresh proof with the same reserved slot and intent. It still must not advance to another slot.

Wallet rollback may select a previously used slot, but it cannot cause overuse. The verifier will recover the prior result or reject a conflicting reuse.

---

## 13. Core workflows

### 13.1 Credential issuance

1. The issuer publishes a policy with maximum uses, audience, quota window, and expiry.
2. The wallet submits the opaque issuance request.
3. The issuer performs simulated eligibility approval outside the verifier boundary.
4. The issuer adapter returns an opaque credential only to the wallet.
5. The verifier receives no issuance event containing a holder or credential identifier.

### 13.2 First-time valid presentation

1. The wallet reserves its next unused hidden slot locally.
2. It creates a random operation ID and canonical intent.
3. It requests a verifier challenge.
4. The opaque holder adapter creates a nullifier and proof.
5. The verifier validates public fields and calls the opaque verification adapter without writing usage state.
6. If valid, one database transaction inserts the use record and its outbox event.
7. The action worker sends the stable action key to the simulated service.
8. The service commits the effect once and returns a receipt.
9. The verifier stores the receipt and returns it to the wallet.

### 13.3 Lost acknowledgement and exact retry

1. The accepted use and external action commit.
2. The demo fault injector drops the response before it reaches the wallet.
3. The wallet remains in outcome-unknown state and retains the same slot and operation.
4. It resends the stored envelope.
5. The verifier finds the same nullifier and intent before rejecting an expired challenge.
6. It returns the existing in-progress state or cached receipt.
7. Usage delta and external-action delta are both zero.

### 13.4 Invalid or over-limit presentation

1. The wallet or test harness sends an invalid, tampered, or out-of-range proof.
2. The opaque verifier rejects it.
3. No use record, outbox event, receipt, or action is created.
4. The demo may show a private diagnostic, while the public API returns a generic rejection.

### 13.5 Concurrent duplicate

1. Two or more identical requests reach different verifier workers.
2. Each may complete proof verification.
3. Only one transaction can satisfy the database unique constraints.
4. Losing requests load the winning record.
5. Every request converges on the same use handle and receipt.

### 13.6 Conflicting replay

1. A previously seen nullifier is submitted with a different operation ID or intent digest.
2. The verifier rejects it with NULLIFIER_REUSE_CONFLICT.
3. The original action and receipt remain unchanged.

---

## 14. State model

### 14.1 Use-state machine

    UNSEEN
      |
      | invalid proof or policy
      +------------------------------> REJECTED
      |                                 no durable use state
      |
      | valid proof + atomic commit
      v
    ACCEPTED_PENDING_ACTION
      |
      | worker retry or lease expiry
      +------------------------------> ACCEPTED_PENDING_ACTION
      |
      | idempotent action succeeds
      v
    SUCCEEDED

An accepted use is consumed when the acceptance transaction commits. That transaction always creates durable recovery work. Infrastructure failure after acceptance does not release the slot or consume another one; processing resumes under the same action key.

A terminal downstream business rejection may be represented as FAILED_FINAL. It remains the result of the already accepted use and is returned consistently on retry. The required hackathon scenario uses a successful action service.

### 14.2 Retry decision table

| Existing use state | Same intent | Different intent |
|---|---|---|
| No record | Verify and reserve once | Verify and reserve once |
| ACCEPTED_PENDING_ACTION | Return 202 for the same use; enqueue nothing new | Reject with conflict |
| SUCCEEDED | Return cached receipt with usage delta zero | Reject with conflict |
| FAILED_FINAL | Return cached failure with usage delta zero | Reject with conflict |

---

## 15. System architecture

Use one modular API with separate issuer and verifier modules, plus independently runnable web, worker, and Action Simulator apps, as defined in architecture.md.

    Demo Lab UI / Holder Wallet
       |
       +-- Issuer module
       |     +-- Opaque Issuer Crypto adapter
       |
       +-- Verifier API
             +-- Opaque Verifier Crypto adapter
             +-- PostgreSQL
             |     +-- policies
             |     +-- challenges
             |     +-- use records
             |     +-- transactional outbox
             |
             +-- Outbox worker
                   +-- Idempotent action simulator

### Component responsibilities

| Component | Responsibility |
|---|---|
| Issuer module | Publishes policy and issues opaque credentials |
| Holder wallet | Stores credentials, local slot state, pending operations, and receipts |
| Verifier API | Validates context and proof, performs atomic acceptance, resolves retries |
| Crypto adapters | Supply issuance, proof, verification, and linkability semantics |
| PostgreSQL | Enforces uniqueness and persists accepted-use recovery state |
| Outbox worker | Reliably resumes accepted external actions |
| Action simulator | Applies one effect per action key and returns a stable receipt |
| Privacy auditor | Computes storage, action, retry, and linkability evidence |
| Demo Lab | Runs the scenario and visualizes actual backend state |

### Selected implementation stack

architecture.md Section 4 fixes the implementation stack for this repository:

- Strict TypeScript and pnpm workspaces on Node.js 24 LTS.
- React with Vite for the Demo Lab and IndexedDB wallet.
- Fastify for the API and separate Action Simulator.
- PostgreSQL 17 with Drizzle, node-postgres, and explicit transactional SQL.
- A small Node.js PostgreSQL outbox worker.
- Vitest for unit and contract suites; real PostgreSQL through Testcontainers for database integration suites.
- Playwright for the guided end-to-end scenario.

Docker Compose runs the four apps and PostgreSQL. Alternate stacks and database substitutes are outside this implementation plan.

---

## 16. Trust boundaries and data minimization

### Issuer may know

- Eligibility evidence required to issue the credential.
- Policy and maximum use count.
- Issuer cryptographic material.

For the demo, eligibility may be a boolean simulation and need not be retained.

### Holder wallet may know

- Opaque credential.
- Local hidden slots.
- Local acknowledgement state.
- Pending operations and receipts.

The UI must label holder-side counters as local-only.

### Verifier may know and persist

- Policy and scope hashes.
- Per-use nullifier lookup key.
- Random operation ID.
- Intent digest.
- Processing state.
- Stable action key.
- Cached receipt.
- Privacy-safe decision events.

### Verifier must never persist or log

- Name, email, phone number, account ID, or real-world subject identifier.
- Credential serial, credential-wide pseudonym, holder public key, or hidden slot.
- Credential secret.
- Raw credential or raw proof.
- Raw nullifier.
- IP address, user agent, browser fingerprint, or unbounded request body in application telemetry.
- Test-harness labels that reveal which credential generated which presentation.

The action payload must follow an identity-free allowlist. Anonymous protocol metadata is insufficient if the business payload itself contains a person identifier.

---

## 17. Data model

### 17.1 quota_policies

| Field | Notes |
|---|---|
| policy_id | Human-readable policy name |
| version | Immutable version |
| issuer_key_id | Trusted issuer key reference |
| verifier_audience | Canonical audience |
| max_uses | Default 3 |
| quota_window_id | Domain separation for one allowance window |
| policy_digest | Canonical digest |
| not_before | Validity start |
| expires_at | Validity end |
| status | ACTIVE or DISABLED |

Primary key: policy_id plus version.

### 17.2 verification_challenges

| Field | Notes |
|---|---|
| challenge_id | Random identifier |
| nonce_hash | Hash of the issued nonce |
| policy_id, policy_version | Policy reference |
| operation_id | Random per intended use |
| intent_digest | Canonical request binding |
| expires_at | Short validity |
| state | ISSUED, CONSUMED, or EXPIRED |
| use_id | Nullable accepted-use reference |

### 17.3 use_records

| Field | Notes |
|---|---|
| use_id | Random per-use handle |
| demo_run_id | Server-controlled operational demo scenario |
| scope_hash | Hash of canonical quota scope |
| nullifier_key | HMAC of scope and raw nullifier under a verifier ledger key |
| operation_id | Random ID stable across exact retries |
| intent_digest | Immutable request binding |
| status | ACCEPTED_PENDING_ACTION, SUCCEEDED, or FAILED_FINAL |
| action_key | Stable downstream idempotency key |
| cached_result | Canonical receipt or failure |
| created_at | Acceptance time |
| completed_at | Nullable terminal time |

Required unique constraints:

    UNIQUE(demo_run_id, scope_hash, nullifier_key)
    UNIQUE(demo_run_id, scope_hash, operation_id)
    UNIQUE(action_key)

There is deliberately no credential ID, holder ID, hidden slot, or per-holder usage counter.

demo_run_id isolates resettable operational state and never grants another allowance. The server owns the active demo run. Reset invalidates prior-run demo credentials, challenges, and wallet pending operations; a prior-run credential must be rejected even if resubmitted with the new run ID. Clearing browser state alone is insufficient. Issuance and verification enforce this boundary without storing a credential-wide identifier at the verifier.

### 17.4 outbox_events

| Field | Notes |
|---|---|
| event_id | Random event ID |
| use_id | Accepted-use reference |
| action_key | Idempotency key |
| event_type | COMMIT_DEMO_ACTION |
| safe_payload | Identity-free action payload |
| state | READY, LEASED, DELIVERED, or DEAD_LETTER |
| attempt_count | Delivery attempts |
| lease_until | Recovery lease |
| last_error | Sanitized operational error |

Required unique constraint: one event type per use record.

### 17.5 simulated_action_results

| Field | Notes |
|---|---|
| action_key | Primary key and external idempotency boundary |
| payload_digest | Detects key reuse with changed content |
| receipt | Stable result |
| committed_at | Effect time |

Repeated delivery with the same key and payload returns the stored receipt. The same key with a different payload raises an integrity error.

---

## 18. Acceptance transaction

The verifier must process a presentation in this order:

1. Reject unknown public fields and canonicalize the allowlisted action.
2. Recompute intent digest and proof context.
3. Derive the protected nullifier lookup key without persisting the raw nullifier.
4. Look for a prior accepted record:
   - Same scope, nullifier, operation, and intent: return its existing state or receipt.
   - Same nullifier or operation with different intent: reject as a conflict.
5. Validate challenge, audience, policy version, policy status, quota window, and expiry.
6. Call the opaque proof verifier. This stage performs no usage-state writes.
7. Begin one database transaction.
8. Lock and recheck authoritative policy and challenge state inside that transaction.
9. Insert one ACCEPTED_PENDING_ACTION use record.
10. Atomically mark its challenge consumed.
11. Insert one outbox event.
12. Insert one privacy-safe USE_ACCEPTED event.
13. Commit all changes together.
14. If a uniqueness conflict occurs, roll back, load the winning record, and apply the retry decision table.

There must be no correctness-critical check-then-insert outside the transaction. Database constraints are authoritative.

### Consumption semantics

- Invalid proof: no use consumed.
- Expired or mismatched challenge before acceptance: no use consumed.
- Policy rejection before acceptance: no use consumed.
- Database rollback: no use consumed.
- Successful acceptance transaction: exactly one use consumed.
- Lost response after acceptance: no additional use consumed.
- Downstream retry after acceptance: no additional use consumed.

---

## 19. External-action guarantee

The outbox worker may deliver the same message multiple times. Every delivery carries the same action key.

The action simulator must atomically:

1. Insert the effect under a unique action key.
2. Perform the effect only if that insert wins.
3. Store and return a canonical receipt.
4. Return the stored receipt for repeated delivery with the same payload.
5. reject and alert if the same action key is paired with a different payload digest.

This provides exactly one committed external action per accepted use under an idempotent action boundary. A transactional outbox by itself is insufficient; the destination must also honor the idempotency key.

---

## 20. API requirements

Exact JSON shapes may evolve, but the following semantics are required.

### POST /v1/issuer/credentials

Creates one opaque credential for a selected policy.

Request:

    {
      "policyId": "anon-demo",
      "policyVersion": 1,
      "eligibilityEvidence": "<opaque optional value>"
    }

Response to wallet only:

    {
      "credential": "<opaque blob>",
      "policy": {
        "id": "anon-demo",
        "version": 1,
        "audience": "demo-service",
        "maxUses": 3,
        "quotaWindowId": "hackathon-demo"
      }
    }

### POST /v1/verifier/challenges

Creates a short-lived challenge bound to the intended action.

Request:

    {
      "policyId": "anon-demo",
      "policyVersion": 1,
      "audience": "demo-service",
      "operationId": "<random per-use ID>",
      "action": {
        "type": "REDEEM_DEMO_BENEFIT",
        "payload": {
          "benefitCode": "HACKATHON"
        }
      }
    }

Response:

    {
      "challengeId": "chl_...",
      "nonce": "<random nonce>",
      "policyDigest": "sha256:...",
      "expiresAt": "<timestamp>"
    }

### POST /v1/verifier/presentations

Header:

    Idempotency-Key: <operation ID>

Request includes operation ID, policy reference, audience, challenge, allowlisted action, nullifier, and opaque proof.

Newly accepted response:

    {
      "useId": "use_...",
      "status": "ACCEPTED_PENDING_ACTION",
      "replayed": false,
      "usageDelta": 1
    }

Exact completed retry response:

    {
      "useId": "use_...",
      "receiptId": "rcpt_...",
      "status": "SUCCEEDED",
      "replayed": true,
      "usageDelta": 0
    }

### GET /v1/verifier/uses/{useId}

Returns ACCEPTED_PENDING_ACTION, SUCCEEDED, or FAILED_FINAL. An exact POST retry remains the recovery path when the original response containing useId was lost.

### POST /v1/demo/linkability-test

Runs the supplied opaque comparison over all distinct accepted demo presentations and returns a pairwise matrix plus a summary. Test-harness credential labels must not cross into verifier storage.

### POST /v1/demo/reset

Clears only the bounded demo scenario and restores the default policy. This endpoint must be disabled outside demo mode.

### Required response codes

| Code | Meaning | Usage delta |
|---|---|---:|
| PRESENTATION_REJECTED | Invalid, forged, or out-of-range proof | 0 |
| CHALLENGE_EXPIRED | First acceptance arrived too late | 0 |
| POLICY_REJECTED | Policy, audience, or scope invalid | 0 |
| NULLIFIER_REUSE_CONFLICT | Same per-use nullifier with changed intent | 0 |
| IDEMPOTENCY_CONFLICT | Same operation ID with changed content | 0 |
| ACCEPTED_PENDING_ACTION | New valid use accepted | 1 |
| RETRY_IN_PROGRESS | Exact retry found pending work | 0 |
| RETRY_RESOLVED | Exact retry returned cached result | 0 |

---

## 21. Demo Lab UX

The MVP should use one polished Demo Lab page with an Evidence drawer or tab.

### 21.1 Scenario controls

- Issue credential.
- Present next use.
- Drop next acknowledgement.
- Retry last request.
- Attempt fourth use.
- Race duplicate requests.
- Run guided demo.
- Run privacy audit.
- Reset scenario.

### 21.2 Holder Wallet panel

Display:

- Anonymous credential ready.
- Declared limit.
- Local-only available, awaiting-confirmation, and acknowledged state.
- Safe-retry prompt after a lost acknowledgement.
- Recovered prior receipt after an exact retry.

Never display a global user ID. Clearly label holder knowledge as local and unavailable to the verifier.

### 21.3 Live protocol trace

Use four swimlanes:

    Issuer -> Holder Wallet -> Verifier -> Simulated Service

Show plain-language events first, with optional technical details:

- Credential issued.
- Presentation received.
- Proof accepted.
- Use atomically reserved.
- External action committed.
- Acknowledgement intentionally dropped.
- Retry matched to prior operation.
- Cached receipt returned.
- Over-limit proof rejected.

### 21.4 Verifier Evidence panel

Show actual sanitized backend records:

| Displayed field | Purpose |
|---|---|
| Masked per-use reference | Detects retry of one use |
| Intent digest | Distinguishes retry from conflicting replay |
| State | Shows accepted or completed work |
| Receipt ID | Shows recovery of the original result |
| Action key | Proves downstream deduplication |

Include this explanation:

> A nullifier identifies one allowed use and its retries. It does not identify a holder or connect that use to the holder's other valid uses.

### 21.5 Invariant summary

All values must come from verifier storage, action records, and the supplied linkability test.

    Declared limit                         3
    Distinct committed uses               3
    Unique external actions               3
    Extra uses caused by retry            0
    Extra actions caused by retry          0
    Failed attempts consuming a use       0
    Over-limit attempt                    REJECTED
    Credential-wide identities stored     0
    Distinct legitimate uses linked       0
    Overall result                        PASS

### 21.6 Linkability matrix (optional visualization)

The matrix display may be cut when time is short. Every pairwise check and the aggregate linkability result remain required P0 evidence.

| Comparison | Expected result |
|---|---|
| Use A against Use B | UNLINKABLE |
| Use A against Use C | UNLINKABLE |
| Use B against Use C | UNLINKABLE |
| Use B against exact retry of B | SAME_USE |

The final row is intentional. Recognizing an exact retry as the same operation does not create a credential-wide identity.

### 21.7 Required visual states

- Credential not issued.
- Ready to present.
- Verification in progress.
- Accepted and acknowledged.
- Accepted but acknowledgement lost.
- Exact retry recovered.
- Duplicate currently processing.
- Conflicting replay rejected.
- Invalid proof rejected.
- Over-limit rejected.
- Privacy audit passed or failed.
- Scenario reset.

Use green for a newly accepted use, amber for retry recovery, red for rejection, and blue or purple for privacy evidence. Never visualize a retry as another consumed use.

---

## 22. Judge-ready demonstration

Target duration: 2 minutes 30 seconds.

### 0:00-0:20 — State the paradox

“Most services enforce a limit by tracking an account. AnonLimit enforces three uses without learning who the holder is or linking the three legitimate uses.”

Show that the verifier database begins empty.

### 0:20-0:40 — Issue

Issue the credential. Show the limit inside the local wallet and show that the verifier received no holder record.

### 0:40-1:10 — Use and lose an acknowledgement

Complete use one. Arm the acknowledgement fault, then submit use two. The external action commits, but the wallet receives no response.

### 1:10-1:35 — Recover safely

Retry the stored second request. Show RETRY_RESOLVED and the same receipt. Highlight zero change in committed uses and external actions.

### 1:35-1:55 — Enforce the bound

Complete use three. Attempt use four and show rejection with no state change.

### 1:55-2:30 — Prove the claims

Run the pairwise linkability test and open the invariant summary:

“Exactly three uses, exactly three actions, no retry charge, no stored identity, and no link between distinct legitimate uses.”

Keep the concurrent race and worker crash as optional evidence or automated-test results if live-demo time is limited.

---

## 23. Acceptance criteria

### AC-01: Anonymous issuance boundary

Given a fresh scenario, when a three-use credential is issued, the wallet receives the opaque credential and the verifier receives or creates no real-world or credential-wide identity.

### AC-02: Exact bounded use

Given a valid three-use credential, when three distinct allowed presentations are submitted, all three are accepted and exactly three use records and three unique external actions eventually exist.

### AC-03: Lost-acknowledgement retry

Given that a use and its action committed but the response was dropped, when the wallet retries the stored operation, the verifier returns the existing state or original receipt and both usage delta and action delta are zero.

### AC-04: Failed verification

Given a malformed, forged, tampered, or policy-mismatched presentation, when verification fails, no use record, outbox event, receipt, or external action is created.

### AC-05: Pre-commit infrastructure failure

Given a valid presentation and an injected failure before the acceptance transaction commits, when the request fails, no use is consumed. A later retry may commit the use exactly once.

### AC-06: Over-limit attempt

Given that all three allowed slots have been exercised, when a fourth-slot presentation is attempted, the opaque verifier rejects it and all usage and action counts remain unchanged.

### AC-07: Duplicate concurrency

Given 20 concurrent identical submissions, at most one use record, one outbox event, and one external action are created. Every successful response converges on the same use and receipt.

### AC-08: Conflicting replay

Given an accepted nullifier, when it is submitted for different intent, the verifier rejects it and leaves the original action and receipt unchanged.

### AC-09: Crash recovery

Given a crash after acceptance but before external completion, the durable outbox eventually resumes the same action without creating another use.

### AC-10: External deduplication

Given repeated delivery of the same outbox event, the action simulator commits one effect and returns one stable receipt.

### AC-11: Unlinkability

Given the three distinct accepted presentations, every pair returns UNLINKABLE from the supplied test. An exact retry may return SAME_USE.

### AC-12: Data minimization

After the complete scenario, verifier tables, logs, outbox payloads, and exports contain no name, email, account ID, credential serial, holder key, hidden slot, raw credential, raw proof, raw nullifier, IP address, browser fingerprint, or user agent.

### AC-13: Evidence integrity

Every invariant displayed by the UI is computed from persisted verifier records, action records, and opaque test output. The frontend has no authoritative independent counter.

### AC-14: Repeatable demo

A judge can reset and run the required scenario in under three minutes without source changes, direct database manipulation, or a service restart.

---

## 24. Non-functional requirements

### Correctness

- Database uniqueness is authoritative for same-use detection.
- Acceptance and outbox insertion are one transaction.
- Canonical request serialization is deterministic.
- The action destination is idempotent by action key.
- All demo counts are backend-derived.

### Privacy

- Public request fields use a strict allowlist.
- Raw request-body logging is disabled.
- Proof and credential blobs never appear in logs, database rows, outbox events, analytics, or error reports.
- Per-use nullifiers are transformed with a keyed verifier lookup function before persistence.
- No cross-use subject key or per-credential usage counter exists at the verifier.

### Reliability

- Pending outbox work survives process restart.
- Worker leases expire and allow another worker to resume.
- An accepted use never requires the wallet to spend a new slot merely to learn its result.
- The reset operation is deterministic and scoped only to demo data.

### Performance

- Normal local verification response target: under 750 ms excluding intentional delay.
- Demo reset target: under 2 seconds.
- The verifier must handle at least 20 concurrent copies of one request with one committed result.

### Accessibility and presentation

- Status is communicated with text and icons as well as color.
- The guided demo fits a standard laptop viewport.
- Technical details are expandable so the primary story remains understandable.

---

## 25. Security and privacy invariants

1. **Bounded use:** one credential can yield at most L accepted distinct nullifiers in one quota scope.
2. **Single acceptance:** at most one use record exists for one scope and nullifier.
3. **Intent immutability:** an accepted nullifier can never authorize different intent.
4. **Retry idempotency:** an exact retry never creates another use or action.
5. **No failed-verification consumption:** rejected proofs create no use state.
6. **Single external effect:** one accepted use causes at most one committed external action.
7. **Recoverability:** every accepted pending use has durable recovery work.
8. **No stable identity:** verifier state contains no holder identity, credential serial, or cross-use credential key.
9. **Distinct-use unlinkability:** different allowed slots expose no common credential-derived value.
10. **Scoped linkability:** nullifiers cannot be used to correlate the same credential across verifier scopes.
11. **Retry-only linkability:** repeated presentation of one slot is linkable only as the same use.
12. **No verifier quota counter:** boundedness comes from proof soundness and per-use uniqueness, not grouping a holder's activity.

---

## 26. Threat model

### In scope

- A holder with a valid credential attempts to exceed the limit.
- The holder reuses an allowed slot for changed intent.
- The same request arrives repeatedly or concurrently.
- Requests or responses are lost, delayed, or duplicated.
- The verifier crashes before or after acceptance.
- The worker crashes before or after the external action.
- A malformed presentation attempts to add an identity-bearing public field.
- Application logs accidentally attempt to serialize sensitive blobs.

### Trusted or assumed

- Issuer and verifier cryptographic parameters are authentic.
- Opaque adapter guarantees are correct.
- TLS protects presentation envelopes in transit.
- The database provides transactional uniqueness.
- The simulated destination honors its idempotency key.
- Accepted pending work is eventually processed.

### Out of scope

- Compromised issuer, holder device, or cryptographic provider.
- Credential sharing or theft.
- Sybil issuance and multiple credentials per human.
- Network-layer metadata correlation.
- Malicious verifier and issuer collusion beyond adapter guarantees.
- A downstream system that cannot support an idempotent commit boundary.

---

## 27. Privacy-safe observability

Only allowlisted structured events may be emitted:

- CREDENTIAL_ISSUED
- PRESENTATION_RECEIVED
- PRESENTATION_REJECTED
- USE_ACCEPTED
- ACTION_DISPATCH_STARTED
- EXTERNAL_ACTION_COMMITTED
- RECEIPT_STORED
- ACK_DROPPED
- RETRY_MATCHED
- CACHED_RECEIPT_RETURNED
- NULLIFIER_CONFLICT
- OVER_LIMIT_REJECTED
- PRIVACY_AUDIT_COMPLETED

Allowed event fields:

- Random trace or attempt ID.
- Policy ID and version.
- State transition.
- Decision code.
- Latency.
- Usage delta.
- External-action delta.
- Masked per-use reference.

Forbidden event fields include raw credentials, raw proofs, secrets, raw nullifiers, holder identity, credential-wide identifiers, hidden slots, IP addresses, user agents, and unbounded payloads.

---

## 28. Failure and recovery matrix

| Failure point | Required result |
|---|---|
| During proof verification | No state change; retry verifies again |
| After verification but before transaction commit | No use consumed |
| After acceptance commit but before response | Retry finds existing accepted use |
| After acceptance but before dispatch | Durable outbox resumes later |
| During worker processing | Lease expires and another worker resumes |
| After external commit but before worker acknowledgement | Redelivery returns the original external receipt |
| After local completion but before wallet acknowledgement | Exact retry returns the cached receipt |
| Challenge expires before first acceptance | Rejected without consumption |
| Challenge expires after accepted response is lost | Exact retry returns prior state or receipt |
| Policy changes after acceptance | Retry returns the committed decision |
| Same nullifier arrives with changed payload | Conflict; original state is unchanged |

---

## 29. Test strategy

### 29.1 Crypto adapter contract tests

- Allowed slots from 0 through L minus 1 verify.
- Slot L does not verify.
- The same credential, scope, and slot yields the same nullifier.
- Different allowed slots yield distinct nullifiers.
- Different allowed slots pass the supplied unlinkability test.
- Wrong audience, policy, quota window, challenge, request digest, or issuer parameters fail.
- No public output contains a credential identifier or hidden slot.

### 29.2 Unit tests

- Canonical request digest is stable across JSON key ordering.
- Request changes alter intent digest.
- Scope is server-canonical and cannot be overridden by the client.
- Retry classification follows the decision table.
- Public-field allowlisting rejects identity-bearing or unknown fields.
- Sanitized event serializers cannot output credential or proof blobs.

### 29.3 Integration tests

- Three allowed uses create three records and three actions.
- Fourth-slot proof is rejected without state mutation.
- Lost acknowledgement retry returns the same receipt.
- Twenty concurrent identical submissions create one use and action.
- Same nullifier with changed intent is rejected.
- Database failure before commit rolls back use and outbox together.
- Worker restart before dispatch completes pending work.
- Worker crash after action but before acknowledgement does not duplicate the effect.
- Challenge expiry before first acceptance consumes nothing.
- Exact retry after challenge expiry still resolves an already accepted use.

### 29.4 Privacy validation

- Migration test asserts there are no verifier columns for subject ID, email, credential ID, holder key, or hidden slot.
- Log scanner searches for forbidden field names and known test secrets.
- Database scanner verifies raw credential, proof, and nullifier values are absent.
- Dashboard distinguishes wallet/test-harness knowledge from verifier knowledge.
- Linkability checks return UNLINKABLE for every pair of distinct accepted uses; any matrix display reflects those results.

### 29.5 Golden evaluation test

Reset and verify zero uses and actions, then load the default policy with maximum uses equal to three:

1. Issue one credential.
2. Accept slot zero.
3. Accept slot one while dropping its acknowledgement.
4. Retry slot one and recover the same result.
5. Accept the previously unused slot two normally for P0. After Phase 9 is implemented, submit twenty concurrent copies of this fresh third-use presentation and require convergence on one use, outbox event, action, and receipt.
6. Attempt slot three and reject it.
7. Run all pairwise linkability checks, including SAME_USE recognition for the exact retry.
8. Inspect the verifier schema and sanitized log.
9. Assert the complete invariant panel is PASS.

The applicable variant must pass 100 consecutive deterministic runs before release. Once Phase 9 exists, the race variant replaces the core P0 variant in normal CI. A P0 baseline must explicitly report Phase 9 as omitted; it cannot claim that concurrency and crash validation are complete.

---

## 30. Success metrics

| Metric | Target |
|---|---:|
| Accepted distinct uses for limit L | Exactly L |
| External actions per accepted use | Exactly 1 |
| Additional uses caused by exact retry | 0 |
| Additional actions caused by exact retry | 0 |
| State mutations from invalid or over-limit proof | 0 |
| Stored real-world identities | 0 |
| Stored credential-wide identifiers | 0 |
| Linked pairs among distinct valid uses | 0 |
| Concurrent identical submissions | 20 with one result |
| Consecutive golden-scenario passes | 100 |
| Guided live-demo duration | Under 180 seconds |

---

## 31. Key risks and mitigations

| Risk | Mitigation |
|---|---|
| Random tokens are incorrectly presented as proof of anonymity | Treat privacy guarantees as explicit opaque-adapter contracts and show the supplied linkability result |
| Nullifier derivation includes request-controlled data and permits unlimited variants | Derive it only from credential secret, canonical scope, and hidden slot |
| The wallet spends another slot after a timeout | Persist operation and presentation before send; keep outcome-unknown state until reconciled |
| Two workers pass a check before either writes | Use a database unique constraint and atomic insert |
| The outbox is durable but the external effect duplicates | Require the action simulator to enforce a unique action key |
| An identifier leaks through the business payload | Use a strict identity-free action allowlist |
| Debug logs leak proofs or credential material | Allowlist event fields and add automated log and database scans |
| UI counters hide backend inconsistency | Derive all evidence from persisted records and action results |
| Retry recognition is mistaken for holder tracking | Explain that the nullifier links only one allowed use and its retries |
| The project feels abstract | Use a concrete three-pass redemption story and a visible protocol timeline |
| The team overclaims production anonymity | Display a clear assumptions and non-goals panel |

---

## 32. Delivery plan

The milestones below group work by outcome; phases.md is the authoritative order and gate schedule. Phase 9 robustness starts only after G8, and P2 does not begin during the hackathon.

### Milestone 1: correctness skeleton

- Define policy, adapter interfaces, canonical scope, intent digest, and database migrations.
- Implement issuer simulation and wallet persistence.
- Add happy-path verification and atomic acceptance.

### Milestone 2: idempotency and recovery

- Add retry classification.
- Add transactional outbox and idempotent action simulator.
- Add lost-acknowledgement injection.
- Add over-limit and conflicting-replay cases.

### Milestone 3: evidence and privacy

- Build Demo Lab timeline and verifier evidence panel.
- Add invariant calculator and required pairwise linkability checks; the matrix visualization is optional.
- Add sanitized structured events and forbidden-data scanners.

### Milestone 4: robustness and presentation

- Add concurrent race and worker fault tests.
- Run the golden scenario 100 times.
- Polish the guided demonstration and assumptions panel.
- Record a backup demo video or deterministic replay trace.

---

## 33. Definition of done

The full AnonLimit project is complete when the following criteria pass. A disclosed 24-hour P0 baseline follows the release scope in Section 8 and must not claim that omitted Phase 9 requirements have passed.

- Every P0 requirement is implemented.
- All 14 acceptance criteria pass.
- The golden scenario passes 100 consecutive runs.
- Three distinct allowed uses succeed.
- A lost acknowledgement retry returns the same result with zero extra use or action.
- The over-limit presentation is rejected without state change.
- Concurrent duplicates converge on one result.
- Pairwise linkability checks pass and supply the aggregate evidence; any displayed matrix reflects those results.
- Verifier schema and logs pass the forbidden-data audit.
- The complete guided demo runs in under three minutes.
- The UI clearly labels cryptographic guarantees as supplied by opaque interfaces.
- The final invariant panel is computed from real backend evidence and displays PASS.

---

## 34. Final judge-facing proof

The final screen must establish all of the following without relying on narration:

| Claim | Evidence |
|---|---|
| Exact bound enforced | Three committed distinct uses; fourth rejected |
| Retry is safe | Same use and receipt; usage delta zero |
| External action is not duplicated | Three accepted uses and three unique action keys |
| Invalid attempts consume nothing | Zero ledger and action delta |
| Verifier has no identity | Schema and storage audit pass |
| Legitimate uses are unlinkable | All distinct-use pairs return UNLINKABLE |
| Retry recognition is narrowly scoped | Exact retry alone returns SAME_USE |

The closing statement is:

> Three uses. Three actions. Zero identity. Zero duplicate consumption. No link between legitimate uses.
