# AnonLimit threat model and limitations

AnonLimit is a bounded-use protocol demonstration. The protected asset is the right to perform at
most three actions for one issued anonymous pass. The system must also protect receipt integrity,
prevent duplicate external effects, and avoid persisting holder identity, credential-wide
identifiers, raw proofs, or raw nullifiers.

## Trust boundaries

- The browser wallet holds the opaque credential, hidden slot, raw nullifier, and exact retry bytes in
  IndexedDB. These values are intentionally outside verifier persistence and worker traffic.
- The API verifies the opaque presentation and challenge, derives protected lookup values in request
  memory, and commits usage and recovery work in one PostgreSQL transaction.
- PostgreSQL is authoritative for uniqueness, consumed challenges, outbox leases, receipts, and
  protocol evidence. Separate roles limit API, worker, and Action Simulator access.
- The worker is a private delivery process. It receives only an allowlisted action, protected keys,
  digests, and run/use references. The Action Simulator is a separate private destination that
  deduplicates by action key.

## Threats and mitigations

| Threat                                                  | Mitigation                                                                                                                                          |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| A caller submits the same presentation concurrently     | Named PostgreSQL uniqueness constraints, transaction rollback, and winner lookup converge every caller on one use.                                  |
| A worker exits before or after an external commit       | Durable outbox leases expire and are reclaimed; the Action Simulator returns the original receipt for the same action key.                          |
| A request times out and is retried                      | The exact operation, nullifier, and intent resolve the existing use before freshness checks; retry deltas stay zero.                                |
| A caller changes action content under an existing key   | The Action Simulator compares the payload digest and returns an integrity conflict.                                                                 |
| An over-limit proof is submitted                        | The opaque verifier rejects the authenticated boundary proof before acceptance; public output is the standard rejection with zero deltas.           |
| A service is restarted during a demo                    | Migrations and seed are short-lived Compose jobs; readiness gates application startup and the database remains authoritative.                       |
| Logs or evidence accidentally reveal sensitive material | Strict schemas, allowlisted serializers, masked references, outbox restrictions, browser-bundle checks, and the forbidden-data scanner fail closed. |
| A demo control is exposed in a normal deployment        | Demo-only routes require `DEMO_MODE=true`; the non-demo route suite verifies they are absent or rejected.                                           |

## Deliberate limitations

The repository uses a simulated opaque crypto provider for repeatable tests. It demonstrates protocol
boundaries and recovery behavior, not production zero-knowledge anonymity. A production deployment
must replace the provider with a reviewed cryptographic implementation, protect issuer keys with
operational key management, authenticate administrators, rate-limit abuse, monitor failures, and
define how new passes are issued.

The browser wallet is private to the browser profile, so clearing storage or moving to another
profile loses local recovery material. Server-side state still prevents a replay from creating a
second use when the exact operation values are available. A compromised browser can read its own
credential, and a compromised operator can observe operational metadata; this demonstration does
not claim protection against those endpoints.

The full release procedure is documented in [README.md](../README.md), [the demo script](demo-script.md),
and the cumulative requirements in [rules.md](../rules.md).
