# AnonLimit

AnonLimit is a bounded-use credential simulation. Its planned demonstration permits three uses, recovers exact retries without extra consumption, and rejects a fourth use without storing a holder identity.

**Phases 0–5 are implemented, and G5 has passed.** The workspace and PostgreSQL runtime run locally. A browser-held credential can be issued, presented, accepted durably, and delivered through the leased worker to the private Action Simulator. The demo can then drop a targeted acknowledgement after the receipt is durable and recover that receipt by retrying the exact IndexedDB request with zero extra use or action. The full three-use bound and live evidence remain later phases.

Read [memory.md](memory.md) for the current handoff and [AGENTS.md](AGENTS.md) for AI continuity instructions. The [phase board](docs/task-board.md), [Phase 5 record](docs/phase-5-safe-retry.md), [Phase 4 record](docs/phase-4-first-complete-use.md), [durable acceptance record](docs/phase-3-durable-acceptance.md), [protocol record](docs/phase-2-protocol.md), [foundation record](docs/phase-1-foundation.md), and [kickoff record](docs/phase-0-kickoff.md) contain scope and verification details.

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

## Verify the Phase 5 slice

```powershell
pnpm check:phase5
pnpm test:integration
pnpm exec playwright install chromium
pnpm test:e2e
```

`pnpm check:phase5` runs formatting, lint, type checking, unit, opaque-adapter contract, all-app builds, isolated PostgreSQL acceptance tests, Action Simulator idempotency, worker lease/completion, real-socket lost-ack recovery, and privacy checks. The full integration suite adds live Compose role checks, while Playwright covers a normal use, a durable lost acknowledgement, unknown state across refresh, byte-identical request replay, and original receipt recovery.

A CI workflow in [ci.yml](.github/workflows/ci.yml) reproduces the cumulative gate with a frozen install, isolated PostgreSQL tests, a Compose stack, live role checks, and Playwright. Its hosted execution has not been observed locally.

Stable commands also include `pnpm check:foundation`, `pnpm check:protocol`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test:unit`, `pnpm test:contract`, `pnpm test:integration:phase5`, and `pnpm test:privacy`. G5 certifies exact retry safety; the three-use bound, evidence, and release invariants remain later phases.

## Workspace

| Location                 | Responsibility                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `apps/web`               | React/Vite holder wallet with IndexedDB state and real protocol flow                   |
| `apps/api`               | Fastify health, issuance, challenge, presentation, use-status, and demo-fault routes   |
| `apps/worker`            | Private leased outbox delivery and atomic receipt completion                           |
| `apps/action-simulator`  | Private Fastify idempotent action and sanitized evidence endpoints                     |
| `packages/contracts`     | Strict public/internal protocol schemas and safe-field allowlists                      |
| `packages/domain`        | Pure policy, canonicalization, retry/state, key, and evidence rules                    |
| `packages/crypto`        | Browser holder plus server issuer/verifier/audit simulated adapters                    |
| `packages/db`            | Role-specific repositories, durable acceptance, seed, and append-only migration runner |
| `packages/config`        | Separate validated server/client configuration                                         |
| `packages/observability` | Log field allowlist, including child logger bindings                                   |
| `packages/testing`       | Test-only helpers prohibited in production imports                                     |

The local foundation image uses Vite preview and includes build tooling. Release packaging belongs to Phase 10. The [crypto boundary](packages/crypto/README.md) documents why the simulated provider is not production anonymity or zero-knowledge cryptography.

Product requirements and implementation gates are in [prd.md](prd.md), [architecture.md](architecture.md), [phases.md](phases.md), and [rules.md](rules.md).
