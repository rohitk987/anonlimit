# Phase 0 — Kickoff and scope lock

Date: 2026-09-05. Workspace: `D:/myonsite`. Status: Phase 0 complete; scope, ownership, and local prerequisites verified. Phase 1 implementation is next.

## Finish line

Enforce a three-use benefit without learning who owns it or linking their three legitimate uses.

The final demonstration must show three accepted uses, three committed actions, zero extra consumption on retry, a rejected fourth use, and no stored holder identity or link between distinct legitimate uses under the opaque provider contract.

This kickoff records implementation decisions and prerequisite checks. Product behavior is verified in the later implementation gates.

## Scope and decisions

| Concern                | Locked decision                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default policy         | `anon-demo`, version `1`, audience `demo-service`, quota window `hackathon-demo`, maximum uses `3`                                                                              |
| Demo action            | `REDEEM_DEMO_BENEFIT` with an identity-free payload containing `benefitCode: HACKATHON`                                                                                         |
| Runtime and language   | Node.js 24, strict TypeScript, pnpm workspaces; exact dependency versions and lockfile validated in Phase 1                                                                     |
| Application boundaries | React/Vite web, Fastify API with separate issuer/verifier modules, outbox worker, independent Action Simulator                                                                  |
| Persistence            | PostgreSQL 17; separate verifier/action schemas and roles; browser wallet in IndexedDB                                                                                          |
| Recovery work          | PostgreSQL transactional outbox, with a stable action key and independently idempotent Action Simulator                                                                         |
| Consumption point      | One use is consumed when the acceptance transaction commits the use, consumed challenge, outbox item, and safe event together                                                   |
| Acceptance order       | Validate and verify without usage writes; begin transaction; lock and recheck policy/challenge; write atomically; commit                                                        |
| Exact retry            | Reuse the stored slot, operation ID, canonical intent, and presentation; resolve accepted work before rejecting stale challenge/policy                                          |
| Rejected first use     | Invalid proof, expired challenge, policy mismatch, over-limit proof, or rolled-back transaction adds no use, outbox item, receipt, or action                                    |
| Evidence authority     | Verifier database plus the Action Simulator's independently recorded effects; UI counters are not authoritative                                                                 |
| Privacy boundary       | Credential and hidden slots stay in the wallet; proof/raw nullifier are transient verifier inputs; persist only protected per-use lookup data and allowlisted metadata          |
| Cryptography           | Deterministic simulated provider behind separate holder, issuer, verifier, and audit interfaces; its contract is not production cryptography or a proof of real-world anonymity |
| Reset                  | Server-controlled demo run; reset invalidates previous-run demo credential/operation state; clients cannot create extra allowance by changing a run ID                          |
| Delivery order         | Phase IDs 0–10 in `phases.md` are authoritative; complete cumulative gates before dependent work                                                                                |
| Optional work          | P1 resilience begins after G8; Phase 9 may be omitted for a declared minimum 24-hour P0 submission, but remains required for full-project completion                            |
| Excluded work          | P2 during the hackathon, production crypto, user accounts, identity counters, real irreversible actions, and extra queue infrastructure                                         |

Privacy tests and conflict rejection remain part of P0. Optional race/crash demonstration controls and evidence presentation enhancements do not defer the underlying privacy, idempotency, or durable-recovery requirements. No event duration or delivery deadline has been supplied; use the P0 critical path first and preserve the full-project requirements.

## Golden demo sequence

1. Reset the selected demo run and verify zero authoritative uses and actions.
2. Load the default three-use policy and issue one credential to the wallet.
3. Complete use one and receive receipt A.
4. Submit use two with a dropped acknowledgement after durable completion; the wallet retains the unknown-outcome operation.
5. Retry that exact operation and recover receipt B with zero additional uses or actions.
6. Complete use three and receive receipt C. After G8, the Phase 9 variant replaces this step with 20 overlapping copies of the same fresh presentation.
7. Attempt use four and reject it without changing use, outbox, receipt, or action state.
8. Run linkability and privacy evidence: distinct-use pairs return `UNLINKABLE`, the retry pair returns `SAME_USE`, and backend-derived invariants pass.

