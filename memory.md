# AnonLimit project memory

Last updated: 2026-09-06 (Asia/Calcutta).
Project root: repository root.
Current milestone: **Phases 0–10 complete; G10 passed; Apple-inspired frontend and public release complete; evaluation-clarity UI pass and automated-insights extension complete.**
Git branch: `codex/persistent-free-slots`. Earlier phase commits remain in history; check `git status` and `git log -1` for the current revision. The worktree also contains pre-existing `apps/free-slots/` and `tests/unit/free-slots-quota.test.ts` changes; keep them separate from AnonLimit insights work.

This file is the project handoff for future AI sessions. [AGENTS.md](AGENTS.md) requires reading and maintaining it. Current files, Git state, and runtime checks take precedence over historical observations.

## Purpose and locked decisions

AnonLimit demonstrates a credential limited to three uses without storing a holder identity or linking distinct legitimate uses under an opaque simulated crypto contract. The required scenario is: reset, issue, use one, use two with a dropped acknowledgement, retry that operation safely, use three, reject use four, and inspect backend-derived privacy and invariant evidence.

- Node.js 24, strict TypeScript, pnpm workspace, React/Vite, Fastify, PostgreSQL 17, and Docker Compose.
- Four runtime apps: web, API, worker, and an independent Action Simulator. The holder wallet is browser-local IndexedDB.
- The acceptance transaction commits the use, consumed challenge, outbox item, and safe event together. That commit consumes one use.
- Exact retries resolve accepted work before stale policy or challenge checks. They return the prior state or receipt without creating another use, action, outbox row, or wallet slot.
- PostgreSQL uniqueness enforces acceptance; the Action Simulator deduplicates effects by stable action key. UI counters are never authoritative.
- Opaque crypto is a simulation boundary, not production cryptography. Do not add identity counters, credential-wide counters, persisted raw proofs/nullifiers, or fabricated evidence.
- Phase IDs 0–10 are authoritative. P1 begins after G8. P2 is excluded from the hackathon. Phase 9 may be omitted for a minimum 24-hour P0 delivery, but full-project completion requires it. Phase 10 is the final release gate.

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
| 8     | Judge experience / P0 lock    | Complete; G8 passed                            |
| 9     | P1 resilience                 | Complete; G9 full resilience passed            |
| 10    | Release and rehearsal         | Complete; G10 release submission passed        |

Codex is the integration owner. Responsibilities and dependencies are in [the task board](docs/task-board.md). The project is release-ready under the documented simulated-crypto limitations.

## Public frontend release

- The public repository is `https://github.com/rohitk987/anonlimit`.
- The frontend now follows the supplied Apple-inspired visual direction using original AnonLimit branding, a code-native conceptual pass, system typography, parchment and black surfaces, blue pill actions, responsive layouts, visible focus, and reduced-motion support.
- The evaluation-clarity pass keeps that visual direction while shortening the opening, stating the three-view-per-pass scope, adding a live next-action callout and nine-step evaluator route, translating controls into outcome language, and pairing the backend metrics with expected-versus-observed claim cards.
- Stable `data-testid` hooks keep the browser rehearsal resilient while visible labels remain readable for evaluators. A plain-language result card sits alongside the technical protocol state so uncertainty, retry recovery, and fourth-view rejection are immediately understandable.
- Protocol behavior, IndexedDB wallet behavior, backend-derived evidence, accessibility labels, and end-to-end coverage remain intact; the browser rehearsal now targets stable control test IDs while visible labels are evaluator-facing.
- Public documentation now includes a concise README, clean-checkout guide, contribution guide, frontend design contract, threat model, and phase/release records.
- The public-release rehearsal passed formatting, lint, type checks, 309 unit tests, 9 contract tests, 39 integration tests, 24 privacy tests, the production build, 5 Chromium tests, the browser privacy scan, and a configured 10-run concurrency repetition. The rehearsal cleaned up containers and preserved the PostgreSQL volume.

