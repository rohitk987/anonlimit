import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseActionEnv } from "@anonlimit/config/server";
import { createActionDatabase } from "../../packages/db/src/action.js";
import { createApp as createActionApp } from "../../apps/action-simulator/src/app.js";
import { createWorkerDatabase } from "../../packages/db/src/verifier/worker-repository.js";
import { seedDefaultPolicy } from "../../packages/db/src/seed.js";
import { startPhase3Postgres, type Phase3Postgres } from "../helpers/phase3-postgres.js";
import { deliverAction } from "../../apps/worker/src/action-client.js";

const TOKEN = "phase4-worker-token-" + "x".repeat(48);
const actionConfig = parseActionEnv({
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  ACTION_PORT: "4101",
  DATABASE_URL_ACTION: "postgresql://action_service:phase3-action-password@localhost/db",
  DEMO_MODE: "true",
  ACTION_SERVICE_TOKEN: TOKEN,
});

describe.sequential("Phase 4 leased delivery", () => {
  let database: Phase3Postgres | undefined;
  let workerDatabase: ReturnType<typeof createWorkerDatabase> | undefined;
  let actionDatabase: ReturnType<typeof createActionDatabase> | undefined;
  let actionApp: Awaited<ReturnType<typeof createActionApp>> | undefined;
  let actionUrl = "";

  beforeAll(async () => {
    database = await startPhase3Postgres();
    await database.migrate();
    await seedDefaultPolicy(database.ownerConnectionString);
    await database.pool.query(
      "TRUNCATE verifier.protocol_events, verifier.outbox_events, verifier.use_records, verifier.verification_challenges, action_sim.action_results"
    );
    const runId = "00000000-0000-4000-8000-000000000001";
    const challengeId = "00000000-0000-4000-8000-000000000011";
    const useId = "00000000-0000-4000-8000-000000000012";
    const eventId = "00000000-0000-4000-8000-000000000013";
    const intentDigest = "sha256:" + "1".repeat(64);
    const scopeHash = "sha256:" + "2".repeat(64);
    const nullifierKey = "hmac-sha256:" + "3".repeat(64);
    const actionKey = "hmac-sha256:" + "4".repeat(64);
    const payloadDigest = "sha256:" + "5".repeat(64);
    const policy = await database.pool.query<{ policy_digest: string }>(
      "SELECT policy_digest FROM verifier.quota_policies WHERE policy_id='anon-demo' AND version=1"
    );
    const policyDigest = policy.rows[0]?.policy_digest;
    if (!policyDigest) throw new Error("POLICY_UNAVAILABLE");
    await database.pool.query(
      `INSERT INTO verifier.verification_challenges
         (challenge_id,demo_run_id,nonce_hash,policy_id,policy_version,operation_id,
          intent_digest,scope_hash,policy_digest,expires_at,state)
       VALUES ($1,$2,$3,'anon-demo',1,$4,$5,$6,$7,clock_timestamp()+interval '1 hour','ISSUED')`,
      [challengeId, runId, "sha256:" + "6".repeat(64), useId, intentDigest, scopeHash, policyDigest]
    );
    await database.pool.query(
      `INSERT INTO verifier.use_records
         (use_id,demo_run_id,challenge_id,scope_hash,nullifier_key,operation_id,intent_digest,status,action_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'ACCEPTED_PENDING_ACTION',$8)`,
      [useId, runId, challengeId, scopeHash, nullifierKey, useId, intentDigest, actionKey]
    );
    await database.pool.query(
      "UPDATE verifier.verification_challenges SET state='CONSUMED', use_id=$2 WHERE challenge_id=$1",
      [challengeId, useId]
    );
    await database.pool.query(
      `INSERT INTO verifier.outbox_events
         (event_id,use_id,event_type,action_key,payload_digest,safe_payload,policy_id,policy_version)
       VALUES ($1,$2,'COMMIT_DEMO_ACTION',$3,$4,$5::jsonb,'anon-demo',1)`,
      [
        eventId,
        useId,
        actionKey,
        payloadDigest,
        JSON.stringify({ type: "REDEEM_DEMO_BENEFIT", payload: { benefitCode: "HACKATHON" } }),
      ]
    );
    actionDatabase = createActionDatabase(database.connectionStringFor("action_service"));
    actionApp = createActionApp(actionConfig, actionDatabase);
    actionUrl = await actionApp.listen({ host: "127.0.0.1", port: 0 });
    workerDatabase = createWorkerDatabase(database.connectionStringFor("verifier_worker"));
  }, 120_000);

  afterAll(async () => {
    await actionApp?.close();
    await workerDatabase?.close();
    await actionDatabase?.close();
    await database?.stop();
  }, 30_000);

  it("leases before delivery and completes use, outbox, and action together", async () => {
    if (!workerDatabase || !database) throw new Error("WORKER_DATABASE_UNAVAILABLE");
    const claimed = await workerDatabase.claimOutboxBatch(10, 30_000);
    expect(claimed).toHaveLength(1);
    const event = claimed[0];
    if (!event) throw new Error("OUTBOX_EVENT_UNAVAILABLE");
    const delivery = await deliverAction(
      { actionServiceUrl: actionUrl, actionServiceToken: TOKEN },
      event,
      new AbortController().signal
    );
    expect(delivery.kind).toBe("SUCCESS");
    if (delivery.kind !== "SUCCESS") throw new Error("ACTION_DELIVERY_FAILED");
    await workerDatabase.completeOutboxSuccess(event.eventId, delivery.response);
    const result = await database.pool.query<{
      status: string;
      outbox_state: string;
      actions: number;
    }>(
      `SELECT u.status, o.state AS outbox_state,
              (SELECT count(*)::int FROM action_sim.action_results) AS actions
       FROM verifier.use_records AS u JOIN verifier.outbox_events AS o ON o.use_id=u.use_id`
    );
    expect(result.rows[0]).toEqual({ status: "SUCCEEDED", outbox_state: "DELIVERED", actions: 1 });
  });
});
