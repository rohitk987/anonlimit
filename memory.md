# AnonLimit project memory

Last updated: 2026-09-06 (Asia/Calcutta).
Project root: `D:/myonsite`.
Current milestone: **Phases 0–7 complete; G7 Evidence P0 passed. Phase 8 is next.**
Git branch: `codex/phase-2-protocol`. Phase 6 is committed at `08ce904` (`feat: complete phase 6 bound reset`); the Phase 7 implementation and handoff are recorded in the current change. Check `git status` and `git log -1` for the current revision.

This file is the project handoff for future AI sessions. [AGENTS.md](AGENTS.md) requires reading and maintaining it. Current files, Git state, and runtime checks take precedence over historical observations.

## Purpose and locked decisions

AnonLimit demonstrates a credential limited to three uses without storing a holder identity or linking distinct legitimate uses under an opaque simulated crypto contract. The required scenario is: reset, issue, use one, use two with a dropped acknowledgement, retry that operation safely, use three, reject use four, and inspect backend-derived privacy and invariant evidence.

- Node.js 24, strict TypeScript, pnpm workspace, React/Vite, Fastify, PostgreSQL 17, and Docker Compose.
- Four runtime apps: web, API, worker, and an independent Action Simulator. The holder wallet is browser-local IndexedDB.
- The acceptance transaction commits the use, consumed challenge, outbox item, and safe event together. That commit consumes one use.
- Exact retries resolve accepted work before stale policy or challenge checks. They return the prior state or receipt without creating another use, action, outbox row, or wallet slot.
- PostgreSQL uniqueness enforces acceptance; the Action Simulator deduplicates effects by stable action key. UI counters are never authoritative.
- Opaque crypto is a simulation boundary, not production cryptography. Do not add identity counters, credential-wide counters, persisted raw proofs/nullifiers, or fabricated evidence.
- Phase IDs 0–10 are authoritative. P1 begins after G8. P2 is excluded from the hackathon. Phase 9 may be omitted for a minimum 24-hour P0 delivery, but full-project completion requires it. Phase 10 remains required.

Detailed policy and kickoff decisions: [Phase 0 record](docs/phase-0-kickoff.md). Product and engineering specifications: [prd.md](prd.md), [architecture.md](architecture.md), [rules.md](rules.md), [phases.md](phases.md).

## Progress

| Phase | Milestone                     | Status                                         |
| ----- | ----------------------------- | ---------------------------------------------- |
| 0     | Kickoff and scope lock        | Complete; prerequisites and decisions verified |
| 1     | Repository/runtime foundation | Complete; G1 passed                            |
| 2     | Protocol kernel               | Complete; G2 passed                            |
| 3     | Durable acceptance            | Complete; G3 passed                            |
| 4     | First complete use            | Complete; G4 passed                            |
| 5     | Safe retry                    | Complete; G5 passed                            |
| 6     | Bound and rejection           | Complete; G6 Backend P0 passed                 |
| 7     | Evidence and privacy          | Complete; G7 Evidence P0 passed                |
| 8     | Judge experience / P0 lock    | Not started                                    |
| 9     | P1 resilience                 | Deferred until G8; required for full project   |
| 10    | Release and rehearsal         | Not started                                    |

Codex is the integration owner. Responsibilities and dependencies are in [the task board](docs/task-board.md). Phase 8 is the next implementation slice.

## Implemented system

- Four app shells and seven shared packages with strict TypeScript, explicit exports, dependency-boundary linting, Prettier, Vitest projects, Playwright, and an exact pnpm lockfile.
- Strict contracts cover policy, issuance, challenge, presentation, use/status results, demo faults, safe events/errors, evidence, demo controls, and trusted worker actions.
- Pure domain code implements canonical JSON, the server-controlled quota scope, intent/proof digests, protected lookup/action values, freshness guards, retry/conflict classification, state transitions, and authoritative invariant calculations.
- Simulated browser holder and server issuer/verifier/audit adapters implement the opaque crypto boundary. Browser export checks prevent server adapters from entering the web bundle.
- PostgreSQL keeps verifier and action schemas behind separate login roles. The migration runner uses advisory locking, transactions, ordering, and immutable checksums. The seed creates one active three-use policy and demo run.
- The verifier atomically accepts a valid presentation and creates an outbox item. The leased worker delivers it to the private Action Simulator and atomically stores the stable receipt.
- The React wallet issues one credential, stores it in IndexedDB, submits real presentations, resumes pending results after refresh, and shows only browser-local slot availability.
- Safe serializers and logging allowlists exclude arbitrary fields, proofs, nullifiers, credential material, request paths/query strings, authorization values, and browser identity.

