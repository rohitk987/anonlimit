# AnonLimit: a 2½-minute demonstration

Open the local Demo Lab at `http://localhost:5173`. Keep the controls and backend evidence visible. This narration accompanies real commands; pause for their text status before continuing.

| Time      | Action and narration                                                                                                                                                                                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:20 | “Imagine a website offering three free article views. We want to limit an anonymous pass without making a user account or linking its separate uses. This demo tests that boundary, plus recovery when the network fails.”                                                                                          |
| 0:20–0:35 | Click **Reset evaluation**. Show zero committed uses and external actions. Click **Issue a 3-view anonymous pass**. “The pass lives in this browser's IndexedDB wallet. Its three local slots are holder knowledge; the server evidence is a separate view.”                                                        |
| 0:35–0:55 | Click **View next article**. Wait for the stored receipt and one external action. “One accepted use creates durable recovery work. An independent action service commits the benefit and returns a stable receipt.”                                                                                                 |
| 0:55–1:20 | Click **Simulate a lost response**, then **View next article**. “The second action commits, but its response is deliberately lost. The server now shows two actions. The wallet says outcome unknown and keeps its pending request.” Refresh once. “The pending request survives.”                                  |
| 1:20–1:40 | Click **Retry the same request**. “These are the same stored request bytes. We recover the original receipt. The backend stays at two uses and two actions; both retry deltas are zero.” Point out the distinct retry status.                                                                                       |
| 1:40–1:55 | Click **View next article** again. “The third allowed use succeeds. Now the pass's local allowance is exhausted.”                                                                                                                                                                                                   |
| 1:55–2:15 | Click **Prove the fourth view is blocked**. “This demo-only control sends an authenticated simulator probe at the forbidden boundary. The real verifier rejects it. No fourth use or action is committed.”                                                                                                          |
| 2:15–2:40 | Click **Run the privacy audit**. Show the pairwise matrix and invariant summary. “Distinct accepted uses are UNLINKABLE under this simulated provider. The exact retry is SAME_USE. That recognizes one operation without identifying the holder. All invariant results come from backend evidence and this audit.” |
| 2:40–2:50 | Point to the assumptions card. “This is a protocol and recovery demonstration, not production cryptography. The limit is per pass. A real deployment still needs an issuance policy to determine who can obtain another pass.”                                                                                      |

## Recovery during rehearsal

- An unknown outcome keeps the current slot reserved. Use **Retry the same request**.
- Evidence unavailable means the displayed snapshot may be stale. Restore local services and let the page reconnect; do not describe stale values as live.
- A failed or incomplete audit is not PASS. Complete the scenario, then rerun the audit. The pairwise matrix is ephemeral; after an API restart, rerun it from the browser wallet.
- Reset selects the active demo run on the server and clears this wallet only after server success. Other browsers may hold an earlier run's wallet; the UI asks them to reset.

The two automated Playwright rehearsals cover the same real path, independently query both durable ledgers, and enforce a limit of 180 seconds per run. Their observed timings are recorded in the Phase 8 completion record after verification.
