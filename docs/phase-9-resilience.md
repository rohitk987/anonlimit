# Phase 9 resilience record

Phase 9 adds deterministic distributed-systems checks around the stable P0 protocol. The reusable
golden driver can replace its normal third use with twenty identical copies of one fresh
presentation. A one-shot synchronization barrier releases every request together; the test requires
one new accepted use, one outbox event, one action, and one receipt, while the other nineteen callers
return the same pending use as exact replays.

The worker recovery matrix runs against real PostgreSQL 17 through Testcontainers and two separate
worker database connections. It proves that `FOR UPDATE SKIP LOCKED` gives one live lease, an expired
lease can be reclaimed, a worker exit before delivery leaves durable work, and a worker exit after an
external commit redelivers the same action key and receives the original receipt. It also verifies
bounded exponential retry and a visible `FAILED_FINAL`/`DEAD_LETTER` terminal state. The existing
Action Simulator integration test covers changed-payload integrity conflicts for the same action key.

## G9 verification

| Check                       | Result                                                                            |
| --------------------------- | --------------------------------------------------------------------------------- |
| Golden race variant         | Passed: 20 overlapping copies; one winner and 19 exact replays                    |
| Race ledger counts          | Passed: one additional use, outbox item, action key, external action, and receipt |
| Worker lease competition    | Passed: two workers never own the same live lease                                 |
| Expired lease recovery      | Passed: same event reclaimed with incremented attempt count                       |
| Crash before delivery       | Passed: durable event recovered and completed once                                |
| Crash after external commit | Passed: redelivery returned the original receipt; one action row remained         |
| Retry exhaustion            | Passed: bounded retry reached visible `DEAD_LETTER` and `FAILED_FINAL`            |
| Focused race repetition     | Passed: 10 consecutive `pnpm demo:golden:race` runs                               |
| Phase 9 integration command | 11 tests passed across the golden race, recovery matrix, and action idempotency   |
| Type and formatting checks  | Passed                                                                            |

The race and recovery tests are in [phase6-golden-scenario.test.ts](../tests/integration/phase6-golden-scenario.test.ts)
and [outbox-recovery.test.ts](../tests/integration/outbox-recovery.test.ts). Use
`pnpm demo:golden:race` for the focused race or `pnpm test:integration:phase9` for the complete
resilience slice.

G9 is complete. Phase 10 release packaging and rehearsal remain.