## Phase 5 safe retry

- `POST /v1/demo/faults/drop-next-ack` exists only when `DEMO_MODE=true`. It arms one active-run/operation target.
- Verifier migrations `0003-lost-ack-fault.sql` and `0004-fault-target-integrity.sql` add the target columns, run foreign key, and integrity rule requiring an enabled drop fault to be one-shot and fully targeted.
- The API waits without holding a transaction until the accepted use is `SUCCEEDED`, its cached receipt exists, and its outbox row is delivered. It then disables the fault and writes `ACK_DROPPED` atomically before ending a deliberately incomplete HTTP acknowledgement.
- If the bounded wait expires, the action fails finally, status lookup fails, or guarded fault consumption loses its race, the API cancels the target. Timeout/non-success paths return a recoverable `SERVICE_UNAVAILABLE` instead of a misleading normal acknowledgement.
- Exact replays produce `RETRY_MATCHED`, then `RETRY_IN_PROGRESS` or `RETRY_RESOLVED`; resolved receipts also produce `CACHED_RECEIPT_RETURNED`. Retry deltas stay zero.
- The wallet saves the exact serialized request before the first send. Transport errors, incomplete success bodies, server errors, and receipt timeouts retain it as `OUTCOME_UNKNOWN` without advancing the slot.
- Local-only credential and demo-run bindings prevent a stale operation from advancing a different browser credential. Terminal accepted state and slot retirement commit in one IndexedDB transaction, including `FAILED_FINAL`.
- `Retry last request` first resends the stored bytes. A resend can validly be the first request accepted. If the request was never accepted and its challenge has expired, the wallet creates a fresh challenge/proof for the same operation, action, intent, nullifier, and hidden slot, persists the replacement body, and submits it without allocating another slot.
- Browser startup preserves unknown outcomes, reconciles a prior terminal/local-write interruption, and exposes retry progress. Definitive pre-commit rejection releases the unresolved-operation lock and retains the slot.

Detailed Phase 5 behavior and evidence: [Phase 5 record](docs/phase-5-safe-retry.md).

## Phase 6 exact bound, rejection, and reset

- The simulated issuer seals each hidden slot index in the provider ticket. The normal credential still has exactly three slots; the test-only `createSimulatedBoundTestAdapter` can build an authenticated boundary slot at index 3.
- The demo-enabled verifier returns the private in-memory diagnostic `BOUND_EXCEEDED` only after authenticating that sealed ticket. The protocol service and public error schema always return `PRESENTATION_REJECTED`, with zero deltas and no persisted proof, slot, credential, or raw nullifier.
- `POST /v1/demo/reset` accepts exactly `{}` and selects the active run on the server. It fences the selected Action Simulator run through the bearer-protected internal reset API, deletes only the selected verifier run’s challenges, uses, outbox rows, events, and fault target, then inserts a fresh active run and `DEMO_RESET` event.
- The Action Simulator stores a run tombstone under a PostgreSQL advisory lock, deletes that run’s action results, and rejects later commits for the tombstoned run with `DEMO_RUN_RESET`. Replaying its reset returns the original timestamp and does not affect other runs.
- The browser reset calls the server first and clears the credential and operations IndexedDB stores only after the response passes `demoResetResponseSchema`. Failed reset or storage operations leave the local wallet intact.
- `packages/testing/src/scenarios/golden-scenario.ts` is transport-neutral and asserts backend counts after every step. The real Phase 6 integration runs it twice with deterministic clock/UUID/randomness, durable lost-ack delivery, the controlled boundary proof, and an unrelated sentinel run.
- Phase 6 evidence is recorded in [the Phase 6 record](docs/phase-6-bound-reset.md). G6 passed: declared limit 3, three accepted uses, three committed actions, zero retry deltas, zero over-limit mutations, and stable receipts.

