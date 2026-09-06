# AnonLimit

The Demo Lab includes automatic audit summaries and aggregate abuse signals, with optional AI explanations. See [automated insights](docs/automated-insights.md) for the data boundary, rules, API, and server configuration.

**Limit the use. Leave the person unknown.**

AnonLimit is a working bounded-use credential simulation. It issues one anonymous pass to a browser wallet, permits exactly three uses, recovers an exact retry without spending another use, and rejects a fourth use without storing a holder identity.

The guided Demo Lab pairs that flow with backend-derived evidence: committed-use and action counts, a safe event trace, masked records, invariant checks, and a transient linkability audit. Its cryptography is deliberately simulated, so the project demonstrates protocol behavior, privacy-aware storage, idempotent recovery, and system boundaries rather than production anonymity.

The canonical repository is [github.com/rohitk987/anonlimit](https://github.com/rohitk987/anonlimit).

## What the demo proves

| Scenario                             | Observable result                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Three allowed uses                   | Three verifier acceptances produce three independently recorded external actions and stable receipts.                     |
| Lost acknowledgement                 | The browser retains the exact IndexedDB request and recovers the original result with zero additional use or action.      |
| Fourth-use boundary                  | An authenticated simulator probe reaches the real verifier and is rejected without ledger mutation.                       |
| Privacy evidence                     | Server views expose masked references and allowlisted events without holder identity, raw proof, or raw nullifier fields. |
| Linkability audit                    | Distinct accepted uses report `UNLINKABLE`; an exact retry reports `SAME_USE` under the simulated provider contract.      |
| Concurrent replay and worker failure | PostgreSQL uniqueness, leased outbox recovery, and stable action keys converge duplicate work on one effect.              |

The limit belongs to one issued pass. A real deployment still needs an issuance policy that decides who may receive another pass.

## Run locally

You need Node.js **24.x**, pnpm **11.19.0**, and a healthy Docker engine with Compose and Linux containers.

```powershell
git clone https://github.com/rohitk987/anonlimit.git
cd anonlimit
pnpm install --frozen-lockfile
pnpm setup:env
docker compose config --quiet
docker compose build api
docker compose up -d --no-build --wait --wait-timeout 120
pnpm wait:services
```

`pnpm setup:env` generates ignored local configuration and issuer material, and refuses to overwrite an existing `.env`. All application services share the image built through `api`, so Compose can start the complete stack with `--no-build`.

Open [http://localhost:5173](http://localhost:5173). Use the `localhost` hostname so the browser origin matches the generated CORS configuration. The public API exposes [liveness](http://localhost:4000/health/live) and [database readiness](http://localhost:4000/health/ready). PostgreSQL, the worker, and the Action Simulator remain private; only the web and API ports bind to loopback.

The full setup, development workflow, and troubleshooting guide is in [docs/getting-started.md](docs/getting-started.md).

## Follow the Demo Lab

1. Reset the demo run and issue an anonymous pass.
2. Use the first slot and wait for its receipt.
3. Arm an acknowledgement drop, use the second slot, and optionally refresh while its outcome is unknown.
4. Retry the exact stored request and confirm both retry deltas remain zero.
5. Use the third slot, then attempt the controlled fourth-use probe.
6. Run the privacy audit and inspect the evidence, trace, invariants, and linkability matrix.

Every control sends real protocol requests. The wallet card reports browser-local IndexedDB state; the evidence workspace reports sanitized server state. See [docs/demo-script.md](docs/demo-script.md) for the timed narration.

## Verify the release

With the Compose stack running, the complete quality gate is:

```powershell
pnpm exec playwright install chromium
pnpm check:release
pnpm audit:privacy
```

Install Chromium once on a clean host. `pnpm check:release` then runs formatting, linting, strict type checks, unit tests, contract tests, the complete integration suite, privacy tests, the production build, and Playwright. `pnpm audit:privacy` separately scans the generated browser assets and local secret markers without printing their values.

The release rehearsal owns startup and cleanup:

```powershell
pnpm release:rehearsal
```

It performs this sequence:

1. Validate the Compose configuration.
2. Build the shared application image once through `docker compose build api`.
3. Stop any prior project stack and start all services with `--no-build --wait`.
4. Check readiness, run `check:release`, run `audit:privacy`, and run the synchronized race soak.
5. Stop containers and remove orphans in a final cleanup while preserving the PostgreSQL volume.

The soak reads `GOLDEN_SOAK_RUNS`, accepts 1 through 100, and defaults to **100** when it is unset. Push and pull-request CI skips the soak; a manual workflow run can enable its ten-scenario version with the `run_soak` input. To shorten a local rehearsal in PowerShell:

```powershell
$env:GOLDEN_SOAK_RUNS = "10"
pnpm release:rehearsal
Remove-Item Env:GOLDEN_SOAK_RUNS
```

Phase 10's recorded G10 evidence includes the full release gate, two browser rehearsals, the concurrent race and worker recovery matrix, a 10-run CI repetition, and a separate 100-of-100 final soak. See [docs/phase-10-release.md](docs/phase-10-release.md) for the exact record.

## Original AnonLimit interface

The public frontend uses an Apple-inspired visual language while remaining an original AnonLimit interface. Its custom brand mark, conceptual three-use pass, product copy, responsive page composition, wallet states, and evidence panels are implemented in the repository without Apple branding or interface assets.

The visual system combines quiet system typography, generous spacing, monochrome surfaces, blue actions, and explicit semantic states. Keyboard navigation, visible focus, reduced-motion handling, live status text, and narrow-screen layouts are part of the design contract. See [docs/frontend-design.md](docs/frontend-design.md) before changing the public experience.

## Workspace

| Location                 | Responsibility                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `apps/web`               | React/Vite holder wallet and guided evidence experience.                               |
| `apps/api`               | Fastify issuance, verification, evidence, events, audit, demo-fault, and reset routes. |
| `apps/worker`            | Private leased outbox delivery and atomic receipt completion.                          |
| `apps/action-simulator`  | Private idempotent action, reset, and sanitized evidence service.                      |
| `packages/contracts`     | Strict public and internal schemas plus safe-field allowlists.                         |
| `packages/domain`        | Policy, canonicalization, retry, state, key, and evidence rules.                       |
| `packages/crypto`        | Browser holder and server-side simulated opaque-provider adapters.                     |
| `packages/db`            | Role-specific repositories, durable acceptance, evidence views, seeds, and migrations. |
| `packages/config`        | Separate validated browser and server configuration.                                   |
| `packages/observability` | Log-field allowlists, including child logger bindings.                                 |
| `packages/testing`       | Test-only fixtures, scanners, synchronization, and golden scenarios.                   |

## Documentation

- [Getting started](docs/getting-started.md)
- [Frontend design](docs/frontend-design.md)
- [Demo narration](docs/demo-script.md)
- [Phase 10 release record](docs/phase-10-release.md)
- [Threat model and limitations](docs/threat-model.md)
- [Architecture](architecture.md)
- [Product requirements](prd.md)
- [Implementation phases](phases.md)
- [Protocol rules](rules.md)

## Security boundary

AnonLimit uses a deterministic simulated opaque provider. It does not provide production zero-knowledge cryptography or prove that an issuer cannot recognize a holder. Production use requires reviewed cryptography, issuer-key management, administrator authentication, rate limiting, monitoring, TLS, and a defined pass-issuance policy. The [crypto boundary](packages/crypto/README.md) and [threat model](docs/threat-model.md) describe these limitations in detail.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, privacy guardrails, validation commands, and pull-request expectations.