Expected final evidence:

| Metric                                                  | Required value |
| ------------------------------------------------------- | -------------: |
| Declared limit                                          |              3 |
| Accepted distinct uses                                  |              3 |
| Committed external actions                              |              3 |
| Extra uses from retry                                   |              0 |
| Extra actions from retry or race                        |              0 |
| Over-limit mutations to use/outbox/receipt/action state |              0 |
| Stored holder identities                                |              0 |
| Stored credential-wide identifiers                      |              0 |
| Linked distinct legitimate-use pairs                    |              0 |
| Stable receipts                                         |            All |

These are acceptance targets, not results from a running application.

## Ownership and handoff

The current implementation team is Codex in this task. No additional human contributor is assumed. Codex is the integration captain and owns root configuration, dependency versions, shared contracts, phase status, and integration checks.

| Lane             | Files or responsibility                                                    | Current owner                            |
| ---------------- | -------------------------------------------------------------------------- | ---------------------------------------- |
| Integration      | Root config, lockfile, shared contracts, decisions, gate evidence          | Codex integration captain                |
| Protocol/API     | `packages/domain`, `packages/contracts`, `packages/crypto`, `apps/api`     | Codex, serialized with contract changes  |
| Data/reliability | `packages/db`, migrations, `apps/worker`, `apps/action-simulator`, `infra` | Codex, single migration owner            |
| Wallet/UI        | `apps/web` and browser-only holder integration                             | Codex                                    |
| QA/privacy       | `tests`, CI, scanners, reusable golden scenario                            | Codex; independent review when delegated |

Agents assisting this kickoff have bounded documentation review or environment verification duties. Assign non-overlapping file ownership before delegating implementation. Every future development machine must repeat the prerequisite checks.

The critical path is `0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 10`, with `8 → 9 → 10` for the full resilience delivery. See the [phase task board](task-board.md).

## Local prerequisite evidence

The initial check found Node `26.7.0` on the system PATH, pnpm `11.19.0`, Docker CLI `29.2.1`, and Compose `5.0.2`. Docker Desktop was stopped. A compatible Node `24.19.0` is already bundled locally; no global Node replacement is needed.

Use the bundled runtime for this PowerShell session before development commands:

```powershell
$taskNodeBin = 'C:\Users\rohit\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
$env:Path = "$taskNodeBin;$env:Path"
node --version
pnpm --version
docker version
docker compose version
```

The PATH adjustment applies only to the current shell and its child processes. These paths describe this machine; another contributor should provide their own Node 24 installation.

Start Docker through the verified Windows Explorer launch context when needed:

```powershell
& 'D:\myonsite\scripts\start-docker-desktop.ps1'
```

The [startup helper](../scripts/start-docker-desktop.ps1) returns immediately when the server is healthy. Otherwise it asks the existing Explorer desktop to launch Docker hidden, then polls server readiness with individually bounded CLI probes. It does not reset data, modify Docker settings, or stop Docker services. Opening Docker Desktop from the Windows Start menu is also the intended normal interactive startup path.

Verified results:

| Prerequisite   | Observed result                                                                                                                            | Status                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| Node.js 24     | Bundled `node.exe --version` returns `v24.19.0`                                                                                            | PASS with the shell PATH selection above |
| pnpm           | Direct bundled Node invocation of `pnpm.mjs --version` returns `11.19.0`; existing `pnpm.cmd` also uses bundled Node 24                    | PASS                                     |
| Docker CLI     | `29.2.1`, context `desktop-linux`                                                                                                          | PASS for CLI availability                |
| Docker Compose | `docker compose version` returns `v5.0.2`                                                                                                  | PASS for CLI availability                |
| Docker engine  | Server `29.2.1`, Linux engine, `overlayfs`; `docker version` and `docker info` respond after launch through Explorer                       | PASS                                     |
| PostgreSQL 17  | Official `postgres:17-alpine` image reports `17.11`; `pg_isready`, real SQL connection, temporary-table insert/count, and rollback succeed | PASS                                     |

