import type { EvidenceReport, ProtocolEvent } from "@anonlimit/contracts";

interface EvidencePanelsProps {
  readonly evidence: EvidenceReport | null;
  readonly events: readonly ProtocolEvent[];
  readonly streamState: string;
}

const eventCopy: Record<ProtocolEvent["event"], string> = {
  CREDENTIAL_ISSUED: "Credential issued to wallet",
  PRESENTATION_RECEIVED: "Presentation received",
  PROOF_ACCEPTED: "Proof accepted",
  USE_ACCEPTED: "Use atomically reserved",
  ACTION_DISPATCH_STARTED: "Action dispatched",
  EXTERNAL_ACTION_COMMITTED: "External action committed",
  RECEIPT_STORED: "Receipt stored",
  ACK_DROPPED: "Acknowledgement intentionally dropped",
  RETRY_MATCHED: "Retry matched prior operation",
  CACHED_RECEIPT_RETURNED: "Cached receipt returned",
  NULLIFIER_CONFLICT: "Conflicting replay rejected",
  OVER_LIMIT_REJECTED: "Over-limit proof rejected",
  PRIVACY_AUDIT_COMPLETED: "Privacy audit completed",
  RETRY_IN_PROGRESS: "Retry is still processing",
  RETRY_RESOLVED: "Retry resolved",
  PRESENTATION_REJECTED: "Presentation rejected",
  USE_FAILED_FINAL: "Action failed finally",
  DEMO_RESET: "Demo run reset",
};

function Status({ value }: { readonly value: string }) {
  const icon = value === "PASS" ? "✓" : value === "FAIL" ? "×" : value === "INCOMPLETE" ? "!" : "·";
  return (
    <span className={`status status-${value.toLowerCase()}`}>
      <span aria-hidden="true">{icon}</span> {value}
    </span>
  );
}

function Metric({
  id,
  label,
  value,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: number | null;
}) {
  return (
    <article className="metric">
      <span className="metric-label">{label}</span>
      <strong data-testid={id}>{value === null ? "—" : value}</strong>
    </article>
  );
}

