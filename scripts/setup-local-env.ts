import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
const secret = () => randomBytes(32).toString("hex");
const owner = secret(),
  api = secret(),
  worker = secret(),
  action = secret();
const values = {
  NODE_ENV: "development",
  DEMO_MODE: "true",
  API_PORT: "4000",
  ACTION_PORT: "4100",
  WEB_ORIGIN: "http://localhost:5173",
  POSTGRES_DB: "anonlimit",
  POSTGRES_USER: "migration_owner",
  POSTGRES_PASSWORD: owner,
  API_DB_PASSWORD: api,
  WORKER_DB_PASSWORD: worker,
  ACTION_DB_PASSWORD: action,
  DATABASE_URL_MIGRATION: `postgresql://migration_owner:${owner}@postgres:5432/anonlimit`,
  DATABASE_URL_API: `postgresql://verifier_api:${api}@postgres:5432/anonlimit`,
  DATABASE_URL_WORKER: `postgresql://verifier_worker:${worker}@postgres:5432/anonlimit`,
  DATABASE_URL_ACTION: `postgresql://action_service:${action}@postgres:5432/anonlimit`,
  VERIFIER_LEDGER_HMAC_KEY: secret(),
  VERIFIER_ACTION_HMAC_KEY: secret(),
  ACTION_SERVICE_URL: "http://action-simulator:4100",
  ACTION_SERVICE_TOKEN: secret(),
  OPAQUE_CRYPTO_PROVIDER: "simulated",
  ISSUER_KEY_ID: "demo-issuer-v1",
  ISSUER_PRIVATE_KEY_PATH: "/run/secrets/issuer-simulator.key",
  ISSUER_PUBLIC_PARAMETERS_PATH: "/run/secrets/issuer-public.json",
  OUTBOX_POLL_MS: "1000",
  LOG_LEVEL: "info",
  VITE_API_BASE_URL: "http://localhost:4000",
  VITE_DEMO_MODE: "true",
};
Promise.all([
  writeFile(
    ".env",
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
    { flag: "wx", mode: 0o600 }
  ),
  mkdir("secrets", { recursive: true }).then(async () => {
    await writeFile("secrets/issuer-simulator.key", secret() + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(
      "secrets/issuer-public.json",
      JSON.stringify({ provider: "SIMULATED_CAPABILITIES_V1", issuerKeyId: "demo-issuer-v1" }) +
        "\n",
      { flag: "wx", mode: 0o600 }
    );
  }),
])
  .then(() => {
    process.stdout.write("Created ignored local environment and issuer material.\n");
  })
  .catch(() => {
    process.stderr.write("Local setup was not created. Existing files are never overwritten.\n");
    process.exitCode = 1;
  });
