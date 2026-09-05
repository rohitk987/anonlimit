# AnonLimit phase board

| Phase                                                | Depends on              | Gate                                        | Status                                                                        | Owner                             |
| ---------------------------------------------------- | ----------------------- | ------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------- |
| Phase 0 — scope lock                                 | Source specifications   | Kickoff decisions and prerequisite evidence | Complete: scope, Node 24, pnpm, Docker engine, and PostgreSQL 17 SQL verified | Codex integration captain         |
| Phase 1 — repository and runtime foundation          | Phase 0                 | G1 Foundation                               | Complete: G1 static, runtime, database, privacy, and browser checks passed    | Codex integration captain         |
| Phase 2 — protocol kernel and opaque crypto contract | G1                      | G2 Contract freeze                          | Not started                                                                   | Codex protocol/API lane           |
| Phase 3 — database foundation and durable acceptance | G2                      | G3 Durable acceptance                       | Not started                                                                   | Codex protocol + data lanes       |
| Phase 4 — first complete end-to-end use              | G3                      | G4 One-use milestone                        | Not started                                                                   | Codex data + wallet lanes         |
| Phase 5 — lost acknowledgement and exact retry       | G4                      | G5 Retry safety                             | Not started                                                                   | Codex protocol + wallet lanes     |
| Phase 6 — exact bound, rejection, and reset          | G5                      | G6 Backend P0                               | Not started                                                                   | Codex protocol/API lane           |
| Phase 7 — authoritative evidence and privacy         | G6                      | G7 Evidence P0                              | Not started                                                                   | Codex QA/privacy lane             |
| Phase 8 — guided judge experience and P0 lock        | G7                      | G8 P0 lock                                  | Not started                                                                   | Codex wallet/UI + QA lanes        |
| Phase 9 — optional concurrency and crash recovery    | G8                      | G9 Full resilience                          | Deferred until P0 is stable; required for full project                        | Codex data/reliability + QA lanes |
| Phase 10 — release, packaging, and rehearsal         | G8; G9 for full project | G10 Submission                              | Not started                                                                   | Codex integration captain         |

The integration captain owns root configuration and gate results. These lanes are responsibilities of the current single implementation owner, not additional human contributors. Assign explicit file ownership before parallel implementation. Optional work may not begin before the P0 gates are stable, and P2 is excluded from the hackathon.

See [Phase 0 kickoff](phase-0-kickoff.md) for the default policy, golden scenario, setup commands, source decisions, and actual readiness evidence. Completion of a planning row does not certify later product behavior.

## Next phase handoff

Phase 1 is complete. See [the foundation record](phase-1-foundation.md) for actual verification and implementation limitations. The next implementation phase is **Phase 2 — protocol kernel and opaque crypto contract**.

1. Recheck current Git/runtime state and read the Phase 2 requirements.
2. Freeze protocol contracts and implement pure domain rules.
3. Implement the opaque simulated crypto interfaces behind separate holder/issuer/verifier/audit exports.
4. Add positive and adversarial adapter contracts and pass G2 while preserving G1.

No wallet, use acceptance, retry, receipt, or evidence behavior is implemented yet.
