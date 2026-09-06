import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { parseClientEnv } from "@anonlimit/config/client";
import { healthResponseSchema } from "@anonlimit/contracts/health";
import { ApiResponseError, createApiClient, createInsightsClient } from "./lib/api-client.js";
import { EvidencePanels } from "./features/demo-lab/panels.js";
import { useEvidence } from "./features/demo-lab/use-evidence.js";
import { InsightsPanel } from "./features/demo-lab/insights-panel.js";
import { useInsights } from "./features/demo-lab/use-insights.js";
import {
  armNextWalletDropAck,
  auditWalletUses,
  issueWalletCredential,
  loadWallet,
  performWalletUse,
  resetWalletDemo,
  retryLastWalletUse,
  resumePendingWalletUse,
  WalletOutcomeUnknownError,
  type WalletSnapshot,
} from "./features/wallet/wallet-service.js";
import "./style.css";

const config = parseClientEnv(import.meta.env);

function App() {
  const client = useMemo(() => createApiClient(config.apiBaseUrl), []);
  const insightsClient = useMemo(() => createInsightsClient(config.apiBaseUrl), []);
  const [snapshot, setSnapshot] = useState<WalletSnapshot>({ credential: null, operation: null });
  const [connection, setConnection] = useState("Checking connection");
  const [message, setMessage] = useState("Issue a pass to begin.");
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [boundaryRejected, setBoundaryRejected] = useState(false);
  const [invalidatedInsightsRun, setInvalidatedInsightsRun] = useState<string | null>(null);
  const { evidence, events, streamState } = useEvidence(client, config.demoMode, refreshKey);
  const insights = useInsights(
    insightsClient,
    config.demoMode &&
      !busy &&
      streamState === "Live · verified API evidence" &&
      evidence?.demoRunId !== invalidatedInsightsRun,
    evidence?.demoRunId ?? null,
    refreshKey
  );

  useEffect(() => {
    let active = true;
    void loadWallet()
      .then(async (wallet) => {
        if (!active) return;
        setSnapshot(wallet);
        if (wallet.operation?.state === "OUTCOME_UNKNOWN") {
          setMessage(
            wallet.operation.dropAckArmed
              ? "Acknowledgement dropped. Retry the exact stored request safely."
              : "The response was lost. Retry the exact stored request safely."
          );
        } else if (wallet.operation?.state === "PENDING" && wallet.operation.useId) {
          setMessage("Recovered a pending operation. Completing it…");
          const resumed = await resumePendingWalletUse(client);
          if (active) {
            setSnapshot(resumed);
            setMessage(
              resumed.operation?.state === "SUCCEEDED"
                ? "Pending action completed."
                : resumed.operation?.state === "FAILED"
                  ? "The accepted action failed finally; its slot is retired."
                  : resumed.operation?.state === "OUTCOME_UNKNOWN"
                    ? "The delayed result is unknown. Retry the exact stored request safely."
                    : "Operation pending."
            );
          }
        } else if (wallet.operation?.state === "PENDING") {
          setMessage("A stored operation needs an exact retry.");
        }
      })
      .catch(() => {
        if (active) setMessage("Browser wallet unavailable.");
      });
    void fetch(config.apiBaseUrl + "/health/ready", { credentials: "omit" })
      .then(async (response) => {
        const health = healthResponseSchema.parse(await response.json());
        if (!response.ok || health.status !== "ok") throw new Error("API_UNAVAILABLE");
        if (active) setConnection("API and database connected");
      })
      .catch(() => {
        if (active) setConnection("API unavailable — check local services");
      });
    return () => {
      active = false;
    };
  }, [client]);

  async function issue() {
    setBusy(true);
    setMessage("Requesting an anonymous pass…");
    try {
      const next = await issueWalletCredential(client);
      setSnapshot(next);
      setMessage("Pass ready in this browser wallet.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Issuance failed.");
    } finally {
      setBusy(false);
    }
  }

  async function resetDemo() {
    setBusy(true);
    setMessage("Resetting the demo run and local wallet…");
    try {
      const next = await resetWalletDemo(client);
      setSnapshot(next);
      setBoundaryRejected(false);
      setInvalidatedInsightsRun(evidence?.demoRunId ?? null);
      setRefreshKey((value) => value + 1);
      setMessage("Demo run reset. This browser wallet is clear; issue a new pass.");
    } catch {
      setMessage("Reset failed. The local wallet was kept.");
    } finally {
      setBusy(false);
    }
  }

  async function armDropAck() {
    setBusy(true);
    setMessage("Arming one acknowledgement drop…");
    try {
      const next = await armNextWalletDropAck(client);
      setSnapshot(next);
      setMessage("Fault armed for the next stored operation.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Fault control failed.");
    } finally {
      setBusy(false);
    }
  }

  async function useNext() {
    setBusy(true);
    setMessage("Creating a private presentation…");
    try {
      const next = await performWalletUse(client);
      setSnapshot(next);
      setMessage(
        next.operation?.state === "SUCCEEDED"
          ? "External action committed."
          : "Use accepted; waiting for receipt…"
      );
    } catch (error) {
      const retained = await loadWallet();
      setSnapshot(retained);
      setMessage(
        error instanceof WalletOutcomeUnknownError
          ? retained.operation?.dropAckArmed
            ? "Acknowledgement dropped. Outcome unknown; the same request is safe to retry."
            : "Response lost. Outcome unknown; the same request is safe to retry."
          : error instanceof Error
            ? error.message
            : "Use failed."
      );
    } finally {
      setBusy(false);
    }
  }

  async function probeBoundary() {
    setBusy(true);
    setBoundaryRejected(false);
    setMessage("Sending an authenticated simulator boundary probe…");
    try {
      await client.attemptFourthUse();
      setMessage("Boundary check failed: the verifier did not reject the probe.");
    } catch (error) {
      if (
        error instanceof ApiResponseError &&
        error.status === 422 &&
        error.code === "PRESENTATION_REJECTED"
      ) {
        setBoundaryRejected(true);
        setMessage("Fourth-use probe rejected. Inspect the backend evidence for unchanged counts.");
      } else {
        setMessage("Boundary probe unavailable. Retry when the services are connected.");
      }
    } finally {
      setBusy(false);
      setRefreshKey((value) => value + 1);
    }
  }

  async function runAudit() {
    setBusy(true);
    setMessage("Auditing accepted presentations through the opaque simulator…");
    try {
      const audit = await auditWalletUses(client);
      setMessage(
        audit.status === "PASS"
          ? "Pairwise audit passed. The invariant panel combines it with backend evidence."
          : `Audit ${audit.status}. Inspect the evidence and retry when the scenario is complete.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Audit unavailable. Please retry.");
    } finally {
      setBusy(false);
      setRefreshKey((value) => value + 1);
    }
  }

  async function retryLast() {
    setBusy(true);
    setMessage("Retrying the exact stored request…");
    try {
      const next = await retryLastWalletUse(client, (progress) => {
        setSnapshot(progress);
        setMessage(
          progress.operation?.retryResult?.code === "RETRY_IN_PROGRESS"
            ? "Retry matched the accepted use; its action is still pending."
            : "The stored request reached the verifier; its action is pending."
        );
      });
      setSnapshot(next);
      setMessage(
        next.operation?.state === "SUCCEEDED"
          ? next.operation.retryResult?.replayed
            ? "Retry matched. Original receipt recovered with zero extra use or action."
            : "The stored request was accepted once and its receipt was recovered."
          : next.operation?.state === "FAILED"
            ? "The accepted use reached a final action failure; its slot is retired."
            : "Retry matched the pending use."
      );
    } catch (error) {
      setMessage(
        error instanceof WalletOutcomeUnknownError
          ? "Acknowledgement is still uncertain. The stored request remains safe to retry."
          : error instanceof Error
            ? error.message
            : "Retry failed."
      );
      setSnapshot(await loadWallet());
    } finally {
      setBusy(false);
    }
  }

  const credential = snapshot.credential;
  const operation = snapshot.operation;
  const remaining = credential ? credential.policy.maxUses - credential.nextSlot : 0;
  const receipt = operation?.result?.status === "SUCCEEDED" ? operation.result.receipt : null;
  const unresolved = operation?.state === "PENDING" || operation?.state === "OUTCOME_UNKNOWN";
  const faultArmed = Boolean(credential?.preparedOperationId);
  const staleWallet = Boolean(
    credential && evidence && credential.demoRunId !== evidence.demoRunId
  );
  const controlsDisabled = busy || staleWallet;
  const tone = boundaryRejected
    ? "rejection"
    : operation?.state === "OUTCOME_UNKNOWN"
      ? "unknown"
      : operation?.retryResult?.replayed
        ? "retry"
        : operation?.state === "SUCCEEDED"
          ? "acceptance"
          : "neutral";
  const protocolState = boundaryRejected
    ? "FOURTH USE REJECTED · NO ACCEPTANCE"
    : operation?.state === "OUTCOME_UNKNOWN"
      ? operation.dropAckArmed
        ? "ACKNOWLEDGEMENT DROPPED · OUTCOME UNKNOWN"
        : "RESPONSE LOST · OUTCOME UNKNOWN"
      : operation?.retryResult?.replayed && operation.state === "SUCCEEDED"
        ? "RETRY MATCHED · RECEIPT RECOVERED"
        : operation?.retryResult && operation.state === "SUCCEEDED"
          ? "STORED REQUEST ACCEPTED · RECEIPT STORED"
          : operation?.state === "FAILED" && operation.result?.status === "FAILED_FINAL"
            ? "ACTION FAILED · SLOT RETIRED"
            : operation?.state === "FAILED"
              ? "REQUEST REJECTED · SLOT RETAINED"
              : faultArmed
                ? "FAULT ARMED · NEXT ACKNOWLEDGEMENT"
                : operation?.state === "PENDING"
                  ? "NEW ACCEPTANCE · PENDING"
                  : operation?.state === "SUCCEEDED"
                    ? "NEW ACCEPTANCE · RECEIPT STORED"
                    : "READY";

  const completedUses =
    evidence?.counts.committedUses ?? (credential ? credential.policy.maxUses - remaining : 0);
  const cleanRun = evidence
    ? evidence.counts.committedUses === 0 && evidence.counts.externalActions === 0
    : !credential;
  const retryProved =
    evidence?.checks.retryIdempotency.status === "PASS" ||
    Boolean(operation?.retryResult?.replayed);
  const boundaryProved = boundaryRejected || evidence?.checks.overLimitRejected.status === "PASS";
  const auditProved = evidence?.linkability.status === "PASS";
  const skippedRecovery = Boolean(
    credential && evidence && completedUses >= 2 && !retryProved && !unresolved
  );

  type GuideAction = "reset" | "issue" | "use" | "fault" | "retry" | "boundary" | "audit" | "done";
  const nextAction: {
    readonly action: GuideAction;
    readonly step: number;
    readonly title: string;
    readonly detail: string;
  } = staleWallet
    ? {
        action: "reset",
        step: 1,
        title: "Reset this evaluation",
        detail:
          "This wallet belongs to an older run. Reset first so the records and the browser pass agree.",
      }
    : skippedRecovery
      ? {
          action: "reset",
          step: 1,
          title: "Restart the guided path",
          detail:
            "The second view was used without the lost-response step. Reset to collect the retry proof.",
        }
      : !cleanRun && !credential
        ? {
            action: "reset",
            step: 1,
            title: "Reset this evaluation",
            detail: "Clear the previous run so the evaluator can see a clean 0-use starting point.",
          }
        : !credential
          ? {
              action: "issue",
              step: 2,
              title: "Issue a 3-view anonymous pass",
              detail:
                "The pass stays in this browser wallet. The verifier does not receive a holder identity.",
            }
          : unresolved
            ? {
                action: "retry",
                step: 6,
                title: "Retry the same request",
                detail:
                  "The response is uncertain. Retry the stored bytes; this must add 0 views and 0 actions.",
              }
            : completedUses === 0
              ? {
                  action: "use",
                  step: 3,
                  title: "View article 1 of 3",
                  detail: "Use the first hidden slot and wait for its stable action receipt.",
                }
              : completedUses === 1 && !retryProved && !faultArmed
                ? {
                    action: "fault",
                    step: 4,
                    title: "Simulate a lost response",
                    detail:
                      "Arm the test fault before the second view so the recovery behavior is visible.",
                  }
                : completedUses === 1 && !retryProved
                  ? {
                      action: "use",
                      step: 5,
                      title: "View article 2 of 3",
                      detail:
                        "The server will commit this view, then the acknowledgement will be hidden.",
                    }
                  : completedUses < 3
                    ? {
                        action: "use",
                        step: 7,
                        title: "View article 3 of 3",
                        detail:
                          "Use the final allowed slot. The local wallet should then show 0 of 3 remaining.",
                      }
                    : !boundaryProved
                      ? {
                          action: "boundary",
                          step: 8,
                          title: "Prove the fourth view is blocked",
                          detail:
                            "The verifier should reject this controlled probe with no new use or action.",
                        }
                      : !auditProved
                        ? {
                            action: "audit",
                            step: 9,
                            title: "Run the privacy audit",
                            detail:
                              "Confirm separate views are UNLINKABLE while the exact retry is SAME_USE.",
                          }
                        : {
                            action: "done",
                            step: 9,
                            title: "Evaluation complete",
                            detail:
                              "Three views, one safe retry, a blocked fourth view, and the privacy audit are all recorded.",
                          };

  const evaluationSteps = [
    {
      number: 1,
      title: "Reset",
      detail: "Start at zero",
      complete: !staleWallet && (cleanRun || Boolean(credential)) && !skippedRecovery,
    },
    { number: 2, title: "Issue pass", detail: "Get 3 slots", complete: Boolean(credential) },
    { number: 3, title: "View 1", detail: "Accept once", complete: completedUses >= 1 },
    {
      number: 4,
      title: "Lose response",
      detail: "Arm the fault",
      complete: faultArmed || retryProved,
    },
    { number: 5, title: "View 2", detail: "Commit the action", complete: completedUses >= 2 },
    { number: 6, title: "Retry safely", detail: "Add zero twice", complete: retryProved },
    { number: 7, title: "View 3", detail: "Exhaust the pass", complete: completedUses >= 3 },
    { number: 8, title: "Block view 4", detail: "Reject with no delta", complete: boundaryProved },
    { number: 9, title: "Audit", detail: "Show the proof", complete: auditProved },
  ];

  const plainResult = boundaryRejected
    ? {
        title: "The fourth view was blocked.",
        detail: "The verifier rejected the probe without adding a use, action, or receipt.",
      }
    : operation?.state === "OUTCOME_UNKNOWN"
      ? {
          title: "The view was committed, but its response was hidden.",
          detail: "Retry the same request. It cannot spend another view or create another action.",
        }
      : operation?.retryResult?.replayed
        ? {
            title: "The original result was recovered.",
            detail: "This exact retry added 0 uses and 0 actions; the original receipt is stable.",
          }
        : operation?.state === "SUCCEEDED"
          ? {
              title: "The view was accepted and the action committed.",
              detail: "One hidden slot produced one stable external action receipt.",
            }
          : {
              title: "Ready for the guided evaluation.",
              detail: "Follow the highlighted next action, then read the backend evidence below.",
            };

  return (
    <div className="shell" id="overview">
      <a className="skip-link" href="#controls">
        Skip to demo controls
      </a>
      <header className="lab-header">
        <nav className="global-nav" aria-label="Main navigation">
          <a className="brand" href="#overview" aria-label="AnonLimit home">
            <svg className="brand-symbol" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 17 9 6h6l5 11M7 12h10" stroke="currentColor" strokeWidth="1.8" />
              <circle cx="12" cy="18" r="1.5" fill="currentColor" />
            </svg>
            AnonLimit
          </a>
          <div className="nav-links">
            <a href="#demo">Demo Lab</a>
            <a href="#evidence">Evidence</a>
            <a href="#assumptions">Assumptions</a>
          </div>
          <span className="nav-note">An open protocol experiment</span>
        </nav>
      </header>
      <section className="intro">
        <div className="intro-copy">
          <p className="eyebrow">ANONLIMIT · EVALUATION DEMO</p>
          <h1>
            Three views.
            <br />
            <span>No account.</span>
          </h1>
          <p className="description">
            Run one anonymous pass through its three allowed views, recover a deliberately lost
            response, and prove that a fourth view is rejected.
          </p>
          <div className="hero-actions">
            <a className="button-primary hero-button" href="#controls">
              Start the guided run
            </a>
            <a className="text-link" href="#assumptions">
              Read the boundary <span aria-hidden="true">›</span>
            </a>
          </div>
          <p className="hero-footnote">
            Scope: three uses per issued anonymous pass. The crypto layer is simulated and the
            verifier stores no holder identity.
          </p>
        </div>
        <aside className="claim-card" aria-label="What the evaluation proves">
          <p className="eyebrow">WHAT YOU WILL PROVE</p>
          <h2>One pass. Three checks.</h2>
          <ul>
            <li>
              <span>01</span>
              <span>
                <strong>Bounded use</strong>
                <small>Views 1, 2, and 3 succeed.</small>
              </span>
            </li>
            <li>
              <span>02</span>
              <span>
                <strong>Safe retry</strong>
                <small>A lost response costs nothing extra.</small>
              </span>
            </li>
            <li>
              <span>03</span>
              <span>
                <strong>Privacy evidence</strong>
                <small>Distinct views stay unlinkable.</small>
              </span>
            </li>
          </ul>
        </aside>
      </section>
      <main>
        <section className="demo-section" id="demo" aria-labelledby="demo-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">THE DEMO LAB</p>
              <h2 id="demo-title">Try it. Retry it. See the proof.</h2>
            </div>
            <span
              className="connection"
              role="status"
              data-testid="connection"
              data-state={
                connection === "API and database connected"
                  ? "connected"
                  : connection.startsWith("API unavailable")
                    ? "unavailable"
                    : "checking"
              }
            >
              <span className="connection-dot" aria-hidden="true" />
              {connection}
            </span>
          </div>
          <div className="lab-grid">
            <div className="sidebar">
              <section className="panel" id="controls" aria-labelledby="guide-title">
                <p className="eyebrow">01 / GUIDED EVALUATION</p>
                <h2 id="guide-title">Follow the proof, one step at a time.</h2>
                <p className="muted">
                  The highlighted action is the next required step. Every result below comes from
                  the backend or the supplied privacy audit.
                </p>
                <div className="next-action" data-testid="next-action" aria-live="polite">
                  <span className="next-action-label">NEXT REQUIRED ACTION</span>
                  <strong>{nextAction.title}</strong>
                  <p>{nextAction.detail}</p>
                </div>
                <ol className="evaluation-steps" aria-label="Evaluation sequence">
                  {evaluationSteps.map((step) => (
                    <li
                      key={step.number}
                      data-state={
                        step.complete
                          ? "complete"
                          : nextAction.step === step.number
                            ? "current"
                            : "upcoming"
                      }
                    >
                      <span className="step-number">{step.complete ? "✓" : step.number}</span>
                      <span>
                        <strong>{step.title}</strong>
                        <small>{step.detail}</small>
                      </span>
                    </li>
                  ))}
                </ol>
                {staleWallet ? (
                  <p role="alert">
                    This wallet belongs to an earlier demo run. Reset to start a consistent
                    scenario.
                  </p>
                ) : null}
                <div className="control-stack">
                  <div className={`control-row ${nextAction.action === "issue" ? "is-next" : ""}`}>
                    <button
                      className="button-primary"
                      type="button"
                      onClick={() => void issue()}
                      disabled={controlsDisabled || Boolean(credential) || unresolved}
                      aria-describedby="issue-help"
                      data-testid="issue-pass"
                    >
                      Issue a 3-view anonymous pass
                    </button>
                    <p id="issue-help">Creates one pass with three hidden, one-time slots.</p>
                  </div>
                  <div className={`control-row ${nextAction.action === "use" ? "is-next" : ""}`}>
                    <button
                      className="button-primary"
                      type="button"
                      onClick={() => void useNext()}
                      disabled={controlsDisabled || !credential || remaining === 0 || unresolved}
                      aria-describedby="use-help"
                      data-testid="use-next-slot"
                    >
                      {credential && remaining > 0
                        ? `View next article · ${credential.policy.maxUses - remaining + 1} of ${credential.policy.maxUses}`
                        : "View next article"}
                    </button>
                    <p id="use-help">Consumes one available slot and waits for a stable receipt.</p>
                  </div>
                  {config.demoMode ? (
                    <div
                      className={`control-row ${nextAction.action === "fault" ? "is-next" : ""}`}
                    >
                      <button
                        type="button"
                        onClick={() => void armDropAck()}
                        disabled={
                          controlsDisabled ||
                          !credential ||
                          remaining === 0 ||
                          unresolved ||
                          faultArmed
                        }
                        aria-describedby="fault-help"
                        data-testid="drop-ack"
                      >
                        Simulate a lost response
                      </button>
                      <p id="fault-help">
                        The next accepted view still commits, but its response is hidden.
                      </p>
                    </div>
                  ) : null}
                  <div className={`control-row ${nextAction.action === "retry" ? "is-next" : ""}`}>
                    <button
                      type="button"
                      onClick={() => void retryLast()}
                      disabled={controlsDisabled || !unresolved}
                      aria-describedby="retry-help"
                      data-testid="retry-request"
                    >
                      Retry the same request
                    </button>
                    <p id="retry-help">
                      Recovers the original receipt without another view or action.
                    </p>
                  </div>
                  {config.demoMode ? (
                    <>
                      <div
                        className={`control-row ${nextAction.action === "boundary" ? "is-next" : ""}`}
                      >
                        <button
                          type="button"
                          onClick={() => void probeBoundary()}
                          disabled={
                            controlsDisabled || !credential || remaining !== 0 || unresolved
                          }
                          aria-describedby="boundary-help"
                          data-testid="fourth-use"
                        >
                          Prove the fourth view is blocked
                        </button>
                        <p id="boundary-help">
                          Expected result: rejected with zero new uses or actions.
                        </p>
                      </div>
                      <div
                        className={`control-row ${nextAction.action === "audit" ? "is-next" : ""}`}
                      >
                        <button
                          type="button"
                          onClick={() => void runAudit()}
                          disabled={
                            controlsDisabled || !credential || remaining !== 0 || unresolved
                          }
                          aria-describedby="audit-help"
                          data-testid="privacy-audit"
                        >
                          Run the privacy audit
                        </button>
                        <p id="audit-help">Compares every distinct view and its exact retry.</p>
                      </div>
                      <div
                        className={`control-row reset-row ${nextAction.action === "reset" ? "is-next" : ""}`}
                      >
                        <button
                          className="button-danger"
                          type="button"
                          onClick={() => void resetDemo()}
                          disabled={busy}
                          aria-describedby="reset-help"
                          data-testid="reset-demo"
                        >
                          Reset evaluation
                        </button>
                        <p id="reset-help">
                          Clears this demo run and the local browser pass after server confirmation.
                        </p>
                      </div>
                    </>
                  ) : null}
                </div>
                <p className="control-footnote muted">
                  Demo controls are test instruments. The evaluation pass itself is limited to one
                  issued credential and three allowed views.
                </p>
              </section>
              <section className="panel wallet" aria-labelledby="wallet-title" aria-busy={busy}>
                <p className="eyebrow">02 / HOLDER WALLET · LOCAL ONLY</p>
                <h2 id="wallet-title">Your browser's private pass</h2>
                <p className="muted">
                  IndexedDB stores the pass, slots, and exact pending request on this browser. These
                  local slots are not the verifier's counter.
                </p>
                <div className="wallet-slots" aria-hidden="true">
                  {[0, 1, 2].map((slot) => (
                    <span
                      className={
                        !credential
                          ? "wallet-slot empty"
                          : slot < credential.nextSlot
                            ? "wallet-slot used"
                            : "wallet-slot"
                      }
                      key={slot}
                    >
                      {credential && slot < credential.nextSlot
                        ? "✓"
                        : String(slot + 1).padStart(2, "0")}
                    </span>
                  ))}
                </div>
                <div className="plain-result" data-testid="plain-result">
                  <span className="index">WHAT THIS MEANS</span>
                  <strong>{plainResult.title}</strong>
                  <p>{plainResult.detail}</p>
                </div>
                <p
                  className="protocol-state"
                  data-tone={tone}
                  data-testid="operation-status"
                  aria-live="polite"
                >
                  {protocolState}
                </p>
                <div className="wallet-grid">
                  <article>
                    <span className="index">LOCAL SLOTS</span>
                    <strong>{credential ? "Credential ready" : "No credential"}</strong>
                    <p>
                      {credential
                        ? `${remaining} of ${credential.policy.maxUses} uses available`
                        : "Issue a pass to create local slots."}
                    </p>
                  </article>
                  <article>
                    <span className="index">OPERATION</span>
                    <strong>{operation?.state ?? "IDLE"}</strong>
                    <p aria-live="polite" data-testid="command-message">
                      {busy ? "◌ " : ""}
                      {message}
                    </p>
                  </article>
                  <article>
                    <span className="index">LATEST RECEIPT</span>
                    <strong>{receipt ? "COMMITTED" : "Awaiting action"}</strong>
                    <p data-testid="wallet-receipt">
                      {receipt ? receipt.receiptId : "A stable action receipt will appear here."}
                    </p>
                  </article>
                </div>
              </section>
            </div>
          </div>
        </section>
        <section className="workspace" id="evidence" aria-label="Server evidence">
          {config.demoMode ? (
            <>
              <InsightsPanel {...insights} />
              <EvidencePanels evidence={evidence} events={events} streamState={streamState} />
            </>
          ) : (
            <section className="panel">
              <h2>Demo controls disabled</h2>
              <p>This environment exposes the holder wallet only.</p>
            </section>
          )}
        </section>
      </main>
      <footer className="site-footer">
        <div className="footer-inner">
          <a className="footer-brand" href="#overview">
            AnonLimit
          </a>
          <p>
            Three uses per anonymous pass. Issuance policy determines who can obtain another pass.
          </p>
          <span>
            Built to make privacy understandable.
            <br />
            Opaque crypto simulation.
          </span>
        </div>
      </footer>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Application mount unavailable.");
createRoot(root).render(<App />);