## Implemented system

- Four app shells and seven shared packages with strict TypeScript, explicit exports, dependency-boundary linting, Prettier, Vitest projects, Playwright, and an exact pnpm lockfile.
- Strict contracts cover policy, issuance, challenge, presentation, use/status results, demo faults, safe events/errors, evidence, demo controls, and trusted worker actions.
- Pure domain code implements canonical JSON, the server-controlled quota scope, intent/proof digests, protected lookup/action values, freshness guards, retry/conflict classification, state transitions, and authoritative invariant calculations.
- Simulated browser holder and server issuer/verifier/audit adapters implement the opaque crypto boundary. Browser export checks prevent server adapters from entering the web bundle.
- PostgreSQL keeps verifier and action schemas behind separate login roles. The migration runner uses advisory locking, transactions, ordering, and immutable checksums. The seed creates one active three-use policy and demo run.
- The verifier atomically accepts a valid presentation and creates an outbox item. The leased worker delivers it to the private Action Simulator and atomically stores the stable receipt.
- The React wallet issues one credential, stores it in IndexedDB, submits real presentations, resumes pending results after refresh, and shows only browser-local slot availability.
- The Phase 8 Demo Lab presents reset, issuance, each use, lost acknowledgement, exact retry, controlled fourth-use rejection, and privacy audit controls. Its metrics come from `GET /v1/demo/evidence`; its trace replays strict safe events from `/v1/demo/events/stream`; masked records, invariant statuses, linkability comparisons, and opaque-crypto assumptions share the same responsive page.
- The demo-only boundary probe authenticates an out-of-range simulator presentation through the ordinary verifier and exposes only `PRESENTATION_REJECTED`; no browser credential or raw proof is sent to that endpoint. Seed startup is idempotent after a server-owned reset, and migration 0006 aligns the SQL evidence view's SHA256 mask with API/events.
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
- The complete Phase 7 record is [here](docs/phase-7-evidence-privacy.md). Phase 8 completed the guided Demo Lab, evidence panels, linkability matrix, and P0 browser rehearsal.

## Phase 8 guided Demo Lab and P0 lock

- `apps/web/src/main.tsx` now hosts the responsive Demo Lab. `features/demo-lab/panels.tsx` renders loading, live event, sanitized evidence, invariant, linkability, and assumptions panels. `features/demo-lab/use-evidence.ts` polls the evidence endpoint and replays strict finite SSE batches with run-aware cursors.
- `features/wallet/wallet-service.ts` exposes a transient audit helper that sends only accepted wallet presentations and their exact retry duplicate; the browser retains raw material locally and the server discards it after the audit.
- `POST /v1/demo/attempt-fourth-use` is a demo-only controlled boundary probe. It selects the active server run and policy, constructs an authenticated out-of-range simulator presentation, and submits it through the normal verifier. The public response is the standard rejection with zero deltas.
- `tests/e2e/golden-demo.spec.ts` contains two complete real rehearsals. Each resets the server, drives the browser flow, refreshes the unknown outcome, verifies byte-identical retry, checks direct PostgreSQL ledger counts and receipts, checks sanitized evidence/events for captured raw markers, runs the audit, and checks desktop/mobile width, keyboard activation, and no page errors. The narration is [docs/demo-script.md](docs/demo-script.md).
- Evidence now fails closed when event/ledger coverage is missing, reports `INCOMPLETE` when the audit adapter is unavailable, requires exact retry bytes and `RETRY_MATCHED`, and uses one repeatable-read verifier snapshot. Action completion events carry the same masked use reference as the SQL/API evidence view.

## Phase 9 concurrency and crash recovery

