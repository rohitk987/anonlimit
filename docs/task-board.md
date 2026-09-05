# AnonLimit phase board

| Phase                                                | Depends on              | Gate                                        | Status                                                                                               | Owner                             |
| ---------------------------------------------------- | ----------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------- |
| Phase 0 — scope lock                                 | Source specifications   | Kickoff decisions and prerequisite evidence | Complete: scope, Node 24, pnpm, Docker engine, and PostgreSQL 17 SQL verified                        | Codex integration captain         |
| Phase 1 — repository and runtime foundation          | Phase 0                 | G1 Foundation                               | Complete: G1 static, runtime, database, privacy, and browser checks passed                           | Codex integration captain         |
| Phase 2 — protocol kernel and opaque crypto contract | G1                      | G2 Contract freeze                          | Complete: strict contracts, pure domain rules, adapter and privacy gates passed                      | Codex protocol/API lane           |
| Phase 3 — database foundation and durable acceptance | G2                      | G3 Durable acceptance                       | Complete: durable HTTP acceptance, transactional outbox, migrations, privacy, and race checks passed | Codex protocol + data lanes       |
| Phase 4 — first complete end-to-end use              | G3                      | G4 One-use milestone                        | Not started                                                                                          | Codex data + wallet lanes         |
| Phase 5 — lost acknowledgement and exact retry       | G4                      | G5 Retry safety                             | Not started                                                                                          | Codex protocol + wallet lanes     |
| Phase 6 — exact bound, rejection, and reset          | G5                      | G6 Backend P0                               | Not started                                                                                          | Codex protocol/API lane           |
| Phase 7 — authoritative evidence and privacy         | G6                      | G7 Evidence P0                              | Not started                                                                                          | Codex QA/privacy lane             |
| Phase 8 — guided judge experience and P0 lock        | G7                      | G8 P0 lock                                  | Not started                                                                                          | Codex wallet/UI + QA lanes        |
| Phase 9 — optional concurrency and crash recovery    | G8                      | G9 Full resilience                          | Deferred until P0 is stable; required for full project                                               | Codex data/reliability + QA lanes |
| Phase 10 — release, packaging, and rehearsal         | G8; G9 for full project | G10 Submission                              | Not started                                                                                          | Codex integration captain         |

The integration captain owns root configuration and gate results. These lanes are responsibilities of the current single implementation owner, not additional human contributors. Assign explicit file ownership before parallel implementation. Optional work may not begin before the P0 gates are stable, and P2 is excluded from the hackathon.

See [Phase 0 kickoff](phase-0-kickoff.md) for the default policy, golden scenario, setup commands, source decisions, and actual readiness evidence. Completion of a planning row does not certify later product behavior.

## Next phase handoff

Phase 3 is complete. See [the Phase 3 record](phase-3-durable-acceptance.md) for the verified database, HTTP, transaction, privacy, and concurrency behavior. The next implementation phase is **Phase 4 — first complete end-to-end use**.

1. Add `POST /internal/v1/actions` to the Action Simulator with service-token authentication, action-key idempotency, and payload-digest conflict handling.
2. Have the worker claim outbox rows with bounded `FOR UPDATE SKIP LOCKED` leases, commit the lease before delivery, and send only the allowlisted action envelope.
3. Persist the terminal receipt or final failure and append the matching safe event atomically with the use and outbox update.
4. Implement the browser IndexedDB wallet, real issuance/challenge/presentation calls, and one complete receipt flow through Docker Compose.
5. Prove one stable receipt and one external effect under a repeatable end-to-end test before beginning lost-ack recovery.

Lost-ack recovery, the three-use bound, evidence, and the guided judge flow remain later phases.
