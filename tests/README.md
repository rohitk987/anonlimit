# Test scope

The suites grow with the phase that introduces each behavior. Empty suites fail; they are never recorded as passing gates.

| Command                 | Current coverage                                                                                | Prerequisites                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `pnpm test:unit`        | 270 foundation, contract, canonicalization, policy, state/retry, evidence, and serializer tests | Built shared packages (`pnpm build:packages`)                           |
| `pnpm test:privacy`     | 22 production/browser import, crypto export, configuration, logging, and browser asset checks   | `pnpm build`; generated local secrets are scanned when `.env` exists    |
| `pnpm test:integration` | 2 PostgreSQL 17, migration-shell, schema/role isolation, and default table privilege tests      | Running Compose stack with generated default local database/owner names |
| `pnpm test:e2e`         | Real API readiness, check/recheck, network failure and recovery, desktop/mobile layout          | Running Compose stack and Playwright Chromium                           |
| `pnpm test:contract`    | 8 positive and adversarial opaque simulated-provider contract scenarios                         | Built contracts, domain, and crypto packages                            |

Database permission probes create tables inside a rolled-back transaction. The browser test first connects to the real backend, then explicitly simulates a failed network request to verify the unavailable state before reconnecting. Screenshots are written to ignored `test-results/`.

`pnpm check:protocol` runs the complete G2 static, unit, contract, build, and privacy gate. Durable acceptance, database idempotency, wallet persistence, and full storage/runtime privacy scenarios remain required in their later phases. The existing browser check is not the P0 golden scenario.