- `packages/testing/src/synchronization-barrier.ts` provides a one-shot barrier that releases the required number of participants together; it is test-only and has no production import path.
- The reusable golden driver accepts `raceThirdUse: true` and submits twenty identical copies of the fresh third-use presentation concurrently. The integration driver requires one new accepted use and nineteen exact pending replays before delivering the one outbox item; all callers converge on the same terminal receipt.
- `tests/integration/outbox-recovery.test.ts` uses two real PostgreSQL worker connections to prove disjoint live leases, deterministic expired-lease takeover, crash recovery before delivery, crash recovery after external commit, bounded backoff, and visible `DEAD_LETTER`/`FAILED_FINAL` exhaustion.
- `scripts/run-concurrency-race.ts`, `pnpm demo:golden:race`, `pnpm test:integration:phase9`, and `pnpm check:phase9` expose the focused race and cumulative Phase 9 gate. The Phase 9 record is [docs/phase-9-resilience.md](docs/phase-9-resilience.md).

### G9 verification observed on 2026-09-06

The Phase 9 golden race and worker recovery matrix passed against real PostgreSQL 17. The focused
`pnpm demo:golden:race` command also passed ten consecutive runs. The existing Action Simulator test
continues to cover same-action-key changed-payload integrity failure. Run the full `pnpm check:phase9`
gate before release. Phase 10 packaging and the final soak are now recorded below; hosted CI execution
has not been observed locally.

## Phase 10 release, packaging, and rehearsal

- `infra/docker/runtime.Dockerfile` pins the Node 24 foundation image by digest. `compose.yaml` pins
  PostgreSQL 17 by digest and keeps only web/API ports on loopback; worker and Action Simulator remain
  private.
- Compose dependency conditions start PostgreSQL, short-lived migration and seed jobs, then API,
  Action Simulator, worker, and web. `scripts/wait-for-services.ts` probes API readiness and the web
  response without logging response bodies.
- `scripts/run-release-soak.ts` runs the synchronized twenty-copy third-use race with a bounded
  `GOLDEN_SOAK_RUNS` value. `scripts/run-release-rehearsal.ts` performs config validation, clean Compose
  restart/build, readiness, the full release gate, the privacy audit, a configurable soak that defaults to 100 runs, and cleanup while preserving the DB
  volume.
- `docs/threat-model.md` records assets, trust boundaries, concurrent duplicate and crash threats,
  privacy limits, and the production work still required beyond the simulated provider.

### G10 verification observed on 2026-09-06

The detached `beb5cc6` worktree installed with `pnpm install --frozen-lockfile` and generated local
configuration successfully. Its fresh project-name volume then passed the clean Compose startup:
migration and seed exited successfully, all five runtime services became healthy, and
`pnpm wait:services` reported `Services ready: api, web`.
`pnpm check:release` passed formatting, lint, strict type checks, 309 unit tests, 9 contract tests, 39
integration tests, 24 privacy tests, the production build, and 5 Playwright tests. The CI repetition
passed 10 race scenarios. The standalone final soak passed 100 out of 100 race scenarios in 42.46s.
The two browser golden rehearsals completed in 9.0s and 7.8s; the complete recovery/browser suite passed
in 25.3s. The release script printed `RELEASE_REHEARSAL_PASSED` and cleaned up containers without
deleting the persistent database volume.

The full release checklist and limitations are in [docs/phase-10-release.md](docs/phase-10-release.md).

### G8 verification observed on 2026-09-06

