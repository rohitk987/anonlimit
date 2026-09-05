import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { parseClientEnv } from "@anonlimit/config/client";
import { healthResponseSchema } from "@anonlimit/contracts/health";
import { createApiClient } from "./lib/api-client.js";
import {
  armNextWalletDropAck,
  issueWalletCredential,
  loadWallet,
  performWalletUse,
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
  const protocolState =
    operation?.state === "OUTCOME_UNKNOWN"
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
    <main>
      <header>
        <a className="brand" href="/">
          Anon<span>Limit</span>
          <span className="mark" aria-hidden="true">
            ↗
          </span>
        </a>
        <span className="badge">LOCAL DEVELOPMENT</span>
      </header>
      <section className="intro">
        <p className="eyebrow">BOUNDED USE. PRIVATE BY DESIGN.</p>
        <h1>
          Three uses.
          <br />
          <span>One stable receipt.</span>
        </h1>
        <p className="description">
          Lose a network response after a durable action, then recover the same receipt without
          spending another anonymous use.
        </p>
      </section>
      <section className="wallet" aria-labelledby="wallet-title">
        <div className="wallet-heading">
          <div>
            <p className="eyebrow">PHASE 05 / SAFE RETRY</p>
            <h2 id="wallet-title">Recover a lost acknowledgement</h2>
          </div>
          <span className="connection" role="status" aria-live="polite">
            {connection}
          </span>
        </div>
        <p className="wallet-copy">
          The wallet stores the exact serialized request before sending it. An unknown outcome keeps
          the same slot reserved until that request is retried.
        </p>
        <p className="protocol-state" aria-live="polite">
          {protocolState}
        </p>
        <div className="actions">
          <button
            type="button"
            onClick={() => void issue()}
            disabled={busy || Boolean(credential) || unresolved}
          >
            Issue anonymous pass
          </button>
          {config.demoMode ? (
            <button
              type="button"
              onClick={() => void armDropAck()}
              disabled={busy || !credential || remaining === 0 || unresolved || faultArmed}
            >
              Drop next acknowledgement
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void useNext()}
            disabled={busy || !credential || remaining === 0 || unresolved}
          >
            Use next slot
          </button>
          <button type="button" onClick={() => void retryLast()} disabled={busy || !unresolved}>
            Retry last request
          </button>
        </div>
        <div className="wallet-grid">
          <article>
            <span className="index">WALLET</span>
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
            <p>{message}</p>
          </article>
          <article>
            <span className="index">RECEIPT</span>
            <strong>{receipt ? "COMMITTED" : "Awaiting action"}</strong>
            <p>{receipt ? receipt.receiptId : "The worker will return a stable receipt here."}</p>
          </article>
        </div>
      </section>
      <section className="principles" aria-label="Protocol boundaries">
        <article>
          <span className="index">01 / HOLDER</span>
          <h3>Local wallet</h3>
          <p>Credential, slots, and pending envelope persist in IndexedDB.</p>
        </article>
        <article>
          <span className="index">02 / VERIFIER</span>
          <h3>Durable acceptance</h3>
          <p>PostgreSQL records one accepted use and one outbox event.</p>
        </article>
        <article>
          <span className="index">03 / ACTION</span>
          <h3>Idempotent destination</h3>
          <p>The same action key returns the same receipt on retry.</p>
        </article>
      </section>
      <footer>
        <span>Phase 5 exact retry · {remaining} slots locally available</span>
        <p>
          Cryptographic guarantees are assumptions of an opaque simulated provider. Production
          anonymity is not implemented.
        </p>
      </footer>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Application mount unavailable.");
createRoot(root).render(<App />);