## Phase 7 authoritative evidence and privacy

- `verifier.evidence_uses` and `verifier.evidence_events` are sanitized database views. The verifier evidence query boundary scopes every read to the active server-owned demo run and exposes only masked use references, intent digests, states, stable action keys, receipts, safe events, and privacy column counts.
- `GET /internal/v1/evidence?demoRunId=...` returns strict run-scoped Action Simulator receipts. `GET /v1/demo/evidence` joins that response with verifier state and calculates all invariant checks; no frontend counter is authoritative.
- Issuance, rejection, conflict, retry, worker, reset, and privacy-audit transitions use an allowlisted protocol event schema. `GET /v1/demo/events/stream` emits finite safe replay batches and accepts either `after` or `Last-Event-ID` cursors.
- `POST /v1/demo/linkability-test` validates transient wallet presentations against the active run and accepted uses, compares every distinct-use pair as `UNLINKABLE`, and compares an exact duplicate as `SAME_USE`. Raw presentations and grouping labels are discarded after the request. Missing audit support produces `INCOMPLETE`, never PASS.
- `packages/testing/src/scanners/forbidden-data.ts` scans structured rows, logs, events, outbox payloads, API/evidence objects, exports, and imports without printing secret values. `pnpm audit:privacy` scans the generated browser asset for local secret markers; protocol field names required by holder-only code are not treated as leaked values.
- The complete Phase 7 record is [here](docs/phase-7-evidence-privacy.md). Phase 8 now owns the guided Demo Lab, evidence panels, linkability matrix, and P0 browser rehearsal.

## Verification observed on 2026-09-06

| Check                     | Result                                                                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node / pnpm               | Bundled Node `24.19.0`; pnpm `11.19.0`                                                                                                                    |
| Docker / Compose          | Engine `29.2.1`; Compose `5.0.2`; responsive                                                                                                              |
| Compose runtime           | API, web, worker, Action Simulator, and PostgreSQL healthy; migration and seed exited 0                                                                   |
| `pnpm check:phase7`       | Passed formatting, lint, strict type checks, builds, 297 unit, 9 contract, 30 cumulative phase-gate integration, 24 privacy tests, and browser asset scan |
| `pnpm test:integration`   | 32 passed, including isolated PostgreSQL scenarios and two live Compose role/readiness checks                                                             |
| `pnpm test:e2e`           | 3 passed: durable lost-ack recovery, stored resend as first arrival, and expired-unaccepted proof rebuild                                                 |
| Existing-volume migration | `0003` and `0004` applied with matching checksums; subsequent migration startup passed                                                                    |
| Retry invariant           | Before/after retry: uses 1, outbox rows 1, external actions 1, distinct receipts 1; original receipt returned                                             |
| Runtime privacy           | Privacy suite passed all 24 source, bundle, schema, serialization, logging, and secret-exclusion checks                                                   |
| Phase 6 golden scenario   | Passed twice: three durable uses, lost-ack exact retry, authenticated slot-3 rejection, and scoped reset                                                  |
| Phase 7 integration       | Passed sanitized-view, run-scoped Action Simulator evidence, safe SSE cursor, and API boundary tests (3 tests)                                            |
| Hosted CI                 | Phase 7 workflow configured; hosted execution has not been observed                                                                                       |

The immutable verifier migration digests in the persistent database are:

```text
0003-lost-ack-fault.sql          94bcca9b117e18e81a36822be0c6c5802bedd5f1d59562e88de3168e95bf4038
0004-fault-target-integrity.sql  387f303c57325e8036306e87a7395e4b5697442036bda7a7f75590382dceab53
```

`0003` was first applied with a trailing blank line. Its bytes are intentionally preserved, and `.gitattributes` disables only Git's blank-at-EOF warning for that immutable file.

G5 certifies one durable lost acknowledgement and exact recovery with retry usage delta 0, retry action delta 0, the original receipt, no new outbox item, and no additional wallet slot. G6 now certifies all three uses, the fourth-use rejection, and the server-owned reset. G7 certifies the backend-derived evidence boundary and privacy scan; the guided UI and release rehearsal remain later phases.

