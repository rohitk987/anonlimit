# AnonLimit

AnonLimit is a bounded-use credential simulation. Its planned demonstration permits three uses, recovers exact retries without extra consumption, and rejects a fourth use without storing a holder identity.

**Phase 1 is implemented.** The four application shells, PostgreSQL 17, migration job, typed configuration, dependency boundaries, and health checks run locally. Credential issuance, wallet storage, use acceptance, receipts, retries, and evidence remain future phases. The screen labels these capabilities as unavailable.

Read [memory.md](memory.md) for the current handoff and [AGENTS.md](AGENTS.md) for AI continuity instructions. The [phase board](docs/task-board.md), [foundation record](docs/phase-1-foundation.md), and [kickoff record](docs/phase-0-kickoff.md) contain scope and verification details.

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

## Verify the foundation

```powershell
pnpm check:foundation
pnpm test:integration
pnpm exec playwright install chromium
pnpm test:e2e
```

The first command runs formatting, lint, type checking, unit tests, all-app build, and foundation privacy checks. Integration and browser checks require the running Compose stack. The browser check covers real readiness, retrying the check, unavailable state, recovery, and desktop/mobile layout.

A CI workflow in [ci.yml](.github/workflows/ci.yml) reproduces this foundation gate with a frozen install and empty PostgreSQL. Its hosted execution has not been observed locally.

Stable commands also include `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test:unit`, `pnpm test:contract`, and `pnpm test:privacy`. The contract project intentionally has no tests until Phase 2 and fails when empty. Foundation integration/privacy checks do not certify the later product invariants.

## Workspace

| Location                                 | Responsibility                                                 |
| ---------------------------------------- | -------------------------------------------------------------- |
| `apps/web`                               | React/Vite foundation screen with real API readiness           |
| `apps/api`                               | Fastify public health endpoints                                |
| `apps/worker`                            | Database-aware process heartbeat; no outbox processing yet     |
| `apps/action-simulator`                  | Private Fastify health endpoints                               |
| `packages/domain`, `contracts`, `crypto` | Protocol package boundaries; only health contracts implemented |
| `packages/db`                            | Role-specific connections and append-only migration runner     |
| `packages/config`                        | Separate validated server/client configuration                 |
| `packages/observability`                 | Log field allowlist, including child logger bindings           |
| `packages/testing`                       | Test-only helpers prohibited in production imports             |

The local foundation image uses Vite preview and includes build tooling. Release packaging belongs to Phase 10. Opaque crypto is a simulation boundary; production anonymity is not implemented.

Product requirements and implementation gates are in [prd.md](prd.md), [architecture.md](architecture.md), [phases.md](phases.md), and [rules.md](rules.md).
