# Test scope

The suites grow with the phase that introduces each behavior. Empty suites fail; they are never recorded as passing gates.

| Command                 | Current coverage                                                                                                                   | Prerequisites                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `pnpm test:unit`        | 292 foundation, contracts, canonicalization, policy, state/retry, evidence, fault/wait, serializer, reset, and schema-parity tests | Built shared packages (`pnpm build:packages`)                        |
| `pnpm test:privacy`     | 24 production/browser import, crypto export, configuration, logging, schema, and browser asset checks                              | `pnpm build`; generated local secrets are scanned when `.env` exists |
| `pnpm test:integration` | 33 PostgreSQL 17 migration, role/isolation, acceptance, action delivery, lost-ack, retry, reset, and readiness tests               | Docker engine; live role checks use the running Compose stack        |
| `pnpm test:e2e`         | 3 browser scenarios covering durable lost-ack recovery, stored resend as first arrival, and expired-unaccepted proof rebuild       | Running Compose stack and Playwright Chromium                        |
| `pnpm test:contract`    | 8 positive and adversarial opaque simulated-provider contract scenarios                                                            | Built contracts, domain, and crypto packages                         |

Database permission probes create tables inside a rolled-back transaction. The browser test connects to the real Compose stack and uses the server's durable one-shot acknowledgement fault; screenshots and traces are written to ignored `test-results/` only on failure.

`pnpm check:phase6` runs the cumulative Phase 6 gate: formatting, lint, strict type checking, all package and app builds, 292 unit tests, 9 opaque-provider contract tests, 33 isolated PostgreSQL acceptance/delivery/recovery/reset tests, and 24 privacy tests. The dedicated Phase 6 scenario runs the reusable headless flow twice, including a server-owned reset, three durable uses, lost-ack recovery, a private boundary proof, and a no-mutation fourth rejection. Playwright still verifies the three visible wallet recovery paths; the guided evidence experience is Phase 7–8 work.
