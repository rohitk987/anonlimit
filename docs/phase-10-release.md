# Phase 10 release, packaging, and rehearsal record

Phase 10 makes the AnonLimit demonstration reproducible from a clean checkout and ready for a
short live presentation. G10 passed on 2026-09-06 against Node 24, PostgreSQL 17, Docker Compose,
the full test suite, and the real browser flow.

## Release artifacts

- `infra/docker/runtime.Dockerfile` uses the digest-pinned `node:24-bookworm-slim` foundation image
  and installs the exact `pnpm@11.19.0` toolchain.
- `compose.yaml` uses the digest-pinned `postgres:17-alpine` image. PostgreSQL, migration, seed, API,
  Action Simulator, worker, and web start in dependency order. Migration and seed are short-lived jobs
  with successful completion conditions; only web and API publish loopback ports.
- API, Action Simulator, web, and worker health checks gate readiness. `scripts/wait-for-services.ts`
  adds an explicit API `/health/ready` and web probe with bounded timeout and interval settings.
- `scripts/run-release-soak.ts` runs the synchronized twenty-copy third-use race from 1 to 100
  iterations. `scripts/run-release-rehearsal.ts` validates Compose configuration, performs a clean
  rebuild/start, waits for readiness, runs the full release gate, runs a ten-iteration soak, and cleans
  up without deleting the database volume.
- `.github/workflows/ci.yml` runs the frozen install, cumulative P0/resilience checks, live role and
  boundary checks, privacy audit, Playwright, and ten release race scenarios.
- [Threat model and limitations](threat-model.md) documents trust boundaries, privacy assumptions,
  operational threats, and the work required to replace simulated cryptography in production.

## Reproduction commands

From a clean checkout on a machine with Node 24, pnpm 11.19.0, and a healthy Docker engine:

```powershell
pnpm install --frozen-lockfile
pnpm setup:env
docker compose config --quiet
pnpm release:rehearsal
```

The rehearsal preserves the named `postgres-data` volume. A new project name can be used to exercise
the empty-database path without touching the existing volume:

```powershell
docker compose -p anonlimit-emptydb up -d --no-build --wait --wait-timeout 120
docker compose -p anonlimit-emptydb ps -a
docker compose -p anonlimit-emptydb down --remove-orphans
```

The isolated run created a new volume, applied all migrations, seeded the default policy, reported
migrate and seed exit code 0, and brought all five runtime services to healthy. It was stopped without
removing that temporary volume.

## G10 evidence observed on 2026-09-06

| Evidence               | Result                                                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh checkout install | Detached `beb5cc6` worktree installed with `pnpm install --frozen-lockfile`; `pnpm setup:env` created ignored local configuration and issuer material |
| Digest-pinned build    | Node 24 foundation and PostgreSQL 17 digests verified; release Compose build passed                                                                   |
| Empty database startup | Fresh project-name volume; migration and seed exited 0; all runtime services healthy                                                                  |
| Readiness              | `pnpm wait:services` printed `Services ready: api, web`                                                                                               |
| Full quality gate      | `pnpm check:release` passed format, lint, typecheck, 309 unit, 9 contract, 39 integration, 24 privacy, build, and 5 Playwright tests                  |
| Fault matrix           | Phase 9 integration passed 11 tests for race, leases, crashes, redelivery, retry exhaustion, and action-key integrity                                 |
| CI repetition          | 10 synchronized full race scenarios passed with `GOLDEN_SOAK_RUNS=10`                                                                                 |
| Final soak             | 100 synchronized full race scenarios passed with `GOLDEN_SOAK_RUNS=100` in 42.46s                                                                     |
| Release orchestration  | `pnpm release:rehearsal` printed `RELEASE_REHEARSAL_PASSED` and cleaned up successfully                                                               |
| Privacy boundary       | 24 privacy tests and the browser bundle audit passed; non-demo route coverage remains in the cumulative unit/integration suites                       |

The focused soak reports one skipped test because Vitest selects only the Phase 9 variant by name; the
complete integration suite runs every test without a skipped or quarantined P0 case. The skip is a test
filter artifact, not a skipped implementation test.

## Timed rehearsals

1. **Normal path:** Playwright golden rehearsal 1 completed in 9.0s.
2. **Refresh/recovery path:** the complete five-test browser suite completed in 25.3s and covered the
   lost acknowledgement, refresh, exact resend, and expired-unaccepted proof rebuild paths; the lost
   acknowledgement recovery case completed in 3.2s.
3. **Clean Compose startup:** the release rehearsal rebuilt the image, reached healthy services in about
   18s, ran the full gate, completed ten race scenarios, and printed `RELEASE_REHEARSAL_PASSED`.

The second Playwright golden rehearsal completed in 7.8s and is the backup live demo after the first
flow is stable. The human narration and recovery guidance are in [docs/demo-script.md](demo-script.md).

## Limitations

This is a protocol and recovery demonstration using a deterministic simulated opaque provider. It does
not claim production zero-knowledge anonymity. Browser storage is local to one profile, and an operator
or compromised browser can observe its own operational data. Production deployment still needs reviewed
cryptography, issuer-key management, administrator authentication, rate limiting, monitoring, and a
clear policy for issuing new passes. See the [threat model](threat-model.md) for the complete boundary.
