import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { parseClientEnv } from "@anonlimit/config/client";
import { healthResponseSchema } from "@anonlimit/contracts/health";
import { ApiResponseError, createApiClient } from "./lib/api-client.js";
import { EvidencePanels } from "./features/demo-lab/panels.js";
import { useEvidence } from "./features/demo-lab/use-evidence.js";
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
  const [snapshot, setSnapshot] = useState<WalletSnapshot>({ credential: null, operation: null });
  const [connection, setConnection] = useState("Checking connection");
  const [message, setMessage] = useState("Issue a pass to begin.");
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [boundaryRejected, setBoundaryRejected] = useState(false);
  const { evidence, events, streamState } = useEvidence(client, config.demoMode, refreshKey);

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
        <p className="eyebrow">ANONLIMIT</p>
        <h1>
          Limit the use.
          <br />
          <span>Leave the person unknown.</span>
        </h1>
        <p className="description">
          One anonymous pass. Three article views. Recover a lost response without spending another
          use, then inspect what the verifier actually knows.
        </p>
        <div className="hero-actions">
          <a className="button-primary hero-button" href="#demo">
            Explore the demo
          </a>
          <a className="text-link" href="#assumptions">
            Understand the boundaries <span aria-hidden="true">›</span>
          </a>
        </div>
        <figure className="pass-figure">
          <div className="pass-illustration" aria-hidden="true">
            <div className="pass-topline">
              <span>AnonLimit</span>
              <span>ANONYMOUS ACCESS</span>
            </div>
            <div className="pass-content">
              <span className="pass-number">03</span>
              <div className="pass-copy">
                <span>A little access.</span>
                <span>A lot less identity.</span>
              </div>
            </div>
            <div className="pass-bottomline">
              <span>ONE PASS. THREE POSSIBILITIES.</span>
              <div className="pass-slots">
                <span>1</span>
                <span>2</span>
                <span>3</span>
              </div>
            </div>
          </div>
          <figcaption>Conceptual pass · three allowed uses, held in your browser</figcaption>
        </figure>
        <p className="hero-footnote">
          A working protocol demo with simulated cryptography.
          <br />
          The limit belongs to a pass. Issuance policy decides who gets one.
        </p>
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
                <p className="eyebrow">01 / GUIDED EXPERIMENT</p>
                <h2 id="guide-title">Three uses. Zero identity.</h2>
                <p className="muted">Follow one pass from its first use to its final boundary.</p>
                <ol className="journey" aria-label="Demo sequence">
                  <li>
                    <span>1</span>Issue & use
                  </li>
                  <li>
                    <span>2</span>Lose & retry
                  </li>
                  <li>
                    <span>3</span>Finish & audit
                  </li>
                </ol>
                {staleWallet ? (
                  <p role="alert">
                    This wallet belongs to an earlier demo run. Reset to start a consistent
                    scenario.
                  </p>
                ) : null}
                <div className="control-stack">
                  <button
                    className="button-primary"
                    type="button"
                    onClick={() => void issue()}
                    disabled={controlsDisabled || Boolean(credential) || unresolved}
                  >
                    Issue anonymous pass
                  </button>
                  <button
                    className="button-primary"
                    type="button"
                    onClick={() => void useNext()}
                    disabled={controlsDisabled || !credential || remaining === 0 || unresolved}
                  >
                    Use next slot
                  </button>
                  {config.demoMode ? (
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
                    >
                      Drop next acknowledgement
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void retryLast()}
                    disabled={controlsDisabled || !unresolved}
                  >
                    Retry last request
                  </button>
                  {config.demoMode ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void probeBoundary()}
                        disabled={controlsDisabled || !credential || remaining !== 0 || unresolved}
                      >
                        Attempt fourth use
                      </button>
                      <button
                        type="button"
                        onClick={() => void runAudit()}
                        disabled={controlsDisabled || !credential || remaining !== 0 || unresolved}
                      >
                        Run privacy audit
                      </button>
                      <button
                        className="button-danger"
                        type="button"
                        onClick={() => void resetDemo()}
                        disabled={busy}
                      >
                        Reset demo run
                      </button>
                    </>
                  ) : null}
                </div>
                <p className="muted">
                  “Attempt fourth use” sends a controlled simulator boundary probe through the real
                  verifier.
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
            <EvidencePanels evidence={evidence} events={events} streamState={streamState} />
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
