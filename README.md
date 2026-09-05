# AnonLimit

AnonLimit is a bounded-use credential simulation. Its planned demonstration permits three uses, recovers exact retries without extra consumption, and rejects a fourth use without storing a holder identity.

**Phases 0–9 are implemented, and G9 full resilience has passed.** The workspace and PostgreSQL runtime run locally. A browser-held credential can be issued, presented, accepted durably, and delivered through the leased worker to the private Action Simulator. The Demo Lab completes all three hidden slots, recovers a dropped acknowledgement by retrying the exact IndexedDB request with zero extra use or action, rejects an authenticated fourth-slot proof without mutation, resets one server-owned run, and renders backend-derived evidence, safe events, invariant checks, a linkability matrix, and the opaque-crypto assumptions. The Phase 9 golden variant also proves a synchronized twenty-request race and worker crash recovery.

Read [memory.md](memory.md) for the current handoff and [AGENTS.md](AGENTS.md) for AI continuity instructions. The [phase board](docs/task-board.md), [Phase 7 record](docs/phase-7-evidence-privacy.md), [Phase 6 record](docs/phase-6-bound-reset.md), [Phase 5 record](docs/phase-5-safe-retry.md), [Phase 4 record](docs/phase-4-first-complete-use.md), [durable acceptance record](docs/phase-3-durable-acceptance.md), [protocol record](docs/phase-2-protocol.md), [foundation record](docs/phase-1-foundation.md), and [kickoff record](docs/phase-0-kickoff.md) contain scope and verification details.

## Start locally

Prerequisites: Node.js **24**, pnpm **11.19.0**, and a healthy Docker Linux engine with Compose. This machine's system Node 26 is incompatible; [memory.md](memory.md) records the available Node 24 path and Docker startup helper.

Run from the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm setup:env
docker compose config --quiet
docker compose build api
docker compose up -d --no-build --wait --wait-timeout 120
```

Run `setup:env` only on first setup. It generates random local secrets in ignored `.env` and refuses to overwrite an existing file. `.env.example` documents names and safe placeholders. Do not use its placeholder passwords as runtime values.

Open [AnonLimit](http://localhost:5173). The public API exposes [liveness](http://localhost:4000/health/live) and [database readiness](http://localhost:4000/health/ready). Use the localhost hostname so the browser origin matches the generated CORS configuration.

Only web and API ports are published, bound to loopback. PostgreSQL, Action Simulator, and worker have no host ports. The migration job exits successfully before the application services start.

```powershell
docker compose ps -a
docker compose run --rm migrate
docker compose down
```

Stopping the stack preserves its database volume. Bootstrap roles and passwords are initialized on an empty volume; keep the existing environment file with that volume.

`pnpm dev` runs the Compose stack in the foreground and builds changes. `pnpm dev:apps` is an optional process-watch command for developers who separately supply valid environment variables and reachable database/service URLs; the generated Compose-only database hostnames do not resolve from host processes.

## Verify the Phase 9 resilience slice

```powershell
pnpm check:phase9
pnpm audit:privacy
pnpm demo:golden
pnpm demo:golden:race
pnpm demo:reset
pnpm test:integration
pnpm exec playwright install chromium
pnpm test:e2e
```

`pnpm check:phase9` runs the cumulative backend, resilience, and privacy gate. `pnpm audit:privacy` scans generated browser assets and local secret markers without printing values. `pnpm demo:golden` runs the cumulative headless golden scenario, including the Phase 9 race. `pnpm demo:golden:race` runs the focused twenty-request race. `pnpm demo:reset` calls the public server-owned reset endpoint (optionally with an API base URL argument). `pnpm test:e2e` runs two complete Phase 8 rehearsals plus the wallet recovery regressions; the narration is in [docs/demo-script.md](docs/demo-script.md).

A CI workflow in [ci.yml](.github/workflows/ci.yml) reproduces the cumulative gate with a frozen install, isolated PostgreSQL tests, a Compose stack, live role checks, and Playwright. Its hosted execution has not been observed locally.

Stable commands also include `pnpm check:foundation`, `pnpm check:protocol`, `pnpm check:phase9`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test:unit`, `pnpm test:contract`, `pnpm test:integration:phase6`, `pnpm test:integration:phase7`, `pnpm test:integration:phase9`, `pnpm test:privacy`, and `pnpm audit:privacy`. G6 certifies the three-use bound, safe retry, zero-mutation fourth rejection, and scoped reset; G7 certifies backend-derived evidence, safe event replay, transient linkability auditing, and privacy scanning; G8 certifies the responsive guided browser flow; G9 certifies the synchronized race and worker recovery matrix. Phase 10 release remains.

## Workspace

| Location                 | Responsibility                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `apps/web`               | React/Vite holder wallet with IndexedDB state and real protocol flow                     |
| `apps/api`               | Fastify protocol, evidence, safe event stream, demo-fault, linkability, and reset routes |
| `apps/worker`            | Private leased outbox delivery and atomic receipt completion                             |
| `apps/action-simulator`  | Private Fastify idempotent action, reset, and sanitized evidence endpoints               |
| `packages/contracts`     | Strict public/internal protocol schemas and safe-field allowlists                        |
| `packages/domain`        | Pure policy, canonicalization, retry/state, key, and evidence rules                      |
| `packages/crypto`        | Browser holder plus server issuer/verifier/audit simulated adapters                      |
| `packages/db`            | Role-specific repositories, durable acceptance, evidence views, seed, and migrations     |
| `packages/config`        | Separate validated server/client configuration                                           |
| `packages/observability` | Log field allowlist, including child logger bindings                                     |
| `packages/testing`       | Test-only helpers prohibited in production imports                                       |

The local foundation image uses Vite preview and includes build tooling. Release packaging belongs to Phase 10. The [crypto boundary](packages/crypto/README.md) documents why the simulated provider is not production anonymity or zero-knowledge cryptography.

Product requirements and implementation gates are in [prd.md](prd.md), [architecture.md](architecture.md), [phases.md](phases.md), and [rules.md](rules.md).
