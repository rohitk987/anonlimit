# AnonLimit phase board

| Phase                                                | Depends on              | Gate                                        | Status                                                                                                     | Owner                             |
| ---------------------------------------------------- | ----------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Phase 0 — scope lock                                 | Source specifications   | Kickoff decisions and prerequisite evidence | Complete: scope, Node 24, pnpm, Docker engine, and PostgreSQL 17 SQL verified                              | Codex integration captain         |
| Phase 1 — repository and runtime foundation          | Phase 0                 | G1 Foundation                               | Complete: G1 static, runtime, database, privacy, and browser checks passed                                 | Codex integration captain         |
| Phase 2 — protocol kernel and opaque crypto contract | G1                      | G2 Contract freeze                          | Complete: strict contracts, pure domain rules, adapter and privacy gates passed                            | Codex protocol/API lane           |
| Phase 3 — database foundation and durable acceptance | G2                      | G3 Durable acceptance                       | Complete: durable HTTP acceptance, transactional outbox, migrations, privacy, and race checks passed       | Codex protocol + data lanes       |
| Phase 4 — first complete end-to-end use              | G3                      | G4 One-use milestone                        | Complete: one browser use reached one durable external receipt; action and worker idempotency verified     | Codex data + wallet lanes         |
| Phase 5 — lost acknowledgement and exact retry       | G4                      | G5 Retry safety                             | Complete: durable lost-ack fault and byte-identical exact retry passed with zero extra deltas              | Codex protocol + wallet lanes     |
| Phase 6 — exact bound, rejection, and reset          | G5                      | G6 Backend P0                               | Complete: three uses, safe retry, fourth rejection, and scoped reset passed                                | Codex protocol/API lane           |
| Phase 7 — authoritative evidence and privacy         | G6                      | G7 Evidence P0                              | Complete: backend-derived evidence, safe events/SSE, transient linkability audit, and privacy scans passed | Codex QA/privacy lane             |
| Phase 8 — guided judge experience and P0 lock        | G7                      | G8 P0 lock                                  | Not started                                                                                                | Codex wallet/UI + QA lanes        |
| Phase 9 — optional concurrency and crash recovery    | G8                      | G9 Full resilience                          | Deferred until P0 is stable; required for full project                                                     | Codex data/reliability + QA lanes |
| Phase 10 — release, packaging, and rehearsal         | G8; G9 for full project | G10 Submission                              | Not started                                                                                                | Codex integration captain         |

The integration captain owns root configuration and gate results. These lanes are responsibilities of the current single implementation owner, not additional human contributors. Assign explicit file ownership before parallel implementation. Optional work may not begin before the P0 gates are stable, and P2 is excluded from the hackathon.

See [Phase 0 kickoff](phase-0-kickoff.md) for the default policy, golden scenario, setup commands, source decisions, and actual readiness evidence. Completion of a planning row does not certify later product behavior.

## Phase 7 result

Phase 7 is complete. See [the Phase 7 record](phase-7-evidence-privacy.md) for the sanitized verifier and Action Simulator evidence boundary, invariant report, replayable event stream, transient linkability audit, and privacy scans. G7 passed with strict backend-derived measurements and explicit `INCOMPLETE` handling when audit data is unavailable. The next implementation phase is **Phase 8 — guided judge experience and P0 lock**.

1. Connect Demo Lab metrics to `GET /v1/demo/evidence`.
2. Render safe events from `/v1/demo/events/stream` with reconnect cursors.
3. Present the linkability matrix and privacy assumptions clearly.

## Phase 6 result

Phase 6 is complete. See [the Phase 6 record](phase-6-bound-reset.md) for the run-scoped reset, controlled boundary proof, and G6 evidence. Phase 7 has completed the authoritative evidence and privacy boundary; the next implementation phase is **Phase 8 — guided judge experience and P0 lock**.

The guided judge flow remains Phase 8.
