import type { AuditSummary, InsightsReport } from "@anonlimit/contracts";
import type { InsightsState } from "./use-insights.js";

const findingLabels: Record<AuditSummary["findings"][number]["id"], string> = {
  boundedUse: "Three-use limit",
  retryIdempotency: "Safe retry",
  overLimitRejected: "Fourth use blocked",
  noStableIdentity: "Identity storage check",
  distinctUseUnlinkability: "Separate uses stay unlinkable",
};

function FindingStatus({ status }: { readonly status: AuditSummary["status"] }) {
  const labels = { PASS: "Pass", FAIL: "Fail", NOT_RUN: "Not run yet", INCOMPLETE: "Incomplete" };
  return <span className={`status status-${status.toLowerCase()}`}>{labels[status]}</span>;
}

function AiCommentary({ ai }: { readonly ai: InsightsReport["ai"] }) {
  return (
    <section className="insights-ai" data-testid="insights-ai" aria-labelledby="insights-ai-title">
      <div className="insights-row">
        <h3 id="insights-ai-title">Optional AI explanation</h3>
        <span className="insights-label">{ai.status}</span>
      </div>
      {ai.status === "READY" && ai.commentary ? (
        <>
          <p>{ai.commentary.summary}</p>
          <p>{ai.commentary.abuseExplanation}</p>
          <p className="muted">
            AI commentary is advisory. The measured findings above are authoritative.
          </p>
        </>
      ) : (
        <p className="muted">
          {ai.status === "DISABLED"
            ? "AI narration is not configured. The automatic audit and signal checks work without it."
            : ai.status === "WAITING"
              ? "AI narration is waiting for analysis. The measured findings are available above."
              : "AI narration is temporarily unavailable. The measured findings are available above."}
        </p>
      )}
    </section>
  );
}

export function InsightsPanel({ report, status }: InsightsState) {
  const reportReady = status === "READY" && report !== null;
  return (
    <section className="panel insights-panel" aria-labelledby="insights-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">AUTOMATIC ANALYSIS</p>
          <h2 id="insights-title">Understand the evidence.</h2>
        </div>
        <span className="insights-label" data-testid="insights-status" aria-live="polite">
          {status === "READY" ? "Live · updates every 5s" : status}
        </span>
      </div>
      <p className="muted">
        Read-only analysis of this demo run. Findings come from backend evidence; signals flag
        activity for review and never decide whether a view is accepted.
      </p>
      {!reportReady ? (
        <p className="insights-empty" aria-live="polite" data-testid="insights-summary-status">
          {status === "UNAVAILABLE"
            ? "Analysis unavailable. Retrying automatically; previous results are hidden."
            : status === "LOADING"
              ? "Loading the current run’s audit summary and aggregate signals…"
              : "Waiting for current backend evidence. Results will appear when the run is ready."}
        </p>
      ) : (
        <>
          <div className="insights-grid">
            <section data-testid="insights-summary" aria-labelledby="insights-summary-title">
              <div className="insights-row">
                <h3 id="insights-summary-title">Automatic audit summary</h3>
                <span data-testid="insights-summary-status">
                  <FindingStatus status={report.summary.status} />
                </span>
              </div>
              <p className="insights-headline">{report.summary.headline}</p>
              <ul className="insights-findings">
                {report.summary.findings.map((finding) => (
                  <li key={finding.id}>
                    <div className="insights-row">
                      <strong>{findingLabels[finding.id]}</strong>
                      <FindingStatus status={finding.status} />
                    </div>
                    <p>{finding.text}</p>
                  </li>
                ))}
              </ul>
              {report.summary.nextSteps.length > 0 && (
                <div className="insights-next">
                  <h4>What to do next</h4>
                  <ol>
                    {report.summary.nextSteps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </div>
              )}
            </section>
            <section data-testid="insights-abuse" aria-labelledby="insights-abuse-title">
              <div className="insights-row">
                <h3 id="insights-abuse-title">Aggregate abuse signals</h3>
                <span
                  className={`insights-level insights-level-${report.abuse.level.toLowerCase()}`}
                >
                  {report.abuse.level === "REVIEW"
                    ? "Review activity"
                    : report.abuse.level === "QUIET"
                      ? "Quiet"
                      : "No activity"}
                </span>
              </div>
              <p className="muted">Last {report.abuse.windowSeconds} seconds · current demo run</p>
              <dl className="insights-counters">
                {(
                  [
                    ["Attempts", report.abuse.counters.attempts],
                    ["Accepted", report.abuse.counters.accepted],
                    ["Rejected", report.abuse.counters.rejected],
                    ["Conflicts", report.abuse.counters.conflicts],
                    ["Retries", report.abuse.counters.retries],
                    ["Over-limit", report.abuse.counters.overLimit],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              {report.abuse.signals.length > 0 ? (
                <ul className="insights-signals">
                  {report.abuse.signals.map((signal) => (
                    <li key={signal.code}>
                      <strong>{signal.code.toLowerCase().replaceAll("_", " ")}</strong>
                      <p>{signal.explanation}</p>
                      <span className="muted">
                        Observed {signal.observed} · review threshold {signal.threshold}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="insights-empty">
                  {report.abuse.level === "NO_ACTIVITY"
                    ? "No presentation activity in this window. Run the guided demo to collect signals."
                    : "No review thresholds reached. This does not prove that all activity is legitimate."}
                </p>
              )}
              <p className="insights-scope">
                These totals cannot identify a person or link different allowed uses. Retries can be
                legitimate recovery; a signal is a reason to review, not proof of abuse.
              </p>
            </section>
          </div>
          <AiCommentary ai={report.ai} />
          <p className="insights-timestamp muted">
            Snapshot:{" "}
            <time dateTime={report.generatedAt}>
              {new Date(report.generatedAt).toLocaleTimeString()}
            </time>
            {" · "}Rules v1 · cryptographic unlinkability is simulated.
          </p>
        </>
      )}
    </section>
  );
}
