# AnonLimit project memory

Last updated: 2026-09-05 (Asia/Calcutta).
Project root: `D:/myonsite`.
Current milestone: **Phases 0–4 complete; G4 First complete use passed. Phase 5 is next.**
Git branch: `codex/phase-2-protocol`. Phase 4 implementation is committed at `adb27e5` (`feat: complete phase 4 first complete use`); this memory update is the follow-up documentation commit. Check `git status` and `git log -1` for the actual revision.

This is the project handoff for future AI sessions. [AGENTS.md](AGENTS.md) requires reading and maintaining it. Current files and runtime checks take precedence over historical observations.

## Purpose and locked decisions

AnonLimit will demonstrate a credential limited to three uses without storing a holder identity or linking distinct legitimate uses under an opaque simulated crypto contract. The required scenario is: reset, issue, use one, use two with a dropped acknowledgement, retry the exact operation, use three, reject use four, and inspect backend-derived privacy and invariant evidence.

- Node.js 24, strict TypeScript, pnpm workspace, React/Vite, Fastify, PostgreSQL 17, and Docker Compose.
- Four runtime apps: web, API, worker, independent Action Simulator. Planned wallet state is browser-local IndexedDB.
- An acceptance transaction commits the use, consumed challenge, outbox item, and safe event together. That commit consumes one use.
- Exact retries preserve operation/intent and recover the original result with zero extra uses/actions. Resolve accepted work before rejecting stale challenge/policy information.
- PostgreSQL uniqueness will enforce acceptance; the Action Simulator will deduplicate effects by stable action key. UI counters are never authoritative.
- Opaque crypto is a simulation boundary, not production cryptography. No identity/credential-wide counters, persisted raw proofs/nullifiers, or fabricated evidence.
- Phase IDs 0–10 are authoritative. P1 begins after G8; P2 is excluded from the hackathon. Phase 9 may be omitted for a minimum 24-hour P0 delivery, but full-project completion requires its resilience checks. Phase 10 remains required.

Detailed policy and kickoff decisions: [Phase 0 record](docs/phase-0-kickoff.md). Product and engineering specifications: [prd.md](prd.md), [architecture.md](architecture.md), [rules.md](rules.md), [phases.md](phases.md).

## Progress

| Phase | Milestone                     | Status                                         |
| ----- | ----------------------------- | ---------------------------------------------- |
| 0     | Kickoff and scope lock        | Complete; prerequisites and decisions verified |
| 1     | Repository/runtime foundation | Complete; G1 passed                            |
| 2     | Protocol kernel               | Complete; G2 passed                            |
| 3     | Durable acceptance            | Complete; G3 passed                            |
| 4     | First complete use            | Complete; G4 passed                            |
| 5     | Safe retry                    | Not started                                    |
| 6     | Bound and rejection           | Not started                                    |
| 7     | Evidence and privacy          | Not started                                    |
| 8     | Judge experience / P0 lock    | Not started                                    |
| 9     | P1 resilience                 | Deferred until G8; required for full project   |
| 10    | Release and rehearsal         | Not started                                    |

Codex is the integration owner. Responsibilities and dependencies are in [the task board](docs/task-board.md). Phase 4 is complete; Phase 5 is the next implementation slice.

## Implemented foundation

