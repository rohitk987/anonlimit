# Phase 1 foundation record

Date: 2026-09-05. Canonical workspace: `D:/myonsite`.

## Implemented scope

All four application shells and seven shared packages are present, with Node 24, pnpm 11.19.0, an exact dependency lockfile, strict TypeScript, package exports, and enforced browser/server/test boundaries. The only implemented wire contract is the strict health response. Protocol and crypto entry points remain explicitly empty pending Phase 2.

Server configuration validates required secrets, URLs, ports, polling bounds, and boolean strings and emits generic startup errors. Client configuration has a separate browser-safe export and returns only public fields. A dedicated logging facade applies a closed field allowlist to messages and inherited child bindings.

The React screen displays actual API/database readiness and explicitly unavailable product behavior. No use counter, success receipt, or evidence card is fabricated.

## Runtime design

Compose owns the `anonlimit` project. PostgreSQL 17 has a persistent volume and private schema-specific login roles: `verifier_api`, `verifier_worker`, and `action_service`. The owner is reserved for bootstrap/migrations. Runtime roles cannot create public objects, write migration metadata, or access the other service's schema.

The migration job serializes execution using an advisory lock, records checksums, rejects migration drift, and applies numbered SQL files transactionally. It currently creates only its metadata table; product tables and seed data begin in Phase 3.

API and Action Simulator expose liveness and database readiness. The worker refreshes a bounded heartbeat only after a successful database check and removes it on failure/shutdown. No delivery processing exists yet.

Web and API join the public bridge to publish loopback ports 5173 and 4000. They also join the private database network. PostgreSQL, worker, and Action Simulator remain private. API readiness and all other service checks passed under this topology.

The image runs as the non-root Node user. Vite preview uses Node's native TypeScript config loader to avoid writing build-owned temporary files at startup. The image deliberately retains development tooling; production packaging is Phase 10 work.

## Compatibility and fixes

- TypeScript 6.0.3 matches typescript-eslint 8.69.0's declared support; the earlier TypeScript 7 scaffold was incompatible.
- Vitest 4.1.11 passes strict declaration checks. The initially installed Vitest 5.0.0 had missing/incompatible declarations in this workspace. Strict checking remains enabled, including library declarations.
- pnpm 11 workspace settings live in `pnpm-workspace.yaml`. Script filters use double quotes so they run on Windows and Linux.
- Safe logging uses a small facade because Pino child bindings bypassed the original message-only filter. Negative tests demonstrated the issue before the fix.
- An internal-only Docker network did not publish the API port on this machine; attaching the API to the public bridge restored its loopback endpoint.
- Zod emits two upstream Rollup comment-annotation warnings during the web build. Builds succeed; these are recorded warnings, not suppressed failures.

## Verification

The foundation static gate, Docker runtime, and browser checks are recorded in [memory.md](../memory.md). Commands:

```text
pnpm install --frozen-lockfile
pnpm check:foundation
docker compose config --quiet
docker compose build api
docker compose up -d --no-build --wait --wait-timeout 120
pnpm test:integration
pnpm test:e2e
```

The image build performed an independent clean Linux install with no copied host modules or local environment file. Initial startup used a new PostgreSQL volume. The migration job also completed against the existing volume on subsequent startup.

The foundation suites contain 23 unit, 18 privacy, 2 database integration tests, and one browser flow. The browser flow includes desktop/mobile inspection, actual readiness, a simulated network outage, and recovery. Missing-configuration startup checks must exit nonzero with generic errors.

The CI workflow reproduces the applicable foundation checks. A hosted CI run, protocol contract suite, full P0 scenario, release soak, and production deployment remain unverified and outside G1.

## Next phase

Phase 2 defines policy, issuance, challenge, presentation, operation/action, receipt, error, and event contracts; then domain rules and the opaque simulated adapter. Start only after G1 is recorded as passed. No protocol implementation has been introduced in this phase.