`pnpm test:e2e`: 5 passed (two Phase 8 rehearsals in 9.2s and 8.0s, plus three wallet recovery regressions) against rebuilt Compose services. `pnpm test:integration`: 33 passed across nine files, including the new boundary integration. `pnpm test:unit`: 309 passed. `pnpm test:contract`: 9 passed. `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, and `pnpm audit:privacy` passed. Docker Compose rebuilt the shared image, applied migration 0006, ran seed successfully after reset, and all five runtime services became healthy. The cumulative Phase 9 gate now includes the synchronized race and worker fault matrix; the completed Phase 10 release record supersedes this earlier snapshot.

## Verification observed on 2026-09-06

| Check                          | Result                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node / pnpm                    | Bundled Node `24.19.0`; pnpm `11.19.0`                                                                                                                        |
| Docker / Compose               | Engine `29.2.1`; Compose `5.0.2`; responsive                                                                                                                  |
| Compose runtime                | API, web, worker, Action Simulator, and PostgreSQL healthy; migration 0006 and seed exited 0 after reset                                                      |
| `pnpm check:phase7`            | Passed formatting, lint, strict type checks, builds, 297 unit, 9 contract, 30 cumulative phase-gate integration, 24 privacy tests, and browser asset scan     |
| `pnpm test:integration`        | 32 passed, including isolated PostgreSQL scenarios and two live Compose role/readiness checks                                                                 |
| `pnpm test:e2e`                | 5 passed: two complete Phase 8 rehearsals plus durable lost-ack recovery, stored resend, and expired-unaccepted proof rebuild                                 |
| `pnpm test:integration:phase9` | 11 passed: synchronized golden race, worker lease/crash matrix, and action-key integrity checks                                                               |
| Fresh detached checkout        | Frozen install, generated environment, config validation, and empty-volume cold start passed                                                                  |
| `pnpm check:release`           | Passed formatting, lint, types, 309 unit, 9 contract, 39 integration, 24 privacy, build, and 5 browser tests                                                  |
| `pnpm demo:golden:race`        | 10 consecutive focused race runs passed                                                                                                                       |
| `pnpm demo:golden:soak`        | 100 consecutive synchronized race scenarios passed in 42.46s                                                                                                  |
| `pnpm release:rehearsal`       | Clean rebuild, readiness, full release gate, privacy audit, configured soak, and cleanup passed                                                               |
| Existing-volume migration      | `0003` and `0004` applied with matching checksums; subsequent migration startup passed                                                                        |
| Retry invariant                | Before/after retry: uses 1, outbox rows 1, external actions 1, distinct receipts 1; original receipt returned                                                 |
| Runtime privacy                | Privacy suite passed all 24 source, bundle, schema, serialization, logging, and secret-exclusion checks                                                       |
| Phase 6 golden scenario        | Passed twice: three durable uses, lost-ack exact retry, authenticated slot-3 rejection, and scoped reset                                                      |
| Phase 7/8 integration          | 33 passed, including sanitized evidence/view, safe SSE cursor, API boundary, and real authenticated fourth-use rejection                                      |
| Hosted CI                      | Passed at `39c7389` in run `34020903971`; bootstrap, quality gates, Docker startup, live checks, privacy, browser tests, and cleanup succeeded; soak skipped. |

The immutable verifier migration digests in the persistent database are:

```text
0003-lost-ack-fault.sql          94bcca9b117e18e81a36822be0c6c5802bedd5f1d59562e88de3168e95bf4038
0004-fault-target-integrity.sql  387f303c57325e8036306e87a7395e4b5697442036bda7a7f75590382dceab53
```

`0003` was first applied with a trailing blank line. Its bytes are intentionally preserved, and `.gitattributes` disables only Git's blank-at-EOF warning for that immutable file.

G5 certifies one durable lost acknowledgement and exact recovery with retry usage delta 0, retry action delta 0, the original receipt, no new outbox item, and no additional wallet slot. G6 certifies all three uses, the fourth-use rejection, and the server-owned reset. G7 certifies the backend-derived evidence boundary and privacy scan. G8 certifies the responsive browser flow and real all-PASS evidence rehearsal. G9 certifies the synchronized presentation race and worker recovery matrix. G10 certifies the pinned release, clean startup, full quality gate, ten-run CI repetition, and 100-run final soak.

## Local setup and Docker recovery

The tool's default directory may differ from the checkout. Resolve the repository root before running commands. System PATH may select an incompatible Node version. For the recorded Windows development environment:

```powershell
$repositoryRoot = git rev-parse --show-toplevel
Set-Location $repositoryRoot
$taskNodeBin = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
$env:Path = "$taskNodeBin;$env:Path"
node --version
pnpm --version
& '.\scripts\start-docker-desktop.ps1'
```

Use the existing `.env` with its existing PostgreSQL volume. Initial role/password bootstrap runs only on an empty volume. Never use a factory reset or volume deletion as routine repair.

```powershell
pnpm install --frozen-lockfile
docker compose build api
docker compose up -d --no-build --wait --wait-timeout 120
pnpm wait:services
pnpm check:release
pnpm audit:privacy
pnpm test:integration
pnpm test:e2e
```

For a fresh checkout without `.env`, first run `pnpm setup:env`. Install Chromium with `pnpm exec playwright install chromium` on a new test machine. Use `docker compose config --quiet`; a full interpolated config prints secrets.

Docker Desktop 4.62.0 has a machine-specific direct-launch failure around the AppData `dockerInference`/socket path. Use `scripts/start-docker-desktop.ps1`, which launches through Windows Explorer. On 2026-09-05 an interrupted multi-service image export filled C: and produced the same startup dialog. The repair stopped stale Docker processes, moved disposable temporary caches to ignored `.cache/docker-recovery-20260905`, restarted through the helper, and ran `docker builder prune --all --force`, which removed 14.93 GB of unused BuildKit cache. The database volume was preserved.

C: had about 972 MB free after the repair. Docker's approximately 35.3 GB WSL data VHD had not compacted at the Windows layer. Keep build cache pruned and consider moving Docker Desktop's disk image location to D: before another large image build. Do not restore the moved temporary caches while C: remains constrained.

Only web 5173 and API 4000 are published to `127.0.0.1`. Use [localhost:5173](http://localhost:5173) so the origin matches CORS. `pnpm dev` starts Compose in the foreground. Optional `pnpm dev:apps` needs separately supplied host-reachable environment values.

TypeScript 6.0.3 and Vitest 4.1.11 are deliberate compatibility pins. Keep strict declaration checks enabled. Double-quoted pnpm workspace filters are required on Windows. Vite preview uses `--configLoader native` for the non-root container user. The two Zod/Rollup annotation messages are upstream build warnings; the build passes.

## Evaluation-friendly UI pass — 2026-09-06

Changed the web Demo Lab without changing protocol behavior:

- `apps/web/src/main.tsx` now opens with a compact evaluation summary, states the three-view-per-pass scope, highlights the next required action, shows the complete nine-step path, adds plain-language result copy, and gives every control a short explanation.
- `apps/web/src/features/demo-lab/panels.tsx` now labels backend evidence as claim verification, adds expected-versus-observed proof cards, explains the sanitized records, and renders incomplete statuses as actionable guidance.
- `apps/web/src/style.css` adds the evaluation-first layout, responsive step grid, callout styling, and proof scoreboard while preserving the Apple-inspired palette and accessibility focus states.
- `tests/e2e/golden-demo.spec.ts` uses stable control test IDs so evaluator-facing button wording can remain readable.
- `docs/demo-script.md`, `docs/getting-started.md`, `docs/phase-5-safe-retry.md`, and `docs/frontend-design.md` now match the visible labels and guided route.

Checks observed for this pass:

- `pnpm --filter @anonlimit/web build` passed.
- `pnpm --filter @anonlimit/web typecheck` passed.
- `pnpm exec tsc -p tsconfig.tooling.json --noEmit` passed.
- `pnpm lint` passed.
- Scoped Prettier check for all changed frontend, test, and documentation files passed.
- `pnpm test:unit` passed: 17 files, 316 tests.
- `git diff --check` passed.
- The full repository `pnpm format:check` remains blocked by the pre-existing untracked `apps/free-slots/src/quota-store.ts` formatting warning; that file was not part of this UI change.
- Live Playwright verification was not run because Docker Desktop's Linux engine pipe was unavailable (`docker compose ps` could not connect). No soak test was run.

## Automated insights extension — 2026-09-06

Added the user-requested automatic audit summary and privacy-safe aggregate abuse signals:

- `GET /v1/demo/insights` reads the same server-owned verifier snapshot and independent Action Simulator evidence as `GET /v1/demo/evidence`. It accepts no client-selected run, is demo-only, returns `no-store`, and exposes strict `InsightsReport` contracts.
- `apps/api/src/modules/insights/analyze.ts` derives five factual summary findings and a rolling 60-second, run-scoped activity report. It counts persisted decision events once per trace, keeps accepted/rejected/conflict/retry/over-limit counters disjoint, filters stale/future/other-run events, and never persists or returns trace/use/receipt/nullifier/proof data. Signals are advisory and cannot alter acceptance, quota, or identity state.
- `apps/api/src/modules/insights/ai-narrator.ts` provides optional server-only OpenAI Responses API commentary. It is disabled by default, sends only allowlisted aggregate counts/statuses, uses `store:false`, strict JSON output, an 8-second timeout, 32 KiB response cap, one in-flight request, and bounded in-memory caching/call limits. Provider failures preserve factual evidence as `UNAVAILABLE` and never expose provider bodies.
- `apps/web/src/features/demo-lab/insights-panel.tsx` and `use-insights.ts` add independently polled, run-aware summary, signal, and optional-AI panels. Reset, stale run IDs, request errors, and unavailability hide old results. The browser sends no wallet, proof, identity, or telemetry to the insight route.
- `docs/automated-insights.md` documents the data boundary, thresholds, configuration, limitations, and validation. `.env.example` and Compose include opt-in AI configuration without a key.

Checks observed for this extension:

- `pnpm typecheck` passed.
- `pnpm lint` passed.
- Unit, contract, and privacy projects passed: 23 files, 376 tests.
- `pnpm test:integration` passed: 10 files, 39 tests.
- `pnpm --filter @anonlimit/web build` passed; API image build passed.
- `pnpm test:e2e` passed: 5 browser rehearsals, including insight reset and unavailable-state coverage.
- `pnpm audit:privacy` passed with zero findings; `git diff --check` passed.
- `pnpm format:check` still reports only the pre-existing untracked `apps/free-slots/src/quota-store.ts` formatting issue. No soak test was run, per user instruction.
- Docker Compose services remain healthy; `http://localhost:5173` serves the rebuilt UI and `/v1/demo/insights` responds with local `rules-v1` analysis and `ai: DISABLED` under the current configuration.

