# Automatic audit summaries and abuse signals

The Demo Lab automatically explains the current run and flags unusual aggregate activity. Open the **Understand the evidence** panel above the existing backend results. No extra button is required: it refreshes every five seconds while the demo is idle. Run the existing guided sequence to see the summary progress from incomplete to passing.

## What is implemented

- A deterministic summary preserves the backend's actual overall status, counts, and five key findings: bound, safe retry, over-limit rejection, identity-storage check, and simulated unlinkability. Missing evidence remains `NOT_RUN` or `INCOMPLETE`; it is never substituted with zero or a pass.
- Rules flag aggregate request bursts, generic rejections, conflicting replays, repeated retries, and repeated over-limit probes. They are advisory and do not change acceptance, slots, receipts, or database records.
- An optional OpenAI adapter explains the measured outcome and activity signals in prose. AI commentary is visibly separate from authoritative facts. It cannot call tools, block visitors, alter quotas, or run verification.

Local summaries and threshold checks are **rules-based automation**, not a trained AI detector. AI wording is available only when explicitly configured. The current local configuration keeps it disabled.

## API and data flow

`GET /v1/demo/insights` is available only with `DEMO_MODE=true`. It accepts no query parameters or client-selected run. Responses use `Cache-Control: no-store` and the strict `insightsReportSchema` contract.

```text
Verifier snapshot + independent action evidence
  -> existing measured invariants
  -> summary + last-minute aggregate activity
  -> optional aggregate-only model explanation
  -> Demo Lab
```

The event analysis uses the same verifier snapshot as the measured evidence. The browser checks the run ID, cancels obsolete requests, hides results during actions/reset, and removes stale reports on failed polling. A reset cannot inherit a completed audit from the previous run. AI latency and failures do not block the existing evidence endpoint or protocol commands.

The privacy count describes the existing verifier schema inspection for prohibited identity columns. It does not certify every system, log, or arbitrary stored value. The separate privacy test suite remains necessary. Unlinkability still rests on the simulated crypto contract.

## Activity rules

Only persisted decision events are counted, once per request trace, in the rolling interval `(snapshot time − 60 seconds, snapshot time]`. The trace is used transiently for deduplication and is not present in the resulting activity report or AI input. Events from other runs, the future, or outside the window are excluded.

| Signal                   | Review threshold within 60 seconds |
| ------------------------ | ---------------------------------- |
| Request burst            | 30 observed presentation decisions |
| Generic rejection burst  | 5 generic presentation rejections  |
| Conflicting replays      | 3 conflicting decisions            |
| Retry burst              | 10 exact retry decisions           |
| Repeated boundary probes | 3 over-limit decisions             |

Accepted, generic rejected, conflicts, retries, and over-limit counters are disjoint and sum to attempts. Lifecycle events such as action completion, acknowledgement loss, and receipt storage do not inflate request counts. A specific conflict or boundary diagnostic takes precedence over a generic rejection for the same trace.

These are observed protocol decisions, **not all HTTP requests**: malformed requests rejected before a persisted event are outside this report. Counts are for the active demo run as a whole, never per person, browser, or credential. Multiple evaluators can contribute to them. A quiet window does not prove the absence of abuse. A retry burst can be legitimate recovery or an intentional concurrency test; a normal three-use scenario with one retry and one boundary probe stays quiet.

## Enable optional AI commentary

Keep the API key in the ignored root `.env`, exclusively on the API server:

```dotenv
ANONLIMIT_AI_ENABLED=true
OPENAI_API_KEY=<your-server-side-key>
ANONLIMIT_AI_MODEL=<a-model-available-to-your-project-with-structured-outputs>
```

The enabled configuration requires both key and model. No model is silently selected. Then recreate the API after building the current source:

```sh
docker compose build api
docker compose up -d --no-build api web
```

Do not put this key in a `VITE_` variable, browser storage, documentation, or Git. Set `ANONLIMIT_AI_ENABLED=false` and recreate the API to return to local-only operation.

The adapter uses the [Responses API's structured output format](https://developers.openai.com/api/docs/guides/structured-outputs) to request two short commentary fields. It sends only explicitly selected numeric counts, check statuses, known signal codes, and thresholds. No run/trace/use/receipt identifiers, timestamps, raw events, proofs, nullifiers, wallet contents, names, email, IP addresses, browser fingerprints, or user-authored prose enter the request. `store: false` disables response storage; this setting alone is not a promise of zero provider retention.

Generation is eligible when the measured summary passes or fails, or an activity signal needs review. The adapter enforces an eight-second timeout, a 32 KiB response cap, strict output validation, one concurrent call, a sixty-second minimum between attempts, and at most eight attempts per rolling hour per API process. Failures count toward the limits. Identical facts reuse a bounded in-memory cache; reset runs have separate local cache keys. Restarting or multiplying API processes resets/multiplies these process-local limits, so production cost controls require a shared budget.

| AI status     | Meaning                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------- |
| `DISABLED`    | Local analysis only; no external model call                                                    |
| `WAITING`     | More evidence is needed, another call is running, or the call budget is cooling down           |
| `READY`       | Validated AI commentary is available; the text can still be inaccurate                         |
| `UNAVAILABLE` | Timeout, refusal, invalid output, or provider/network failure; measured facts remain available |

Provider errors and response bodies are not logged or shown to visitors. AI prose is rendered as text, with no HTML interpretation. Neither AI nor local signal rules write protocol state.

## Validation

Focused coverage lives in `tests/unit/insights-analysis.test.ts`, `insights-ai.test.ts`, `insights-routes.test.ts`, and `evidence-runtime.test.ts`. It covers thresholds, run/window boundaries, request deduplication, incomplete/failed evidence, zero mutation, outbound redaction, cache/coalescing, provider failures, timeout, call budget, and demo-only route behavior. The real browser golden rehearsal checks that the summary matches durable evidence and leaves the ledger unchanged.

AI adapter tests use a fake HTTP transport. A live paid model call is not part of the test suite, and the soak test is not needed for this feature.
