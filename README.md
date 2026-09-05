# AnonLimit

AnonLimit is a bounded-use credential simulation. Its planned demonstration permits three uses, recovers exact retries without extra consumption, and rejects a fourth use without storing a holder identity.

**Phases 0–2 are implemented, and G2 has passed.** The workspace and PostgreSQL runtime run locally. Strict protocol contracts, pure canonical/retry/evidence rules, and the replaceable opaque simulated crypto provider are frozen for the next vertical slice. HTTP issuance, wallet storage, durable use acceptance, worker actions, receipts, and live evidence remain future phases, so the screen still labels them as unavailable.

Read [memory.md](memory.md) for the current handoff and [AGENTS.md](AGENTS.md) for AI continuity instructions. The [phase board](docs/task-board.md), [protocol record](docs/phase-2-protocol.md), [foundation record](docs/phase-1-foundation.md), and [kickoff record](docs/phase-0-kickoff.md) contain scope and verification details.

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

## Verify the protocol foundation

```powershell
pnpm check:protocol
pnpm test:integration
pnpm exec playwright install chromium
pnpm test:e2e
```

The first command runs formatting, lint, type checking, unit and opaque-adapter contract tests, all-app builds, and privacy checks. Integration and browser checks require the running Compose stack. The browser check covers real readiness, retrying the check, unavailable state, recovery, and desktop/mobile layout.

A CI workflow in [ci.yml](.github/workflows/ci.yml) reproduces this protocol gate with a frozen install and empty PostgreSQL. Its hosted execution has not been observed locally.

Stable commands also include `pnpm check:foundation`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test:unit`, `pnpm test:contract`, and `pnpm test:privacy`. G2 freezes protocol behavior but does not certify later durable product invariants.

## Workspace

| Location                 | Responsibility                                                      |
| ------------------------ | ------------------------------------------------------------------- |
| `apps/web`               | React/Vite foundation screen with real API readiness                |
| `apps/api`               | Fastify public health endpoints                                     |
| `apps/worker`            | Database-aware process heartbeat; no outbox processing yet          |
| `apps/action-simulator`  | Private Fastify health endpoints                                    |
| `packages/contracts`     | Strict public/internal protocol schemas and safe-field allowlists   |
| `packages/domain`        | Pure policy, canonicalization, retry/state, key, and evidence rules |
| `packages/crypto`        | Browser holder plus server issuer/verifier/audit simulated adapters |
| `packages/db`            | Role-specific connections and append-only migration runner          |
| `packages/config`        | Separate validated server/client configuration                      |
| `packages/observability` | Log field allowlist, including child logger bindings                |
| `packages/testing`       | Test-only helpers prohibited in production imports                  |

The local foundation image uses Vite preview and includes build tooling. Release packaging belongs to Phase 10. The [crypto boundary](packages/crypto/README.md) documents why the simulated provider is not production anonymity or zero-knowledge cryptography.

Product requirements and implementation gates are in [prd.md](prd.md), [architecture.md](architecture.md), [phases.md](phases.md), and [rules.md](rules.md).
