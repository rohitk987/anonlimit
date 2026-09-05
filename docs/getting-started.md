# Getting started with AnonLimit

This guide takes a clean checkout to the working Demo Lab at `http://localhost:5173`. AnonLimit runs locally as a browser wallet, API, worker, private Action Simulator, and PostgreSQL database.

## Prerequisites

Install these versions before continuing:

- Node.js 24.x;
- pnpm 11.19.0; and
- Docker Desktop or Docker Engine with Docker Compose and Linux containers.

Confirm the tools from a terminal:

```powershell
node --version
pnpm --version
docker version
docker compose version
```

The workspace rejects unsupported Node and pnpm major versions. Make sure the Docker engine is running before starting the stack.

## Clone and install

```powershell
git clone https://github.com/rohitk987/anonlimit.git
cd anonlimit
pnpm install --frozen-lockfile
pnpm setup:env
```

`pnpm setup:env` creates `.env` and local issuer material with random development values. Run it once for a new checkout. It refuses to overwrite an existing `.env`; the committed [`.env.example`](../.env.example) documents the available settings without containing usable secrets.

Keep the generated `.env` and `secrets/` directory private. The database roles are initialized from those values when PostgreSQL creates an empty volume, so keep the same generated configuration with that volume.

## Build and start

All application services share one local image. Build it once through the API service, then tell Compose to reuse it for the complete stack:

```powershell
docker compose config --quiet
docker compose build api
docker compose up -d --no-build --wait --wait-timeout 120
pnpm wait:services
```

A successful startup reports `Services ready: api, web`. `docker compose ps -a` should show PostgreSQL, API, worker, Action Simulator, and web as healthy; the one-time migration and seed jobs should have exited successfully.

Open [http://localhost:5173](http://localhost:5173). Use `localhost`, rather than another loopback spelling, because the generated browser and API origin settings use that hostname. The API health endpoints are available at [http://localhost:4000/health/live](http://localhost:4000/health/live) and [http://localhost:4000/health/ready](http://localhost:4000/health/ready).

For active development, `pnpm dev` builds and runs the Compose stack in the foreground. Restart it to rebuild after source changes. `pnpm dev:apps` is intended for developers who separately provide host-reachable database and service URLs; the generated Compose hostnames do not resolve from host processes.

## Run the guided demo

The Demo Lab uses real protocol requests and backend-derived evidence. Follow this sequence:

1. Select **Reset demo run**, then **Issue anonymous pass**.
2. Select **Use next slot** and wait for the first committed receipt.
3. Select **Drop next acknowledgement**, then **Use next slot**. The action commits while the browser keeps an unknown outcome.
4. Refresh the page if you want to demonstrate recovery, then select **Retry last request**. The exact stored request recovers the original receipt with zero additional use or action.
5. Select **Use next slot** for the third accepted use.
6. Select **Attempt fourth use**. The authenticated simulator probe must be rejected without changing the committed counts.
7. Select **Run privacy audit** and inspect the verifier evidence, safe event trace, invariant checks, and linkability matrix.

The wallet card shows browser-local state from IndexedDB. The evidence panels show the server's authoritative, sanitized view. A full presentation script is in [demo-script.md](demo-script.md).

## Stop or reset

Stop the containers when you finish:

```powershell
docker compose down --remove-orphans
```

This preserves the named PostgreSQL volume. Use **Reset demo run** in the interface, or run `pnpm demo:reset`, to clear only the active demonstration run through the server-owned reset flow.

## Verify the workspace

Start the Compose stack before integration or browser checks.

Useful focused checks include:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:privacy
pnpm build
pnpm audit:privacy
```

Install Chromium once before running browser tests or the release rehearsal on a clean host:

```powershell
pnpm exec playwright install chromium
pnpm test:e2e
```

`pnpm check:release` runs the complete formatting, lint, type, unit, contract, integration, privacy-test, build, and browser gate. The bundle privacy scan remains a separate `pnpm audit:privacy` command.

For the complete local release sequence, run:

```powershell
pnpm release:rehearsal
```

The rehearsal validates Compose, builds the shared application image once, starts with `--no-build`, waits for readiness, runs `check:release`, runs `audit:privacy`, performs the synchronized race soak, and cleans up even after a failure. `GOLDEN_SOAK_RUNS` defaults to 100; set a value from 1 through 100 only when you intentionally want a shorter run:

```powershell
$env:GOLDEN_SOAK_RUNS = "10"
pnpm release:rehearsal
Remove-Item Env:GOLDEN_SOAK_RUNS
```

CI uses 10 repetitions. The default local rehearsal uses the 100-run release soak. See the [Phase 10 release record](phase-10-release.md) for the release evidence and [threat-model.md](threat-model.md) for the security and privacy boundary.

## Troubleshooting

- **Docker cannot connect:** start Docker and confirm `docker version` shows a responsive server.
- **A service is unhealthy:** run `docker compose ps -a` and inspect the relevant sanitized logs with `docker compose logs api worker web action-simulator`.
- **The browser reports the API unavailable:** open the readiness endpoint, confirm both ports are free, and use the `localhost` URL shown above.
- **The wallet belongs to an earlier run:** select **Reset demo run**. The browser clears its local wallet only after the server reset succeeds.
- **Browser tests cannot launch:** rerun `pnpm exec playwright install chromium`.
- **Install or checks use the wrong runtime:** switch to Node 24 and pnpm 11.19.0, then rerun the command.
