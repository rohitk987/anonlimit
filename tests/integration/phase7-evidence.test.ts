import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseActionEnv, type ApiEnv } from "@anonlimit/config/server";
import { internalActionEvidenceResponseSchema, type ProtocolEvent } from "@anonlimit/contracts";
import { createActionDatabase } from "@anonlimit/db/action";
import { DEFAULT_DEMO_RUN_ID, seedDefaultPolicy } from "@anonlimit/db/seed";
import { createVerifierDatabase, type VerifierDatabase } from "@anonlimit/db/verifier";
import { createApp as createActionApp } from "../../apps/action-simulator/src/app.js";
import { createApp as createApiApp } from "../../apps/api/src/app.js";
import { createEventStreamController } from "../../apps/api/src/modules/events/events-controller.js";
import { startPhase3Postgres, type Phase3Postgres } from "../helpers/phase3-postgres.js";

const TOKEN = "phase7-action-token-" + "x".repeat(48);
const TRACE_ID = "71000000-0000-4000-8000-000000000001";
const EVENT_ID = "71000000-0000-4000-8000-000000000002";
const ACTION_USE_ID = "71000000-0000-4000-8000-000000000003";

function apiConfig(databaseUrl: string): ApiEnv {
  return {
    nodeEnv: "test",
    logLevel: "silent",
    port: 4000,
    webOrigin: "http://localhost:5173",
    databaseUrl,
    demoMode: true,
    actionServiceUrl: "http://127.0.0.1:4100",
    actionServiceToken: TOKEN,
    verifierLedgerHmacKey: "phase7-ledger-key-" + "a".repeat(48),
    verifierActionHmacKey: "phase7-action-key-" + "b".repeat(48),
    opaqueCryptoProvider: "simulated",
    issuerKeyId: "demo-issuer-v1",
    issuerPrivateKeyPath: "/phase7-test/issuer.key",
    issuerPublicParametersPath: "/phase7-test/issuer-public.json",
  };
}

function issuedEvent(now: string): ProtocolEvent {
  return {
    sequence: 1,
    occurredAt: now,
    event: "CREDENTIAL_ISSUED",
    traceId: TRACE_ID,
    demoRunId: DEFAULT_DEMO_RUN_ID,
    policyId: "anon-demo",
    policyVersion: 1,
    usageDelta: 0,
    actionDelta: 0,
  };
}

describe.sequential("Phase 7 evidence and privacy boundary", () => {
  let database: Phase3Postgres | undefined;
  let repository: VerifierDatabase | undefined;
  let actionDatabase: ReturnType<typeof createActionDatabase> | undefined;

  beforeAll(async () => {
    database = await startPhase3Postgres();
    await database.migrate();
    await seedDefaultPolicy(database.ownerConnectionString, { issuerKeyId: "demo-issuer-v1" });
    repository = createVerifierDatabase(database.connectionStringFor("verifier_api"));
    actionDatabase = createActionDatabase(database.connectionStringFor("action_service"));
  }, 120_000);

  afterAll(async () => {
    await repository?.close();
    await actionDatabase?.close();
    await database?.stop();
  }, 30_000);

  it("reads sanitized evidence views and replays events from a sequence cursor", async () => {
    if (!database || !repository) throw new Error("TEST_DATABASE_UNAVAILABLE");
    const columns = await database.pool.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'verifier' AND table_name IN ('evidence_uses', 'evidence_events')
      ORDER BY table_name, ordinal_position
    `);
    expect(columns.rows.map((row) => row.column_name)).not.toEqual(
      expect.arrayContaining(["use_id", "nullifier_key", "operation_id", "raw_presentation"])
    );

    const now = new Date().toISOString();
    await repository.appendProtocolEvent({
      eventId: EVENT_ID,
      occurredAt: now,
      event: "CREDENTIAL_ISSUED",
      traceId: TRACE_ID,
      demoRunId: DEFAULT_DEMO_RUN_ID,
      policyId: "anon-demo",
      policyVersion: 1,
      usageDelta: 0,
      actionDelta: 0,
    });
    const first = await repository.getProtocolEvents(0);
    expect(first).toHaveLength(1);
    expect(first[0]).toEqual(issuedEvent((first[0] as ProtocolEvent).occurredAt));
    expect(await repository.getProtocolEvents(first[0]?.sequence ?? 0)).toEqual([]);
    const snapshot = await repository.getEvidenceSnapshot();
    expect(snapshot?.demoRunId).toBe(DEFAULT_DEMO_RUN_ID);
    expect(snapshot?.policy.maxUses).toBe(3);
    expect(snapshot?.privacy).toEqual({
      storedHolderIdentities: 0,
      credentialWideIdentifiersStored: 0,
    });
  });

  it("scopes Action Simulator evidence to the requested demo run", async () => {
    if (!database || !actionDatabase) throw new Error("TEST_DATABASE_UNAVAILABLE");
    await actionDatabase.commitAction({
      demoRunId: DEFAULT_DEMO_RUN_ID,
      actionKey: `hmac-sha256:${"a".repeat(64)}`,
      useId: ACTION_USE_ID,
      intentDigest: `sha256:${"b".repeat(64)}`,
      payloadDigest: `sha256:${"c".repeat(64)}`,
      action: { type: "REDEEM_DEMO_BENEFIT", payload: { benefitCode: "HACKATHON" } },
    });
    const app = createActionApp(
      parseActionEnv({
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
        ACTION_PORT: "4100",
        DATABASE_URL_ACTION: database.connectionStringFor("action_service"),
        DEMO_MODE: "true",
        ACTION_SERVICE_TOKEN: TOKEN,
      }),
      actionDatabase
    );
    const response = await app.inject({
      method: "GET",
      url: `/internal/v1/evidence?demoRunId=${DEFAULT_DEMO_RUN_ID}`,
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(response.statusCode).toBe(200);
    const evidence = internalActionEvidenceResponseSchema.parse(response.json());
    expect(evidence.externalActions).toBe(1);
    expect(evidence.receipts).toHaveLength(1);
    expect(JSON.stringify(evidence)).not.toContain("payloadDigest");
    await app.close();
  });

  it("serves safe SSE frames and honors Last-Event-ID reconnects", async () => {
    if (!repository) throw new Error("TEST_DATABASE_UNAVAILABLE");
    const events = createEventStreamController(repository);
    const app = createApiApp(
      apiConfig(database?.connectionStringFor("verifier_api") ?? ""),
      async () => undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      events
    );
    const first = await app.inject({ method: "GET", url: "/v1/demo/events/stream?after=0" });
    expect(first.statusCode).toBe(200);
    expect(first.headers["content-type"]).toContain("text/event-stream");
    expect(first.body).toContain("id: 1");
    expect(first.body).not.toContain("nullifier");
    const replay = await app.inject({
      method: "GET",
      url: "/v1/demo/events/stream",
      headers: { "last-event-id": "1" },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.body).toBe("");
    await app.close();
  });
});
