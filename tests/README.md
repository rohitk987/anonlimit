# Test scope

The suites grow with the phase that introduces each behavior. Empty suites fail; they are never recorded as passing gates.

| Command                 | Current coverage                                                                                                             | Prerequisites                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `pnpm test:unit`        | 285 foundation, contracts, canonicalization, policy, state/retry, evidence, fault/wait, serializer, and schema-parity tests  | Built shared packages (`pnpm build:packages`)                        |
| `pnpm test:privacy`     | 24 production/browser import, crypto export, configuration, logging, schema, and browser asset checks                        | `pnpm build`; generated local secrets are scanned when `.env` exists |
| `pnpm test:integration` | 26 PostgreSQL 17 migration, role/isolation, acceptance, action delivery, lost-ack, retry, and readiness tests                | Docker engine; live role checks use the running Compose stack        |
| `pnpm test:e2e`         | 3 browser scenarios covering durable lost-ack recovery, stored resend as first arrival, and expired-unaccepted proof rebuild | Running Compose stack and Playwright Chromium                        |
| `pnpm test:contract`    | 8 positive and adversarial opaque simulated-provider contract scenarios                                                      | Built contracts, domain, and crypto packages                         |

Database permission probes create tables inside a rolled-back transaction. The browser test connects to the real Compose stack and uses the server's durable one-shot acknowledgement fault; screenshots and traces are written to ignored `test-results/` only on failure.

`pnpm check:phase5` runs the cumulative Phase 5 gate: formatting, lint, strict type checking, all package and app builds, 285 unit tests, 8 contract tests, 24 isolated PostgreSQL acceptance/delivery/recovery tests, and 24 privacy tests. The full integration command adds two live Compose role checks, bringing the integration total to 26. Playwright then verifies three visible wallet recovery paths, including byte-identical request replay and original receipt recovery. The three-use bound, bounded reset, authoritative evidence, and complete P0 golden scenario are Phase 6 and later.