Docker Desktop `4.62.0` initially failed while initializing its inference manager because its `dockerInference` runtime socket could not be removed: `The file cannot be accessed by the system`. A subsequent attempt also exposed an inaccessible `engine.sock`. Preserving and recreating runtime directories alone did not fix startup from the automated command session.

A diagnostic socket created under `D:/myonsite/.cache` cleaned up on close. The same test under Docker's AppData directories left an inaccessible socket. Running the AppData test through the existing Windows Explorer desktop cleaned up normally. Launching Docker through that Explorer context then restored the engine. This establishes a launch-context interaction on this machine; the precise Windows mechanism remains unconfirmed. Both diagnostic contexts reported no package identity, so MSIX virtualization has not been established as the cause. No reinstall, Windows reboot, or factory reset was used for this successful repair.

The PostgreSQL check used `anonlimit-phase0-pg-20260905-0748`, with network disabled, no published ports, and database storage on temporary memory-backed storage. SQL confirmed server major version 17, wrote and read a temporary table, and rolled back. The container was stopped and its automatic removal was verified. The official image remains cached at digest `sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73`. Existing user containers were left running.

Original runtime directories are preserved at:

- `C:/Users/rohit/AppData/Local/Docker/run.phase0-backup-20260905-0735`
- `C:/Users/rohit/AppData/Local/docker-secrets-engine.phase0-backup-20260905-0738`

A pnpm diagnostic unexpectedly triggered dependency setup. Its generated `node_modules` and lockfile were quarantined under ignored `.cache/phase0-version-check-generated-20260905`; generated workspace settings were removed while preserving the two package-directory entries. This attempt did not pass the Phase 1 installation/build gate. Use the version commands above without `pnpm exec` for prerequisite checks.

Phase 0 prerequisite checks now pass. The subsequent application Compose/migration checks belong to Phase 1; the database smoke check does not certify application transactions or product invariants.

## Phase 1 starting state

The existing repository contains an uncommitted partial foundation: root package/configuration files, a README, and a task board. There is no initial Git commit, dependency lockfile, application implementation, shared package implementation, or Compose stack yet. Existing Phase 1 files are preserved for the next phase to finish and validate.

Phase 1 must validate pinned dependency compatibility with Node 24, create the four app shells and shared packages, provide typed configuration and genuine health endpoints, establish PostgreSQL/Compose/migration startup, and pass G1. Later protocol and product gates have not run.

## Source alignment and exit evidence

Read [prd.md](../prd.md), [architecture.md](../architecture.md), [rules.md](../rules.md), and [phases.md](../phases.md) as the project specification. This kickoff resolves the selected stack, phase numbering, transaction order, operational reset boundary, required P0 privacy checks, and distinction between the core P0 and full resilience scenarios.

- [x] Pitch, default policy, and eight-step demo sequence recorded.
- [x] Consumption, retry, crypto, privacy, and evidence decisions recorded.
- [x] Integration captain, file ownership, critical path, and task board recorded.
- [x] P2 excluded from hackathon implementation.
- [x] Source descriptions aligned with the selected plan.
- [x] Node 24, pnpm, Docker engine/Compose, and actual PostgreSQL 17 query verified.
- [x] No unresolved prerequisite or scope decision blocks Phase 1.

Document validation passed: local Markdown links resolve, code fences are balanced, no conflict markers remain, and the plan still contains exactly 11 phase sections. The startup helper passed PowerShell syntax validation and the already-running engine path; its Explorer launch mechanism successfully started the engine during the repair. Product unit/integration/browser tests have not been claimed as passing.
