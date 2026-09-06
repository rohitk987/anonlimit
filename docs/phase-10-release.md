# Phase 10 release, packaging, and rehearsal record

Phase 10 makes AnonLimit reproducible from a clean checkout and ready for a short public demonstration. G10 passed on 2026-09-06 against Node.js 24, pnpm 11.19.0, PostgreSQL 17, Docker Compose, the complete test suite, and the real browser flow.

The public frontend now presents that work through an original AnonLimit interface. Its Apple-inspired visual language uses system typography, generous spacing, restrained color, and rounded surfaces, while its custom mark, conceptual pass, product copy, layout, and interaction states remain AnonLimit's own. No Apple branding, interface assets, or bundled fonts are used. See [frontend-design.md](frontend-design.md) for the design contract.

## Release artifacts

- `infra/docker/runtime.Dockerfile` uses a digest-pinned `node:24-bookworm-slim` foundation image and installs the exact `pnpm@11.19.0` toolchain.
- `compose.yaml` uses a digest-pinned `postgres:17-alpine` image. PostgreSQL, migration, seed, API, Action Simulator, worker, and web start in dependency order. Migration and seed are short-lived jobs with successful-completion conditions; only web and API publish loopback ports.
- API, Action Simulator, web, and worker health checks gate readiness. `scripts/wait-for-services.ts` adds explicit API `/health/ready` and web probes with bounded timeout and interval settings.
- `scripts/run-release-soak.ts` repeats the synchronized twenty-copy third-use race. `GOLDEN_SOAK_RUNS` accepts integers from 1 through 100 and defaults to 100 when unset.
- `scripts/run-release-rehearsal.ts` validates Compose, builds the shared application image once through the API service, stops the prior stack, starts every service with `--no-build --wait`, verifies readiness, runs the full release gate, runs the separate privacy audit, runs the configured soak, and cleans up in a `finally` path without deleting the database volume.
- `.github/workflows/ci.yml` runs the frozen install, cumulative P0 and resilience checks, a single shared-image build, `--no-build` startup, live role and boundary checks, the privacy audit, and Playwright. The ten-scenario soak is opt-in through a manual workflow run with `run_soak` enabled; pushes and pull requests skip it.
- CI installs Node.js 24 with automatic package-manager caching disabled before installing the pnpm version pinned in `package.json`. Cleanup runs only after Compose configuration validates, so an early setup failure does not trigger another failure from missing environment values. A failed or partially started stack is still cleaned up.
- On the Linux runner, CI assigns the two generated issuer files to the runtime user's UID while preserving private `0600` permissions, then checks readability from an API container before startup. This handles the runner and container having different UIDs without printing key contents or running the API as root.
- [Threat model and limitations](threat-model.md) documents trust boundaries, privacy assumptions, operational threats, and the work required to replace simulated cryptography in production.

## Reproduce the release

From a clean checkout on a machine with Node.js 24, pnpm 11.19.0, and a healthy Docker engine:

```powershell
git clone https://github.com/rohitk987/anonlimit.git
cd anonlimit
pnpm install --frozen-lockfile
pnpm setup:env
pnpm exec playwright install chromium
pnpm release:rehearsal
```

The rehearsal performs these steps in order:

1. `docker compose config --quiet`
2. `docker compose build api`
3. `docker compose down --remove-orphans`
4. `docker compose up -d --no-build --wait --wait-timeout 120`
5. `pnpm wait:services`
6. `pnpm check:release`
7. `pnpm audit:privacy`
8. `pnpm demo:golden:soak`
9. `docker compose down --remove-orphans` during final cleanup

All application services share the image built in step 2, which avoids duplicate BuildKit exports. Cleanup runs after success or failure and preserves the named `postgres-data` volume.

The soak defaults to 100 complete synchronized race scenarios. An intentional override applies to the rehearsal because the script forwards its environment:

```powershell
$env:GOLDEN_SOAK_RUNS = "10"
pnpm release:rehearsal
Remove-Item Env:GOLDEN_SOAK_RUNS
```