export function EvidencePanels({ evidence, events, streamState }: EvidencePanelsProps) {
  if (!evidence) {
    return (
      <div className="evidence-panels">
        <section className="panel loading-panel" aria-live="polite">
          <span className="spinner" aria-hidden="true">
            ◌
          </span>
          <strong>Loading backend evidence</strong>
          <p className="muted">{streamState}</p>
        </section>
        <AssumptionsPanel />
      </div>
    );
  }
  const checks = Object.entries(evidence.checks) as [
    keyof EvidenceReport["checks"],
    { status: string },
  ][];
  const checkLabel = (key: string) =>
    key
      .replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)
      .replace(/^./, (letter) => letter.toUpperCase());
  const lane = (event: ProtocolEvent["event"]) =>
    event === "CREDENTIAL_ISSUED"
      ? "issuer"
      : event === "EXTERNAL_ACTION_COMMITTED" || event === "ACTION_DISPATCH_STARTED"
        ? "action"
        : event === "PRESENTATION_RECEIVED" ||
            event === "PROOF_ACCEPTED" ||
            event === "USE_ACCEPTED" ||
            event === "OVER_LIMIT_REJECTED" ||
            event === "PRESENTATION_REJECTED"
          ? "verifier"
          : "wallet";
  return (
    <div className="evidence-panels">
      <section className="panel evidence-hero" aria-labelledby="evidence-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">03 / VERIFIER EVIDENCE</p>
            <h2 id="evidence-title">Trust the records.</h2>
          </div>
          <div className="overall">
            <span className="muted">OVERALL</span>
            <strong data-testid="evidence-overall">
              <Status value={evidence.overall} />
            </strong>
          </div>
        </div>
        <p className="muted">
          Live counts from verifier storage and the independent action service. {streamState}
        </p>
        <div className="metrics">
          <Metric
            id="metric-committedUses"
            label="Committed uses"
            value={evidence.counts.committedUses}
          />
          <Metric
            id="metric-externalActions"
            label="External actions"
            value={evidence.counts.externalActions}
          />
          <Metric
            id="metric-retryUsageDelta"
            label="Retry use delta"
            value={evidence.counts.retryUsageDelta}
          />
          <Metric
            id="metric-retryActionDelta"
            label="Retry action delta"
            value={evidence.counts.retryActionDelta}
          />
          <Metric
            id="metric-failedAttemptUses"
            label="Rejected use delta"
            value={evidence.counts.failedAttemptUses}
          />
          <Metric
            id="metric-storedHolderIdentities"
            label="Holder identities stored"
            value={evidence.counts.storedHolderIdentities}
          />
        </div>
      </section>
      <section
        className="panel protocol-trace"
        data-testid="protocol-trace"
        aria-labelledby="trace-title"
      >
        <div className="panel-heading">
          <div>
            <p className="eyebrow">04 / LIVE TRACE</p>
            <h2 id="trace-title">A safe protocol trace</h2>
          </div>
          <span className="muted">{events.length} verified events</span>
        </div>
        <div className="lanes">
          <span>Issuer</span>
          <span>Holder wallet</span>
          <span>Verifier</span>
          <span>Action service</span>
        </div>
        <ol className="trace-list">
          {events.length === 0 ? (
            <li className="muted">No events in this run yet.</li>
          ) : (
            events.slice(-18).map((event) => (
              <li key={event.sequence} className={`trace-event lane-${lane(event.event)}`}>
                <span className="trace-sequence">{String(event.sequence).padStart(2, "0")}</span>
                <span className="trace-icon" aria-hidden="true">
                  {event.event.includes("REJECT") || event.event === "OVER_LIMIT_REJECTED"
                    ? "×"
                    : event.event.includes("RETRY")
                      ? "↻"
                      : "✓"}
                </span>
                <span>
                  <strong>{eventCopy[event.event]}</strong>
                  <small>
                    {event.usageDelta ? `+${event.usageDelta} use` : "No use delta"} ·{" "}
                    {event.actionDelta ? `+${event.actionDelta} action` : "No action delta"}
                  </small>
                </span>
              </li>
            ))
          )}
        </ol>
      </section>
      <section className="panel evidence-table" aria-labelledby="table-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">05 / SANITIZED RECORDS</p>
            <h2 id="table-title">Verifier evidence table</h2>
          </div>
          <span className="pill">run {evidence.demoRunId.slice(0, 8)}…</span>
        </div>
        <p className="muted">
          Per-use references are masked. A nullifier recognizes one allowed use and its retries; it
          does not identify the holder or connect separate uses.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Use reference</th>
                <th>Intent digest</th>
                <th>State</th>
                <th>Receipt</th>
                <th>Action key</th>
              </tr>
            </thead>
            <tbody>
              {evidence.uses.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    No accepted uses yet.
                  </td>
                </tr>
              ) : (
                evidence.uses.map((use) => (
                  <tr key={use.maskedUseRef}>
                    <td>
                      <code>{use.maskedUseRef}</code>
                    </td>
                    <td>
                      <code>{use.intentDigest.slice(0, 15)}…</code>
                    </td>
                    <td>{use.status}</td>
                    <td>{use.receiptId ? <code>{use.receiptId.slice(0, 8)}…</code> : "—"}</td>
                    <td>
                      <code>{use.actionKey.slice(0, 18)}…</code>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      <div className="panel-grid">
        <section className="panel invariant-panel" aria-labelledby="invariant-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">06 / INVARIANTS</p>
              <h2 id="invariant-title">Measured guarantees</h2>
            </div>
            <span className="pill">limit {evidence.declaredLimit}</span>
          </div>
          <ul className="check-list">
            {checks.map(([key, result]) => (
              <li key={key}>
                <span>{checkLabel(key)}</span>
                <Status value={result.status} />
              </li>
            ))}
          </ul>
        </section>
        <section className="panel linkability-panel" aria-labelledby="linkability-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">07 / PRIVACY AUDIT</p>
              <h2 id="linkability-title">Linkability matrix</h2>
            </div>
            <Status value={evidence.linkability.status} />
          </div>
          <div className="matrix" role="table" aria-label="Linkability comparison matrix">
            <div className="matrix-row matrix-head">
              <span>Comparison</span>
              <span>Expected</span>
              <span>Observed</span>
            </div>
            {evidence.linkability.pairs.map((pair, index) => (
              <div
                className="matrix-row"
                role="row"
                key={`${pair.leftUseRef}-${pair.rightUseRef}-${index}`}
              >
                <span>
                  <code>{pair.leftUseRef.slice(-6)}</code> ↔{" "}
                  <code>{pair.rightUseRef.slice(-6)}</code>
                </span>
                <span>{pair.expected}</span>
                <span>
                  <Status value={pair.result === pair.expected ? "PASS" : "FAIL"} /> {pair.result}
                </span>
              </div>
            ))}
          </div>
          {evidence.linkability.pairs.length === 0 ? (
            <p className="muted">
              Complete the scenario, then run the audit to compare every distinct use and its exact
              retry.
            </p>
          ) : null}
        </section>
      </div>
      <AssumptionsPanel />
    </div>
  );
}

function AssumptionsPanel() {
  return (
    <section
      className="panel assumptions"
      id="assumptions"
      data-testid="assumptions"
      aria-labelledby="assumption-title"
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">08 / ASSUMPTIONS</p>
          <h2 id="assumption-title">Privacy has a clear boundary.</h2>
        </div>
        <span className="pill">SIMULATED CRYPTO</span>
      </div>
      <p>
        These results assume the opaque issuer, holder, verifier, and audit adapters preserve their
        stated cryptographic properties. This project demonstrates protocol behavior and durable
        recovery; it does not provide production cryptography or prove that an issuer cannot
        recognize a holder.
      </p>
      <div className="assumption-grid">
        <span>Bound slots are authenticated</span>
        <span>Distinct-use unlinkability is adapter supplied</span>
        <span>Browser wallet is holder-only</span>
        <span>Server stores safe evidence only</span>
      </div>
    </section>
  );
}
