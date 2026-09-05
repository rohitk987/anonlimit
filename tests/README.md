# Test scope

The suites grow with the phase that introduces each behavior. Empty suites fail; they are never recorded as passing gates.

| Command                 | Current coverage                                                                                                                            | Prerequisites                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `pnpm test:unit`        | 297 foundation, contracts, canonicalization, policy, state/retry, evidence, fault/wait, serializer, reset, scanner, and schema-parity tests | Built shared packages (`pnpm build:packages`)                        |
| `pnpm test:privacy`     | 24 production/browser import, crypto export, configuration, logging, schema, and browser asset checks                                       | `pnpm build`; generated local secrets are scanned when `.env` exists |
| `pnpm test:integration` | 32 PostgreSQL 17 migration, role/isolation, acceptance, action delivery, lost-ack, retry, reset, evidence, and readiness tests              | Docker engine; live role checks use the running Compose stack        |
| `pnpm test:e2e`         | 3 browser scenarios covering durable lost-ack recovery, stored resend as first arrival, and expired-unaccepted proof rebuild                | Running Compose stack and Playwright Chromium                        |
| `pnpm test:contract`    | 9 positive and adversarial opaque simulated-provider contract scenarios                                                                     | Built contracts, domain, and crypto packages                         |

Database permission probes create tables inside a rolled-back transaction. The browser test connects to the real Compose stack and uses the server's durable one-shot acknowledgement fault; screenshots and traces are written to ignored `test-results/` only on failure.

`pnpm check:phase7` runs the cumulative Phase 7 gate: formatting, lint, strict type checking, all package and app builds, 297 unit tests, 9 opaque-provider contract tests, 30 isolated PostgreSQL acceptance/delivery/recovery/evidence tests, 24 privacy tests, and the generated browser asset scan. The full `pnpm test:integration` command adds the two live foundation role/readiness tests for 32 integration tests total. The dedicated Phase 6 scenario still runs the reusable headless flow twice, including a server-owned reset, three durable uses, lost-ack recovery, a private boundary proof, and a no-mutation fourth rejection. Phase 7 adds backend-derived evidence, safe event replay, transient linkability audit handling, and forbidden-data scanning. Playwright still verifies the three visible wallet recovery paths; the guided judge experience is Phase 8 work.
