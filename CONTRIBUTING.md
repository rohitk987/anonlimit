# Contributing to AnonLimit

Thank you for helping improve AnonLimit. The project welcomes focused fixes, tests, documentation, and interface improvements that preserve its bounded-use and privacy guarantees.

The canonical repository is [github.com/rohitk987/anonlimit](https://github.com/rohitk987/anonlimit). Use [GitHub Issues](https://github.com/rohitk987/anonlimit/issues) for reproducible bugs and scoped proposals that contain no sensitive data.

## Set up the workspace

Use Node.js 24, pnpm 11.19.0, and Docker with Compose. Then follow the complete [getting-started guide](docs/getting-started.md), or run:

```powershell
git clone https://github.com/rohitk987/anonlimit.git
cd anonlimit
pnpm install --frozen-lockfile
pnpm setup:env
docker compose build api
docker compose up -d --no-build --wait --wait-timeout 120
pnpm wait:services
```

`pnpm setup:env` creates ignored local configuration and secret material. Never commit `.env`, `secrets/`, logs, database exports, browser wallet data, proofs, nullifiers, credentials, or authorization values.

## Make a focused change

Create a short-lived branch and keep each pull request centered on one problem. Before changing protocol behavior, read [prd.md](prd.md), [architecture.md](architecture.md), [rules.md](rules.md), and the relevant phase record under `docs/`. Those files define the invariants that implementation changes must preserve.

For frontend work, follow the [AnonLimit frontend design guide](docs/frontend-design.md). The current Apple-inspired visual language is an original AnonLimit interface: keep the custom identity, restrained hierarchy, responsive behavior, keyboard paths, visible focus, semantic status text, and reduced-motion support intact.

Do not add identity fields or credential-wide counters, persist raw proofs or nullifiers, expose private service routes, or treat browser counters as authoritative evidence. The simulated opaque crypto boundary must remain clearly labeled as a demonstration rather than production anonymity.

## Validate the change

Run the smallest relevant checks while iterating, then the cumulative gate appropriate to the change:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:privacy
pnpm build
```

Browser-flow changes also need Chromium and the end-to-end suite:

```powershell
pnpm exec playwright install chromium
pnpm test:e2e
```

`pnpm check:release` runs formatting, linting, type checks, unit, contract, integration, privacy, build, and browser tests. The generated-bundle and local-marker scan is separate:

```powershell
pnpm check:release
pnpm audit:privacy
```

For release-sensitive changes, `pnpm release:rehearsal` validates Compose, builds the shared application image once, starts the stack with `--no-build`, waits for readiness, runs the full release gate, runs the privacy audit and synchronized race soak, and always cleans up containers and orphans. The soak uses `GOLDEN_SOAK_RUNS`, which defaults to 100 and accepts values from 1 through 100. Push and pull-request CI skips the soak; a manual workflow run can enable its ten-scenario version with the `run_soak` input.

## Open a pull request

Open the pull request against the canonical repository and include:

- the concrete problem and resulting behavior;
- the protocol, privacy, or UI implications;
- the commands you ran and their results;
- screenshots for visible frontend changes, when useful; and
- any limitation or follow-up a reviewer must understand.

Keep generated output and local runtime state out of the commit. Confirm `git status` contains only the files you intended to change, and ensure documentation matches the behavior in the same pull request.