- Four app shells and seven shared packages; strict TS, exact dependency lockfile, explicit export maps, ESLint trust boundaries, formatting, Vitest projects, and Playwright.
- API exposes strict policy, issuance, challenge, presentation, and use-status routes backed by actual database readiness. The private Action Simulator commits idempotent actions and the worker leases/delivers outbox work.
- React holder wallet at [localhost:5173](http://localhost:5173) issues a pass, stores it in IndexedDB, performs one real use, polls for a receipt, and resumes pending work after refresh.
- Separate validated browser/server configuration. `pnpm setup:env` generated an ignored local `.env`; never print or overwrite it casually.
- Safe logging facade discards arbitrary messages and fields, including nested child bindings. Browser/server/test imports and direct application environment reads are restricted.
- PostgreSQL 17 Compose stack with separate verifier/action schemas and login roles; loopback web/API ports only. The migration job owns bootstrap role setup, uses locking, checksums, ordering and transactions, and applies product tables plus worker policy references. The idempotent seed creates one active three-use policy and demo run.
- CI workflow for the Phase 3 gate exists in `.github/workflows/ci.yml`. Its hosted execution has not been observed.
- README, phase board, [Phase 4 record](docs/phase-4-first-complete-use.md), [durable acceptance record](docs/phase-3-durable-acceptance.md), and [foundation record](docs/phase-1-foundation.md) describe setup, checks, boundaries, and limitations.

## Implemented protocol kernel

- Strict Zod contracts cover policy, issuance, challenge, presentation, identity-free action, use/receipt results, safe events/errors, evidence, demo controls, and trusted worker actions. Wire schemas reject unknown fields and share UUID/timestamp acceptance vectors with the domain.
- Pure domain code implements canonical JSON, the five-field server-controlled quota scope, policy/scope/intent/proof digests, separately keyed persistent lookup/action values, injected-clock freshness guards, exhaustive state transitions, exact-retry/conflict classification, terminal result preservation, and authoritative invariant calculations.
- Evidence stays `NOT_RUN` when an observation is unavailable. Complete passes require receipt ownership and uniqueness, stable recovered receipts, one fixed scope/issuance, mutation-free retries/rejections, full distinct-use audit pairs, and one same-use retry comparison.
- Separate crypto entrypoints implement a simulated browser holder, server issuer/verifier, and assumption-backed audit adapter. The issuer creates exactly `maxUses` sealed per-slot capabilities; proofs bind policy, scope, active run, challenge, operation, action, and intent. Browser export conditions block every server adapter.
- Safe protocol serializers select only reviewed fields without spreading unknown objects or invoking accessors. Adversarial tests cover malformed and mutated contexts, credentials, tickets, proofs, slots, outputs, and browser boundaries.
- `pnpm check:phase4` and CI include the cumulative opaque-adapter, database, acceptance, delivery, browser, and privacy gates. Detailed protocol behavior is in [the Phase 2 record](docs/phase-2-protocol.md); durable behavior is in [the Phase 3 record](docs/phase-3-durable-acceptance.md); first-use delivery is in [the Phase 4 record](docs/phase-4-first-complete-use.md); cryptographic limits are in [the crypto README](packages/crypto/README.md).

Phase 4 adds the browser IndexedDB wallet, Action Simulator action endpoint, leased worker delivery, external receipt, and use-status polling. The three-use bound, lost acknowledgement retry, and evidence remain in later phases.

## Verification observed on 2026-09-05

| Check                 | Result                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Node / pnpm           | Bundled Node `24.19.0`, pnpm `11.19.0`                                                                                            |
| Docker / Compose      | Engine `29.2.1`, Compose `5.0.2`, responsive                                                                                      |
| Clean frozen install  | Passed inside a fresh Linux image; no host modules or `.env` copied                                                               |
| `pnpm check:phase4`   | Passed: format, lint, strict typecheck, builds, 277 unit, 8 contract, 23 integration, and 24 privacy tests                        |
| Unit suite            | 277 passed: foundation, contracts, canonicalization, policy, state/retry, evidence, serializers, and schema parity                |
| Contract suite        | 8 passed: fixed slots/nullifiers, all bindings, tampering, copies, domain separation, audit, protected keys, output               |
| Privacy suite         | 24 passed: import/export boundaries, environment access, logging/serialization, schema audit, assets, secret exclusion            |
| Database integration  | 23 passed: migration bootstrap/order/drift, role isolation, acceptance, action idempotency, worker delivery, and live role checks |
| Browser flow          | 1 passed: issuance, one use, stable receipt, and refresh recovery                                                                 |
| Compose startup       | API, web, worker, Action Simulator, PostgreSQL healthy; migration and seed exited 0                                               |
| Database version      | PostgreSQL `17.11`; first startup used an empty project volume                                                                    |
| Migration rerun       | Completed successfully on subsequent startup with existing volume                                                                 |
| Missing configuration | API, Action Simulator, worker, migration all exited 1 with only generic error codes                                               |
| Runtime privacy probe | Unknown request path/query, authorization, and supplied request ID marker absent from API response and logs                       |
| Git candidate scan    | No generated local secret found; `.env` confirmed ignored                                                                         |

Final test/tooling edits were separately typechecked and the affected privacy, integration, and browser suites passed again.

G4 certifies one complete browser-to-receipt use. After a clean Compose demo reset, authoritative state was accepted uses=1, outbox events=1, external actions=1, and distinct receipts=1. The three-use bound, lost acknowledgement retry, evidence, release CI, and soak gates belong to later phases.

## Local setup and pitfalls

The tool's default directory may be a OneDrive folder. Always work in `D:/myonsite`. System PATH initially selects incompatible Node 26.7.0. For this machine:

```powershell
Set-Location D:/myonsite
$taskNodeBin = 'C:\Users\rohit\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
$env:Path = "$taskNodeBin;$env:Path"
node --version
pnpm --version
& 'D:\myonsite\scripts\start-docker-desktop.ps1'
```

Use the existing `.env` with its existing PostgreSQL volume. Initial role/password bootstrap only runs on an empty volume. Never use factory resets or volume deletion as routine repair.

```powershell
pnpm install --frozen-lockfile
docker compose build api
docker compose up -d --no-build --wait --wait-timeout 120
pnpm check:phase3
pnpm test:integration
pnpm test:e2e
```

For a fresh checkout without `.env`, first run `pnpm setup:env`. Install Chromium with `pnpm exec playwright install chromium` on a new test machine. Use `docker compose config --quiet`; a full interpolated config prints secrets.

Only web 5173 and API 4000 are published to 127.0.0.1. Use `http://localhost:5173` so the origin matches CORS. `pnpm dev` starts Compose in the foreground. Optional `dev:apps` needs separately supplied host-reachable environment values.

Docker Desktop 4.62.0 previously failed at `dockerInference` and `engine.sock` with Windows error 1920. Launching through the existing Explorer desktop restored it. The underlying Windows mechanism remains unconfirmed. The helper preserves this working launch path; backups/recovery details are in the Phase 0 record. Unrelated user containers were preserved.

TypeScript 6.0.3 and Vitest 4.1.11 are deliberate compatibility pins. Keep strict declaration checks enabled. pnpm 11 settings live in `pnpm-workspace.yaml`; double-quoted workspace filters are required on Windows. The earlier accidental Phase 0 version-check install remains quarantined in ignored `.cache/phase0-version-check-generated-20260905`; the root lockfile is the verified Phase 1 install.

Vite preview uses `--configLoader native` to work under the non-root container user. The foundation image includes build tooling and Vite preview; production packaging is deferred to Phase 10. Zod emits two upstream Rollup annotation warnings; builds pass without suppressing them.

## Next step

Continue with **Phase 5 — lost acknowledgement and exact retry** from [phases.md](phases.md):

1. Add deterministic lost-ack fault control while retaining the pending operation.
2. Implement exact retry recovery with zero extra usage or action delta.
3. Prove the recovered receipt and operation survive browser refresh and worker delay.

## Recent milestones

| Date       | Milestone                                       | Outcome                                               |
| ---------- | ----------------------------------------------- | ----------------------------------------------------- |
| 2026-09-05 | Phase 4 first complete use implemented/verified | G4 passed; Phase 5 next                               |
| 2026-09-05 | Phase 3 durable acceptance implemented/verified | G3 passed; Phase 4 next                               |
| 2026-09-05 | Phase 2 protocol kernel implemented/verified    | G2 passed; Phase 3 next                               |
| 2026-09-05 | Phase 1 foundation implemented and verified     | G1 passed; Phase 2 next                               |
| 2026-09-05 | Created memory and AI continuity instructions   | Future sessions read and maintain current status      |
| 2026-09-05 | Repaired Docker startup through Explorer        | Local prerequisite blocker resolved; Phase 0 complete |
| 2026-09-05 | Recorded scope, ownership, source alignment     | Established the 11-phase implementation plan          |
