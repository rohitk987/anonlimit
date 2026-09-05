# Test scope

The suites grow with the phase that introduces each behavior. Empty suites fail; they are never recorded as passing gates.

| Command                 | Current coverage                                                                                               | Prerequisites                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `pnpm test:unit`        | 277 foundation, contract, canonicalization, policy, state/retry, evidence, serializer, and schema-parity tests | Built shared packages (`pnpm build:packages`)                        |
| `pnpm test:privacy`     | 24 production/browser import, crypto export, configuration, logging, schema, and browser asset checks          | `pnpm build`; generated local secrets are scanned when `.env` exists |
| `pnpm test:integration` | 20 PostgreSQL 17 migration, role/isolation, durable acceptance, rollback, retry, race, and readiness tests     | Docker engine; live role checks use the running Compose stack        |
| `pnpm test:e2e`         | Real API readiness, check/recheck, network failure and recovery, desktop/mobile layout                         | Running Compose stack and Playwright Chromium                        |
| `pnpm test:contract`    | 8 positive and adversarial opaque simulated-provider contract scenarios                                        | Built contracts, domain, and crypto packages                         |

Database permission probes create tables inside a rolled-back transaction. The browser test first connects to the real backend, then explicitly simulates a failed network request to verify the unavailable state before reconnecting. Screenshots are written to ignored `test-results/`.

`pnpm check:phase3` runs the cumulative Phase 3 gate: formatting, lint, strict type checking, all package and app builds, 277 unit tests, 8 contract tests, 18 isolated PostgreSQL acceptance tests, and 24 privacy tests. The full integration command adds the two live Compose role checks, bringing the integration total to 20. The browser check is still a readiness and honest-unavailability flow; the wallet, worker delivery, receipt, three-use bound, and P0 golden scenario are Phase 4 and later.