## GitHub Actions bootstrap repair — 2026-09-06

- Confirmed the reported failure in hosted run `34012662156` at revision `95d45d2`: Node setup failed before pnpm installation, and unconditional Compose cleanup failed after environment generation was skipped.
- `.github/workflows/ci.yml` disables automatic package-manager caching while installing Node.js 24, then installs the pnpm version pinned in `package.json`. Compose cleanup requires successful configuration validation and still runs after a later build/startup/test failure.
- The ten-scenario soak is now explicitly opt-in with the manual `workflow_dispatch` input `run_soak`, defaulting to false. Pushes and pull requests skip the soak, honoring the user's instruction. Normal unit, integration, concurrency, privacy, and browser gates remain enabled.
- `docs/phase-10-release.md` documents setup order, cleanup behavior, and manual soak selection. Revision `355b052` fixed bootstrap: hosted run `34020518954` passed Node/pnpm setup, frozen install, the cumulative Phase 9 gate, configuration validation, and the Docker build. It then exposed an API cold-start failure; guarded cleanup succeeded and the soak was skipped.
- Reproduced the issuer-file access problem in an isolated Linux container with synthetic data: a `0600` file owned by UID 1001 is unreadable to runtime UID 1000; changing its owner restores access without widening permissions. Revision `39c7389` determines the built image's runtime UID, assigns only the two generated issuer files to it, and performs a content-free readability check before Compose startup. `docs/getting-started.md` explains the Linux repair and host ownership implications.
- Local validation passed: checksum-verified actionlint `1.7.12`, scoped Prettier, `git diff --check`, and the isolated Linux permission reproduction.
- [Hosted run `34020903971`](https://github.com/rohitk987/anonlimit/actions/runs/34020903971) passed at fix revision `39c7389`: Node/pnpm bootstrap, frozen install, cumulative Phase 9 quality gate, Docker build, issuer readability preflight, Compose cold start, API/web readiness, live role checks, boundary integration, privacy audit, Chromium installation, browser tests, and cleanup. The optional soak step was skipped. This continuity update changes only documentation after that successful run.
- The pre-existing local free-slots work and lockfile edits remain separate. No soak was requested or run for this repair.

## Submission privacy audit — 2026-09-06

- Public `main` is at `0fd6f97` before this audit, is not a fork, and is visible at [github.com/rohitk987/anonlimit](https://github.com/rohitk987/anonlimit). The latest hosted workflow passed all configured checks; the optional soak was skipped.
- Reachable history contains 19 commits and no tracked `.env`, secret directory, private-key/certificate file, database dump, log, screenshot, archive, or browser-state artifact. The only environment file is the placeholder `.env.example`.
- Checksum-verified Gitleaks `8.30.1` scanned all reachable commits with redaction. Its one alert was manually reviewed as a false positive in architecture prose; `.gitleaksignore` records only that exact fingerprint and why it is safe to ignore. A second credential-pattern scan found no provider-key or private-key markers.
- The repository's GitHub secret-scanning alerts endpoint reports zero open alerts and push protection is enabled. Dependabot alert details are unavailable through the current API permission; no dependency alert state is claimed here.
- Removed development-machine absolute paths from `docs/phase-0-kickoff.md` and aligned README/CONTRIBUTING soak instructions with the workflow's manual opt-in behavior.
- Existing published commit metadata uses the author identity configured when the project was developed. It is not application data or a credential, but removing it would require a history rewrite and force push; no such destructive rewrite was performed automatically.

## Next step

Maintain the public release baseline. Future changes must rerun `pnpm check:release` and the privacy
audit. The concurrency soak remains opt-in and must not be run without a new user request. AI commentary
requires an operator-supplied server key and model; no live paid model call has been made.

## Recent milestones

| Date       | Milestone                                       | Outcome                                 |
| ---------- | ----------------------------------------------- | --------------------------------------- |
| 2026-09-06 | Public frontend and documentation released      | Apple-inspired interface verified       |
| 2026-09-06 | Phase 10 release and rehearsal completed        | G10 release submission passed           |
| 2026-09-06 | Phase 9 resilience implemented                  | G9 full resilience passed               |
| 2026-09-06 | Phase 7 evidence and privacy implemented        | G7 Evidence P0 passed; Phase 8 followed |
| 2026-09-05 | Phase 6 bound, rejection, and reset implemented | G6 Backend P0 passed                    |
| 2026-09-05 | Phase 5 safe retry implemented and verified     | G5 passed; Phase 6 next                 |
| 2026-09-05 | Docker low-disk/startup incident repaired       | Engine and Compose stack healthy        |
| 2026-09-05 | Phase 4 first complete use implemented          | G4 passed                               |
| 2026-09-05 | Phase 3 durable acceptance implemented          | G3 passed                               |
| 2026-09-05 | Phase 2 protocol kernel implemented             | G2 passed                               |
| 2026-09-05 | Phase 1 runtime foundation implemented          | G1 passed                               |
| 2026-09-05 | Memory and AI continuity instructions created   | Future sessions maintain current state  |
| 2026-09-05 | Scope, ownership, and source alignment locked   | Eleven-phase plan established           |
