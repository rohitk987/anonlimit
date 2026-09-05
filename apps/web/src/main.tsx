import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { parseClientEnv } from "@anonlimit/config/client";
import { healthResponseSchema } from "@anonlimit/contracts/health";
import { createApiClient } from "./lib/api-client.js";
import {
  issueWalletCredential,
  loadWallet,
  performWalletUse,
  resumePendingWalletUse,
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
    void (async () => {
      try {
        const [wallet, response] = await Promise.all([
          loadWallet(),
          fetch(config.apiBaseUrl + "/health/ready", { credentials: "omit" }),
        ]);
        const health = healthResponseSchema.parse(await response.json());
        if (!response.ok || health.status !== "ok") throw new Error("API_UNAVAILABLE");
        if (!active) return;
        setConnection("API and database connected");
        setSnapshot(wallet);
        if (wallet.operation?.state === "PENDING") {
          setMessage("Recovered a pending operation. Completing it…");
          const resumed = await resumePendingWalletUse(client);
          if (active) {
            setSnapshot(resumed);
            setMessage(
              resumed.operation?.state === "SUCCEEDED" ? "Receipt recovered." : "Operation pending."
            );
          }
        }
      } catch {
        if (active) setConnection("API unavailable — check local services");
      }
    })();
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
      setMessage(error instanceof Error ? error.message : "Use failed.");
      setSnapshot(await loadWallet());
    } finally {
      setBusy(false);
    }
  }

  const credential = snapshot.credential;
  const operation = snapshot.operation;
  const remaining = credential ? credential.policy.maxUses - credential.nextSlot : 0;
  const receipt = operation?.result?.status === "SUCCEEDED" ? operation.result.receipt : null;

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
          A browser wallet holds the pass. The verifier accepts one use durably, then a worker
          commits the external action.
        </p>
      </section>
      <section className="wallet" aria-labelledby="wallet-title">
        <div className="wallet-heading">
          <div>
            <p className="eyebrow">PHASE 04 / HOLDER WALLET</p>
            <h2 id="wallet-title">Complete one anonymous use</h2>
          </div>
          <span className="connection" role="status" aria-live="polite">
            {connection}
          </span>
        </div>
        <p className="wallet-copy">
          The pass and pending operation stay in IndexedDB on this browser. The server receives a
          presentation, never a browser identity.
        </p>
        <div className="actions">
          <button type="button" onClick={() => void issue()} disabled={busy}>
            Issue anonymous pass
          </button>
          <button
            type="button"
            onClick={() => void useNext()}
            disabled={busy || !credential || remaining === 0}
          >
            Use next slot
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
        <span>Phase 4 end-to-end use · {remaining} slots available</span>
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
