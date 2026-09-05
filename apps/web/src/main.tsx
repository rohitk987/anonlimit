import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { parseClientEnv } from "@anonlimit/config/client";
import { healthResponseSchema } from "@anonlimit/contracts/health";
import "./style.css";

function App() {
  const [status, setStatus] = useState("Checking connection");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 6000);
    let active = true;
    setStatus("Checking connection");
    async function check() {
      try {
        const config = parseClientEnv(import.meta.env);
        const response = await fetch(config.apiBaseUrl + "/health/ready", {
          signal: controller.signal,
          credentials: "omit",
        });
        const health = healthResponseSchema.parse(await response.json());
        if (!response.ok || health.status !== "ok" || health.service !== "api")
          throw new Error("Unavailable");
        if (active) setStatus("API and database connected");
      } catch {
        if (active) setStatus("API unavailable — check local services");
      } finally {
        window.clearTimeout(timeout);
      }
    }
    void check();
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [refresh]);
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
          <span>No identity counter.</span>
        </h1>
        <p className="description">
          A simulation of limited anonymous credentials, durable actions, and safe retries.
        </p>
      </section>
      <section className="foundation" aria-labelledby="foundation-title">
        <div className="phase-number" aria-hidden="true">
          03
        </div>
        <div className="phase-content">
          <p className="eyebrow">CURRENT BUILD PHASE</p>
          <h2 id="foundation-title">Durable acceptance</h2>
          <p>
            The API can issue an anonymous pass and atomically accept one verified use with durable
            recovery work. The browser wallet and action receipts arrive in the next phase.
          </p>
          <div className="connection">
            <span role="status" aria-live="polite">
              {status}
            </span>
            <button type="button" onClick={() => setRefresh((value) => value + 1)}>
              Check connection <span aria-hidden="true">↻</span>
            </button>
          </div>
        </div>
      </section>
      <section className="principles" aria-label="Planned system boundaries">
        <article>
          <span className="index">01 / HOLDER</span>
          <h3>Your wallet stays local</h3>
          <p>Credentials and pending operations will live in the browser wallet.</p>
        </article>
        <article>
          <span className="index">02 / VERIFIER</span>
          <h3>One durable acceptance</h3>
          <p>PostgreSQL coordinates each accepted use and its recovery work.</p>
        </article>
        <article>
          <span className="index">03 / ACTION</span>
          <h3>The same receipt on retry</h3>
          <p>An independent action service will deduplicate repeated deliveries.</p>
        </article>
      </section>
      <footer>
        <span>Backend acceptance ready · Browser workflow unavailable</span>
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