An explicitly requested CI soak uses that 10-run override to fit its bounded job. In GitHub Actions, choose **Phase 10 release and P0**, select **Run workflow**, and enable the optional soak input. It is disabled by default, including on pushes and pull requests. Leave the variable unset for the default 100-run local release rehearsal.

## Empty-database check

A distinct Compose project name can exercise the empty-database path without changing the existing project's volume. Build the shared image first if it is not already present:

```powershell
docker compose build api
docker compose -p anonlimit-emptydb up -d --no-build --wait --wait-timeout 120
docker compose -p anonlimit-emptydb ps -a
docker compose -p anonlimit-emptydb down --remove-orphans
```

The recorded isolated run created a new volume, applied all migrations, seeded the default policy, reported migration and seed exit code 0, and brought all five runtime services to healthy. It was stopped without removing that volume.

## G10 evidence observed on 2026-09-06

| Evidence               | Result                                                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh checkout install | Detached `beb5cc6` worktree installed with `pnpm install --frozen-lockfile`; `pnpm setup:env` created ignored local configuration and issuer material.            |
| Digest-pinned build    | Node.js 24 foundation and PostgreSQL 17 digests verified; the release Compose build passed.                                                                       |
| Empty database startup | A fresh project-name volume ran migration and seed successfully; all runtime services became healthy.                                                             |
| Readiness              | `pnpm wait:services` printed `Services ready: api, web`.                                                                                                          |
| Full quality gate      | `pnpm check:release` passed format, lint, typecheck, 309 unit tests, 9 contract tests, 39 integration tests, 24 privacy tests, the build, and 5 Playwright tests. |
| Fault matrix           | Phase 9 integration passed 11 tests for race, leases, crashes, redelivery, retry exhaustion, and action-key integrity.                                            |
| CI repetition          | 10 synchronized full-race scenarios passed with `GOLDEN_SOAK_RUNS=10`.                                                                                            |
| Final soak             | 100 synchronized full-race scenarios passed with `GOLDEN_SOAK_RUNS=100` in 42.46 seconds.                                                                         |
| Release orchestration  | `pnpm release:rehearsal` printed `RELEASE_REHEARSAL_PASSED` and completed cleanup successfully.                                                                   |
| Privacy boundary       | 24 privacy tests and the browser-bundle audit passed; non-demo route coverage remained in the cumulative unit and integration suites.                             |

The focused soak reports one skipped test because Vitest selects only the Phase 9 variant by name. The complete integration suite runs every test without a skipped or quarantined P0 case; the focused skip is a filter artifact.

## Recorded browser and startup timings

1. The first automated Playwright golden rehearsal completed in 9.0 seconds.
2. The complete five-test browser suite completed in 25.3 seconds and covered lost acknowledgement, refresh, exact resend, and expired-unaccepted proof rebuild; the lost-acknowledgement recovery case completed in 3.2 seconds.
3. The clean Compose rehearsal reached healthy services in about 18 seconds before running its quality, privacy, and soak checks.
4. The second automated Playwright golden rehearsal completed in 7.8 seconds.

These are observed development-machine timings, not performance guarantees. Both Playwright runs exercise the same live protocol path. The human narration and recovery guidance are in [demo-script.md](demo-script.md).

## Public frontend release checks

The public page includes a descriptive title and metadata, semantic navigation and sections, a keyboard skip link, visible focus treatment, live status text, reduced-motion behavior, and responsive layouts down to a 320px viewport. The automated browser rehearsal verifies keyboard activation, full-flow status transitions, lack of page errors, desktop overflow, and a 390×844 narrow viewport.

The frontend keeps the browser wallet and verifier evidence visually distinct. Local slot state never becomes an authoritative server counter, and the rendered evidence remains masked and allowlisted.

## Limitations

This is a protocol and recovery demonstration using a deterministic simulated opaque provider. It does not claim production zero-knowledge anonymity. Browser storage is local to one profile, and an operator or compromised browser can observe its own operational data. Production deployment still needs reviewed cryptography, issuer-key management, administrator authentication, rate limiting, monitoring, TLS, and a clear policy for issuing new passes. See the [threat model](threat-model.md) for the complete boundary.
