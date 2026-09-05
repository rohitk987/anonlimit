# AnonLimit project memory

Last updated: 2026-09-05 (Asia/Calcutta).
Project root: `D:/myonsite`.
Current milestone: **Phases 0 and 1 complete; G1 Foundation passed. Phase 2 is next and has not started.**
Git branch: `codex/phase-1-foundation`. Check `git status` and `git log -1` for the actual revision and any later changes.

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
| 2     | Protocol kernel               | Not started                                    |
| 3     | Durable acceptance            | Not started                                    |
| 4     | First complete use            | Not started                                    |
| 5     | Safe retry                    | Not started                                    |
| 6     | Bound and rejection           | Not started                                    |
| 7     | Evidence and privacy          | Not started                                    |
| 8     | Judge experience / P0 lock    | Not started                                    |
| 9     | P1 resilience                 | Deferred until G8; required for full project   |
| 10    | Release and rehearsal         | Not started                                    |

Codex is the integration owner. Responsibilities and dependencies are in [the task board](docs/task-board.md). The user authorized Phase 1 implementation and continued work. Phase 2 has not been implemented as part of that foundation work.

## Implemented foundation

- Four app shells and seven shared packages; strict TS, exact dependency lockfile, explicit export maps, ESLint trust boundaries, formatting, Vitest projects, and Playwright.
- Health-only API and Action Simulator. Both use actual database readiness checks. The worker writes a bounded database-aware heartbeat; it does not process outbox work yet.
- React foundation page at [localhost:5173](http://localhost:5173) shows actual API readiness, unavailable/recovery state, and clear future-phase labeling.
- Separate validated browser/server configuration. `pnpm setup:env` generated an ignored local `.env`; never print or overwrite it casually.
- Safe logging facade discards arbitrary messages and fields, including nested child bindings. Browser/server/test imports and direct application environment reads are restricted.
- PostgreSQL 17 Compose stack with separate verifier/action schemas and login roles; loopback web/API ports only. Migration job uses locking, checksums, and transactions. Only migration metadata exists; there are no product migrations, credentials, receipts, or seed data.
- CI workflow for foundation checks exists in `.github/workflows/ci.yml`. Its hosted execution has not been observed.
- README, phase board, and [foundation record](docs/phase-1-foundation.md) describe setup, checks, boundaries, and limitations.

Domain, protocol contracts, and crypto export shells intentionally contain no product implementation. No later product invariant has been certified.

## Verification observed on 2026-09-05

| Check                   | Result                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Node / pnpm             | Bundled Node `24.19.0`, pnpm `11.19.0`                                                                             |
| Docker / Compose        | Engine `29.2.1`, Compose `5.0.2`, responsive                                                                       |
| Clean frozen install    | Passed inside a fresh Linux image; no host modules or `.env` copied                                                |
| `pnpm check:foundation` | Format, lint, strict typecheck, unit, all-app build, and privacy passed                                            |
| Unit suite              | 23 passed: configuration validation and API/action health/error behavior                                           |
| Privacy suite           | 18 passed: import boundaries, environment access, safe child logs, browser assets and local-secret exclusion       |
| Database integration    | 2 passed: PostgreSQL major 17, migration shell, schema isolation, role privileges, future-table default privileges |
| Browser flow            | 1 passed: real readiness, refresh, outage/recovery, desktop and mobile layout; screenshots visually inspected      |
| Compose startup         | API, web, worker, Action Simulator, PostgreSQL healthy; migration exited 0                                         |
| Database version        | PostgreSQL `17.11`; first startup used an empty project volume                                                     |
| Migration rerun         | Completed successfully on subsequent startup with existing volume                                                  |
| Missing configuration   | API, Action Simulator, worker, migration all exited 1 with only generic error codes                                |
| Runtime privacy probe   | Unknown request path/query, authorization, and supplied request ID marker absent from API response and logs        |
| Git candidate scan      | No generated local secret found; `.env` confirmed ignored                                                          |

Final test/tooling edits were separately typechecked and the affected privacy, integration, and browser suites passed again. Browser screenshots are in ignored `test-results/foundation-desktop.png` and `test-results/foundation-mobile.png`.

The contract suite remains empty and intentionally fails until Phase 2; it is not counted as passed. Full P0, storage/event/evidence privacy, concurrency, release CI, and soak gates belong to later phases.

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
pnpm check:foundation
pnpm test:integration
pnpm test:e2e
```

For a fresh checkout without `.env`, first run `pnpm setup:env`. Install Chromium with `pnpm exec playwright install chromium` on a new test machine. Use `docker compose config --quiet`; a full interpolated config prints secrets.

Only web 5173 and API 4000 are published to 127.0.0.1. Use `http://localhost:5173` so the origin matches CORS. `pnpm dev` starts Compose in the foreground. Optional `dev:apps` needs separately supplied host-reachable environment values.

Docker Desktop 4.62.0 previously failed at `dockerInference` and `engine.sock` with Windows error 1920. Launching through the existing Explorer desktop restored it. The underlying Windows mechanism remains unconfirmed. The helper preserves this working launch path; backups/recovery details are in the Phase 0 record. Unrelated user containers were preserved.

TypeScript 6.0.3 and Vitest 4.1.11 are deliberate compatibility pins. Keep strict declaration checks enabled. pnpm 11 settings live in `pnpm-workspace.yaml`; double-quoted workspace filters are required on Windows. The earlier accidental Phase 0 version-check install remains quarantined in ignored `.cache/phase0-version-check-generated-20260905`; the root lockfile is the verified Phase 1 install.

Vite preview uses `--configLoader native` to work under the non-root container user. The foundation image includes build tooling and Vite preview; production packaging is deferred to Phase 10. Zod emits two upstream Rollup annotation warnings; builds pass without suppressing them.

## Next step

When continuing implementation, start **Phase 2 — protocol kernel and opaque crypto contract** from [phases.md](phases.md):

1. Recheck Git and runtime state, read Phase 2 and the related specifications.
2. Define/freeze policy, issuance, challenge, presentation, operation/action, receipt, error, and event contracts.
3. Implement pure domain rules and separate opaque simulated holder/issuer/verifier/audit interfaces.
4. Add positive and adversarial adapter contract tests; pass G2 and keep G1 passing before database acceptance work.

## Recent milestones

| Date       | Milestone                                     | Outcome                                               |
| ---------- | --------------------------------------------- | ----------------------------------------------------- |
| 2026-09-05 | Phase 1 foundation implemented and verified   | G1 passed; Phase 2 next                               |
| 2026-09-05 | Created memory and AI continuity instructions | Future sessions read and maintain current status      |
| 2026-09-05 | Repaired Docker startup through Explorer      | Local prerequisite blocker resolved; Phase 0 complete |
| 2026-09-05 | Recorded scope, ownership, source alignment   | Established the 11-phase implementation plan          |
