# Test scope

The suites grow with the phase that introduces each behavior. Empty suites fail; they are never recorded as passing gates.

| Command                 | Current coverage                                                                           | Prerequisites                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `pnpm test:unit`        | 23 configuration and API/action health tests                                               | Built shared packages (`pnpm build:packages`)                           |
| `pnpm test:privacy`     | 18 production/browser import, configuration access, logging, and browser asset checks      | `pnpm build`; generated local secrets are scanned when `.env` exists    |
| `pnpm test:integration` | 2 PostgreSQL 17, migration-shell, schema/role isolation, and default table privilege tests | Running Compose stack with generated default local database/owner names |
| `pnpm test:e2e`         | Real API readiness, check/recheck, network failure and recovery, desktop/mobile layout     | Running Compose stack and Playwright Chromium                           |
| `pnpm test:contract`    | Reserved for the Phase 2 opaque-adapter contract                                           | Not implemented; currently fails as empty                               |

Database permission probes create tables inside a rolled-back transaction. The browser test first connects to the real backend, then explicitly simulates a failed network request to verify the unavailable state before reconnecting. Screenshots are written to ignored `test-results/`.

These are foundation checks. Durable acceptance, idempotency, bounded use, wallet persistence, and full storage/runtime privacy scenarios remain required in their later phases. The Phase 1 browser check is not the P0 golden scenario.