## Local setup and Docker recovery

The tool's default directory may be a OneDrive folder. Always work in `D:/myonsite`. System PATH initially selects incompatible Node 26.7.0. For this machine:

```powershell
Set-Location D:/myonsite
$taskNodeBin = 'C:\Users\rohit\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
$env:Path = "$taskNodeBin;$env:Path"
node --version
pnpm --version
& 'D:\myonsite\scripts\start-docker-desktop.ps1'
```

Use the existing `.env` with its existing PostgreSQL volume. Initial role/password bootstrap runs only on an empty volume. Never use a factory reset or volume deletion as routine repair.

```powershell
pnpm install --frozen-lockfile
docker compose build api
docker compose up -d --no-build --wait --wait-timeout 120
pnpm check:phase7
pnpm audit:privacy
pnpm test:integration
pnpm test:e2e
```

For a fresh checkout without `.env`, first run `pnpm setup:env`. Install Chromium with `pnpm exec playwright install chromium` on a new test machine. Use `docker compose config --quiet`; a full interpolated config prints secrets.

Docker Desktop 4.62.0 has a machine-specific direct-launch failure around the AppData `dockerInference`/socket path. Use `scripts/start-docker-desktop.ps1`, which launches through Windows Explorer. On 2026-09-05 an interrupted multi-service image export filled C: and produced the same startup dialog. The repair stopped stale Docker processes, moved disposable temporary caches to ignored `.cache/docker-recovery-20260905`, restarted through the helper, and ran `docker builder prune --all --force`, which removed 14.93 GB of unused BuildKit cache. The database volume was preserved.

C: had about 972 MB free after the repair. Docker's approximately 35.3 GB WSL data VHD had not compacted at the Windows layer. Keep build cache pruned and consider moving Docker Desktop's disk image location to D: before another large image build. Do not restore the moved temporary caches while C: remains constrained.

Only web 5173 and API 4000 are published to `127.0.0.1`. Use [localhost:5173](http://localhost:5173) so the origin matches CORS. `pnpm dev` starts Compose in the foreground. Optional `pnpm dev:apps` needs separately supplied host-reachable environment values.

TypeScript 6.0.3 and Vitest 4.1.11 are deliberate compatibility pins. Keep strict declaration checks enabled. Double-quoted pnpm workspace filters are required on Windows. Vite preview uses `--configLoader native` for the non-root container user. The two Zod/Rollup annotation messages are upstream build warnings; the build passes.

## Next step

Continue with **Phase 8 — guided judge experience and P0 lock** from [phases.md](phases.md):

1. Connect the Demo Lab metrics to `GET /v1/demo/evidence`.
2. Render the safe event stream with reconnect cursors and distinct retry/rejection states.
3. Present the transient linkability matrix, privacy assumptions, and all-PASS invariant panel in the rehearsed browser flow.

## Recent milestones

| Date       | Milestone                                       | Outcome                                |
| ---------- | ----------------------------------------------- | -------------------------------------- |
| 2026-09-06 | Phase 7 evidence and privacy implemented        | G7 Evidence P0 passed; Phase 8 next    |
| 2026-09-05 | Phase 6 bound, rejection, and reset implemented | G6 Backend P0 passed                   |
| 2026-09-05 | Phase 5 safe retry implemented and verified     | G5 passed; Phase 6 next                |
| 2026-09-05 | Docker low-disk/startup incident repaired       | Engine and Compose stack healthy       |
| 2026-09-05 | Phase 4 first complete use implemented          | G4 passed                              |
| 2026-09-05 | Phase 3 durable acceptance implemented          | G3 passed                              |
| 2026-09-05 | Phase 2 protocol kernel implemented             | G2 passed                              |
| 2026-09-05 | Phase 1 runtime foundation implemented          | G1 passed                              |
| 2026-09-05 | Memory and AI continuity instructions created   | Future sessions maintain current state |
| 2026-09-05 | Scope, ownership, and source alignment locked   | Eleven-phase plan established          |
