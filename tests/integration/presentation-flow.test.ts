import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  challengeResponseSchema,
  issuanceResponseSchema,
  publicErrorSchema,
  useResultSchema,
  type ChallengeResponse,
  type IssuanceResponse,
  type Presentation,
} from "@anonlimit/contracts";
import { createSimulatedIssuer } from "@anonlimit/crypto/issuer";
import {
  createLookupProtection,
  createSimulatedVerifier,
  sha256Hex,
} from "@anonlimit/crypto/verifier";
import { seedDefaultPolicy } from "@anonlimit/db/seed";
import { createVerifierDatabase, type VerifierDatabase } from "@anonlimit/db/verifier";
import type { ApiEnv } from "@anonlimit/config/server";
import { createApp } from "../../apps/api/src/app.js";
import { createProtocolService } from "../../apps/api/src/modules/protocol/protocol-service.js";
import { startPhase3Postgres, type Phase3Postgres } from "../helpers/phase3-postgres.js";
import {
  createPhase3Presentation,
  PHASE3_ACTION,
  PHASE3_ACTION_KEY,
  PHASE3_ISSUER_SECRET,
  PHASE3_LEDGER_KEY,
  PHASE3_NOW,
  PHASE3_POLICY,
  tamperOpaqueProof,
} from "../helpers/phase3-protocol.js";

const FORCE_ROLLBACK_TRIGGER = "phase3_force_acceptance_rollback";
const FORCE_ROLLBACK_FUNCTION = "verifier.phase3_force_acceptance_rollback";

interface PresentationCandidate {
  readonly challenge: ChallengeResponse;
  readonly issuance: IssuanceResponse;
  readonly presentation: Presentation;
}

interface AcceptanceCounts {
  readonly uses: number;
  readonly outbox: number;
  readonly accepted_events: number;
}

type TestApp = ReturnType<typeof createApp>;
type InjectResponse = Awaited<ReturnType<TestApp["inject"]>>;

function operationId(ordinal: number): string {
  return `00000000-0000-4000-8000-${ordinal.toString().padStart(12, "0")}`;
}

function deterministicUuids(): () => string {
  let ordinal = 700;
  return () => operationId(ordinal++);
}

function deterministicBytes(seed: number): (length: number) => Uint8Array {
  let cursor = seed;
  return (length) => {
    const bytes = Uint8Array.from({ length }, (_, index) => (cursor + index) % 256);
    cursor = (cursor + length + 1) % 256;
    return bytes;
  };
}

function apiConfig(databaseUrl: string): ApiEnv {
  return {
    nodeEnv: "test",
    logLevel: "silent",
    port: 4000,
    webOrigin: "http://localhost:5173",
    databaseUrl,
    demoMode: true,
    actionServiceUrl: "http://127.0.0.1:4100",
    actionServiceToken: "44".repeat(32),
    verifierLedgerHmacKey: PHASE3_LEDGER_KEY,
    verifierActionHmacKey: PHASE3_ACTION_KEY,
    opaqueCryptoProvider: "simulated",
    issuerKeyId: PHASE3_POLICY.issuerKeyId,
    issuerPrivateKeyPath: "/phase3-test/issuer.key",
    issuerPublicParametersPath: "/phase3-test/issuer-public.json",
  };
}

function databaseFailure(error: unknown): { readonly code: unknown; readonly constraint: unknown } {
  if (!error || typeof error !== "object") return { code: undefined, constraint: undefined };
  return {
    code: Reflect.get(error, "code"),
    constraint: Reflect.get(error, "constraint"),
  };
}

describe.sequential("Phase 3 presentation HTTP flow", () => {
  let database: Phase3Postgres | undefined;
  let repository: VerifierDatabase | undefined;
  let app: TestApp | undefined;
  let clock = PHASE3_NOW;
  let verifierFailure = false;

  beforeAll(async () => {
    database = await startPhase3Postgres();
    await database.migrate();
    await seedDefaultPolicy(database.ownerConnectionString, {
      issuerKeyId: PHASE3_POLICY.issuerKeyId,
      now: () => PHASE3_NOW,
    });
  }, 120_000);

  beforeEach(async () => {
    if (!database) throw new Error("TEST_DATABASE_UNAVAILABLE");
    await removeForcedRollback();
    await database.pool.query(`
      TRUNCATE verifier.protocol_events, verifier.outbox_events,
               verifier.use_records, verifier.verification_challenges
      RESTART IDENTITY CASCADE
    `);
    const databaseClock = await database.pool.query<{ current_time: Date | string }>(
      "SELECT clock_timestamp() AS current_time"
    );
    const currentTime = databaseClock.rows[0]?.current_time;
    if (!currentTime) throw new Error("TEST_DATABASE_INCONSISTENT");
    clock = new Date(currentTime).getTime();
    verifierFailure = false;
    await startTestApp();
  });

  afterEach(async () => {
    await stopTestApp();
    await removeForcedRollback();
  });

  afterAll(async () => {
    await database?.stop();
  }, 30_000);

  async function startTestApp(challengeTtlMs = 120_000): Promise<void> {
    if (!database) throw new Error("TEST_DATABASE_UNAVAILABLE");
    repository = createVerifierDatabase(database.connectionStringFor("verifier_api"));
    const issuer = createSimulatedIssuer({
      issuerKeyId: PHASE3_POLICY.issuerKeyId,
      issuerSecret: PHASE3_ISSUER_SECRET,
      now: () => clock,
      randomBytes: deterministicBytes(10),
    });
    const simulatedVerifier = createSimulatedVerifier({
      issuerKeyId: PHASE3_POLICY.issuerKeyId,
      issuerSecret: PHASE3_ISSUER_SECRET,
      now: () => clock,
    });
    const protocol = createProtocolService({
      repository,
      issuer,
      verifier: {
        async verifyPresentation(input) {
          if (verifierFailure) throw new Error("TEST_VERIFIER_UNAVAILABLE");
          return simulatedVerifier.verifyPresentation(input);
        },
      },
      lookupProtection: createLookupProtection({
        ledgerKey: PHASE3_LEDGER_KEY,
        actionKey: PHASE3_ACTION_KEY,
      }),
      sha256Hex,
      now: () => clock,
      randomUuid: deterministicUuids(),
      randomBytes: deterministicBytes(100),
      challengeTtlMs,
    });
    app = createApp(
      apiConfig(database.connectionStringFor("verifier_api")),
      repository.check,
      protocol
    );
    await app.ready();
  }

  async function stopTestApp(): Promise<void> {
    const currentApp = app;
    const currentRepository = repository;
    app = undefined;
    repository = undefined;
    await currentApp?.close();
    await currentRepository?.close();
  }

  async function removeForcedRollback(): Promise<void> {
    if (!database) return;
    await database.pool.query(
      `DROP TRIGGER IF EXISTS ${FORCE_ROLLBACK_TRIGGER} ON verifier.protocol_events`
    );
    await database.pool.query(`DROP FUNCTION IF EXISTS ${FORCE_ROLLBACK_FUNCTION}()`);
  }

  async function createCandidate(ordinal: number, hiddenSlot = 0): Promise<PresentationCandidate> {
    if (!app) throw new Error("TEST_APP_UNAVAILABLE");
    const operation = operationId(ordinal);
    const issuanceResponse = await app.inject({
      method: "POST",
      url: "/v1/issuer/credentials",
      headers: { "content-type": "application/json" },
      payload: {
        protocolVersion: "AnonLimit/v1",
        policyId: PHASE3_POLICY.id,
        policyVersion: PHASE3_POLICY.version,
      },
    });
    expect(issuanceResponse.statusCode).toBe(200);
    const issuance = issuanceResponseSchema.parse(issuanceResponse.json());
    expect(issuance.policy).toEqual(PHASE3_POLICY);

    const challengeResponse = await app.inject({
      method: "POST",
      url: "/v1/verifier/challenges",
      headers: { "content-type": "application/json" },
      payload: {
        protocolVersion: "AnonLimit/v1",
        policyId: PHASE3_POLICY.id,
        policyVersion: PHASE3_POLICY.version,
        audience: PHASE3_POLICY.audience,
        operationId: operation,
        action: PHASE3_ACTION,
      },
    });
    expect(challengeResponse.statusCode).toBe(201);
    const challenge = challengeResponseSchema.parse(challengeResponse.json());
    const presentation = await createPhase3Presentation({
      credential: issuance.credential,
      challenge,
      operationId: operation,
      hiddenSlot,
    });
    return { challenge, issuance, presentation };
  }

  async function submit(
    presentation: Presentation,
    options: { readonly idempotencyKey?: string; readonly contentType?: string } = {}
  ): Promise<InjectResponse> {
    if (!app) throw new Error("TEST_APP_UNAVAILABLE");
    const contentType = options.contentType ?? "application/json";
    return app.inject({
      method: "POST",
      url: "/v1/verifier/presentations",
      headers: {
        "content-type": contentType,
        "idempotency-key": options.idempotencyKey ?? presentation.operationId,
      },
      payload: contentType === "application/json" ? presentation : JSON.stringify(presentation),
    });
  }

  async function acceptanceCounts(): Promise<AcceptanceCounts> {
    if (!database) throw new Error("TEST_DATABASE_UNAVAILABLE");
    const result = await database.pool.query<AcceptanceCounts>(`
      SELECT
        (SELECT count(*)::integer FROM verifier.use_records) AS uses,
        (SELECT count(*)::integer FROM verifier.outbox_events) AS outbox,
        (SELECT count(*)::integer FROM verifier.protocol_events
          WHERE event_name = 'USE_ACCEPTED') AS accepted_events
    `);
    const counts = result.rows[0];
    if (!counts) throw new Error("TEST_DATABASE_INCONSISTENT");
    return counts;
  }

  async function expectNoAcceptance(challengeId: string): Promise<void> {
    if (!database) throw new Error("TEST_DATABASE_UNAVAILABLE");
    expect(await acceptanceCounts()).toEqual({ uses: 0, outbox: 0, accepted_events: 0 });
    const challenge = await database.pool.query<{ state: string; use_id: string | null }>(
      `SELECT state, use_id FROM verifier.verification_challenges WHERE challenge_id = $1`,
      [challengeId]
    );
    expect(challenge.rows).toEqual([{ state: "ISSUED", use_id: null }]);
  }

  async function waitForBlockedAcceptances(
    expectedCount: number,
    lockedRelation: "demo_runs" | "verification_challenges"
  ): Promise<void> {
    if (!database) throw new Error("TEST_DATABASE_UNAVAILABLE");
    const deadline = Date.now() + 2_000;
    do {
      const blocked = await database.pool.query<{ count: number }>(
        `SELECT count(*)::integer AS count
         FROM pg_stat_activity
         WHERE datname = current_database()
           AND usename = 'verifier_api'
           AND state = 'active'
           AND wait_event_type = 'Lock'
           AND query LIKE '%FOR UPDATE%'
           AND query LIKE $1`,
        [`%${lockedRelation}%`]
      );
      if ((blocked.rows[0]?.count ?? 0) >= expectedCount) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    } while (Date.now() < deadline);
    throw new Error("TEST_ACCEPTANCE_DID_NOT_BLOCK");
  }

  async function waitForDatabaseTime(timestamp: string): Promise<void> {
    if (!database) throw new Error("TEST_DATABASE_UNAVAILABLE");
    const deadline = Date.now() + 2_000;
    do {
      const result = await database.pool.query<{ reached: boolean }>(
        "SELECT clock_timestamp() >= $1::timestamptz AS reached",
        [timestamp]
      );
      if (result.rows[0]?.reached === true) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    } while (Date.now() < deadline);
    throw new Error("TEST_DATABASE_CLOCK_DID_NOT_ADVANCE");
  }

  it("reports ready only while verifier state has one active demo run", async () => {
    if (!app || !database) throw new Error("TEST_APP_UNAVAILABLE");
    const ready = await app.inject({ method: "GET", url: "/health/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: "ok", service: "api", phase: 1 });

    const closed = await database.pool.query<{ demo_run_id: string }>(`
      UPDATE verifier.demo_runs
      SET status = 'CLOSED', closed_at = clock_timestamp()
      WHERE status = 'ACTIVE'
      RETURNING demo_run_id
    `);
    const demoRunId = closed.rows[0]?.demo_run_id;
    if (!demoRunId) throw new Error("TEST_DATABASE_INCONSISTENT");
    try {
      const unavailable = await app.inject({ method: "GET", url: "/health/ready" });
      expect(unavailable.statusCode).toBe(503);
      expect(unavailable.json()).toEqual({ status: "unavailable", service: "api", phase: 1 });
    } finally {
      await database.pool.query(
        `UPDATE verifier.demo_runs
         SET status = 'ACTIVE', closed_at = NULL
         WHERE demo_run_id = $1`,
        [demoRunId]
      );
    }
  });

  it("commits one use, consumed challenge, READY outbox item, and safe event atomically", async () => {
    if (!database) throw new Error("TEST_DATABASE_UNAVAILABLE");
    const candidate = await createCandidate(310);
    const response = await submit(candidate.presentation);
    expect(response.statusCode).toBe(202);
    const accepted = useResultSchema.parse(response.json());
    expect(accepted).toMatchObject({
      status: "ACCEPTED_PENDING_ACTION",
      code: "ACCEPTED_PENDING_ACTION",
      replayed: false,
      usageDelta: 1,
      actionDelta: 0,
    });

    const [uses, challenges, outbox, events] = await Promise.all([
      database.pool.query<{
        use_id: string;
        status: string;
        scope_hash: string;
        nullifier_key: string;
        operation_id: string;
        intent_digest: string;
        action_key: string;
        cached_result: unknown;
        failure_code: string | null;
        completed_at: Date | null;
      }>(`
        SELECT use_id, status, scope_hash, nullifier_key, operation_id,
               intent_digest, action_key, cached_result, failure_code, completed_at
        FROM verifier.use_records
      `),
      database.pool.query<{ state: string; use_id: string | null }>(
        `SELECT state, use_id FROM verifier.verification_challenges WHERE challenge_id = $1`,
        [candidate.challenge.challengeId]
      ),
      database.pool.query<{
        use_id: string;
        event_type: string;
        action_key: string;
        safe_payload: unknown;
        state: string;
        attempt_count: number;
        lease_until: Date | null;
        delivered_at: Date | null;
      }>(`
        SELECT use_id, event_type, action_key, safe_payload, state,
               attempt_count, lease_until, delivered_at
        FROM verifier.outbox_events
      `),
      database.pool.query<{
        event_name: string;
        from_state: string;
        to_state: string;
        decision_code: string;
        usage_delta: number;
        action_delta: number;
        masked_use_ref: string;
      }>(`
        SELECT event_name, from_state, to_state, decision_code,
               usage_delta, action_delta, masked_use_ref
        FROM verifier.protocol_events
      `),
    ]);

    expect(await acceptanceCounts()).toEqual({ uses: 1, outbox: 1, accepted_events: 1 });
    expect(uses.rows).toHaveLength(1);
    expect(uses.rows[0]).toMatchObject({
      use_id: accepted.useId,
      status: "ACCEPTED_PENDING_ACTION",
      operation_id: candidate.presentation.operationId,
      cached_result: null,
      failure_code: null,
      completed_at: null,
    });
    expect(uses.rows[0]?.scope_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(uses.rows[0]?.nullifier_key).toMatch(/^hmac-sha256:[a-f0-9]{64}$/);
    expect(uses.rows[0]?.intent_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(uses.rows[0]?.action_key).toMatch(/^hmac-sha256:[a-f0-9]{64}$/);
    expect(challenges.rows).toEqual([{ state: "CONSUMED", use_id: accepted.useId }]);
    expect(outbox.rows).toEqual([
      {
        use_id: accepted.useId,
        event_type: "COMMIT_DEMO_ACTION",
        action_key: uses.rows[0]?.action_key,
        safe_payload: PHASE3_ACTION,
        state: "READY",
        attempt_count: 0,
        lease_until: null,
        delivered_at: null,
      },
    ]);
    expect(events.rows).toEqual([
      {
        event_name: "USE_ACCEPTED",
        from_state: "UNSEEN",
        to_state: "ACCEPTED_PENDING_ACTION",
        decision_code: "ACCEPTED_PENDING_ACTION",
        usage_delta: 1,
        action_delta: 0,
        masked_use_ref: expect.stringMatching(/^use_[a-f0-9]{12}$/),
      },
    ]);

    const persisted = JSON.stringify({ uses: uses.rows, outbox: outbox.rows, events: events.rows });
    expect(persisted).not.toContain(candidate.presentation.nullifier);
    expect(persisted).not.toContain(candidate.presentation.opaqueProof);
    expect(persisted).not.toContain(candidate.challenge.nonce);
  });

  it("rejects a structurally valid presentation with an invalid proof without mutation", async () => {
    const candidate = await createCandidate(320);
    const response = await submit(tamperOpaqueProof(candidate.presentation));
    expect(response.statusCode).toBe(422);
    expect(publicErrorSchema.parse(response.json())).toMatchObject({
      code: "PRESENTATION_REJECTED",
      usageDelta: 0,
      actionDelta: 0,
    });
    await expectNoAcceptance(candidate.challenge.challengeId);
  });

  it("maps a verifier provider exception to service unavailable without mutation", async () => {
    const candidate = await createCandidate(325);
    verifierFailure = true;
    const response = await submit(candidate.presentation);
    expect(response.statusCode).toBe(503);
    expect(publicErrorSchema.parse(response.json())).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      usageDelta: 0,
      actionDelta: 0,
    });
    await expectNoAcceptance(candidate.challenge.challengeId);
  });

  it("rejects an audience and policy binding mismatch without mutation", async () => {
    const candidate = await createCandidate(330);
    const audienceMismatch = await submit({
      ...candidate.presentation,
      audience: "other-service",
    });
    expect(audienceMismatch.statusCode).toBe(422);
    expect(publicErrorSchema.parse(audienceMismatch.json())).toMatchObject({
      code: "POLICY_REJECTED",
      usageDelta: 0,
      actionDelta: 0,
    });

    const policyMismatch = await submit({ ...candidate.presentation, policyVersion: 2 });
    expect(policyMismatch.statusCode).toBe(422);
    expect(publicErrorSchema.parse(policyMismatch.json())).toMatchObject({
      code: "POLICY_REJECTED",
      usageDelta: 0,
      actionDelta: 0,
    });
    await expectNoAcceptance(candidate.challenge.challengeId);
  });

  it("resolves an exact pending retry before checking challenge freshness", async () => {
    const candidate = await createCandidate(345);
    const firstResponse = await submit(candidate.presentation);
    expect(firstResponse.statusCode).toBe(202);
    const first = useResultSchema.parse(firstResponse.json());
    expect(first).toMatchObject({
      status: "ACCEPTED_PENDING_ACTION",
      code: "ACCEPTED_PENDING_ACTION",
      replayed: false,
      usageDelta: 1,
      actionDelta: 0,
    });

    clock = Date.parse(candidate.challenge.expiresAt);
    const retryResponse = await submit(candidate.presentation);
    expect(retryResponse.statusCode).toBe(202);
    expect(useResultSchema.parse(retryResponse.json())).toEqual({
      useId: first.useId,
      status: "ACCEPTED_PENDING_ACTION",
      code: "RETRY_IN_PROGRESS",
      replayed: true,
      usageDelta: 0,
      actionDelta: 0,
    });
    expect(await acceptanceCounts()).toEqual({ uses: 1, outbox: 1, accepted_events: 1 });
  });

  it("converges two exact submissions that overlap inside PostgreSQL", async () => {
    if (!database) throw new Error("TEST_DATABASE_UNAVAILABLE");
    const candidate = await createCandidate(347);
    const blocker = await database.pool.connect();
    let released = false;
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT demo_run_id FROM verifier.demo_runs WHERE status = 'ACTIVE' FOR UPDATE"
      );

      let settled = 0;
      const submissions = [submit(candidate.presentation), submit(candidate.presentation)].map(
        (submission) =>
          submission.finally(() => {
            settled += 1;
          })
      );
      await waitForBlockedAcceptances(2, "demo_runs");
      expect(settled).toBe(0);
      await blocker.query("COMMIT");
      released = true;

      const responses = await Promise.all(submissions);
      expect(responses.map((response) => response.statusCode)).toEqual([202, 202]);
      const results = responses.map((response) => useResultSchema.parse(response.json()));
      const accepted = results.find((result) => result.replayed === false);
      const retry = results.find((result) => result.replayed === true);
      if (!accepted || !retry) throw new Error("TEST_RESPONSES_DID_NOT_CONVERGE");
      expect(accepted).toMatchObject({
        status: "ACCEPTED_PENDING_ACTION",
        code: "ACCEPTED_PENDING_ACTION",
        usageDelta: 1,
        actionDelta: 0,
      });
      expect(retry).toEqual({
        useId: accepted.useId,
        status: "ACCEPTED_PENDING_ACTION",
        code: "RETRY_IN_PROGRESS",
        replayed: true,
        usageDelta: 0,
        actionDelta: 0,
      });
      expect(await acceptanceCounts()).toEqual({ uses: 1, outbox: 1, accepted_events: 1 });
      const challenge = await database.pool.query<{ state: string; use_id: string | null }>(
        `SELECT state, use_id
         FROM verifier.verification_challenges
         WHERE challenge_id = $1`,
        [candidate.challenge.challengeId]
      );
      expect(challenge.rows).toEqual([{ state: "CONSUMED", use_id: accepted.useId }]);
    } finally {
      if (!released) await blocker.query("ROLLBACK");
      blocker.release();
    }
  });

  it("rejects an expired first-use challenge without mutation", async () => {
    const candidate = await createCandidate(340);
    clock = Date.parse(candidate.challenge.expiresAt);
    const response = await submit(candidate.presentation);
    expect(response.statusCode).toBe(410);
    expect(publicErrorSchema.parse(response.json())).toMatchObject({
      code: "CHALLENGE_EXPIRED",
      usageDelta: 0,
      actionDelta: 0,
    });
    await expectNoAcceptance(candidate.challenge.challengeId);
  });

  it("uses the database clock after a lock wait lets a challenge expire", async () => {
    if (!database) throw new Error("TEST_DATABASE_UNAVAILABLE");
    await stopTestApp();
    const databaseClock = await database.pool.query<{ current_time: Date | string }>(
      "SELECT clock_timestamp() AS current_time"
    );
    const currentTime = databaseClock.rows[0]?.current_time;
    if (!currentTime) throw new Error("TEST_DATABASE_INCONSISTENT");
    clock = new Date(currentTime).getTime();
    await startTestApp(1_000);
    const candidate = await createCandidate(342);

    const blocker = await database.pool.connect();
    let released = false;
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        `SELECT challenge_id
         FROM verifier.verification_challenges
         WHERE challenge_id = $1
         FOR UPDATE`,
        [candidate.challenge.challengeId]
      );

      const submission = submit(candidate.presentation);
      await waitForBlockedAcceptances(1, "verification_challenges");
      await waitForDatabaseTime(candidate.challenge.expiresAt);
      await blocker.query("COMMIT");
      released = true;

      const response = await submission;
      expect(response.statusCode).toBe(410);
      expect(publicErrorSchema.parse(response.json())).toMatchObject({
        code: "CHALLENGE_EXPIRED",
        usageDelta: 0,
        actionDelta: 0,
      });
      await expectNoAcceptance(candidate.challenge.challengeId);
    } finally {
      if (!released) await blocker.query("ROLLBACK");
      blocker.release();
    }
  });

  it("rolls back the use, challenge, outbox, and event when the final write fails", async () => {
    if (!database) throw new Error("TEST_DATABASE_UNAVAILABLE");
    const candidate = await createCandidate(350);
    await database.pool.query(`
      CREATE FUNCTION ${FORCE_ROLLBACK_FUNCTION}()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_name = 'USE_ACCEPTED' THEN
          RAISE EXCEPTION 'forced Phase 3 rollback';
        END IF;
        RETURN NEW;
      END
      $$
    `);
    await database.pool.query(`
      CREATE TRIGGER ${FORCE_ROLLBACK_TRIGGER}
      BEFORE INSERT ON verifier.protocol_events
      FOR EACH ROW EXECUTE FUNCTION ${FORCE_ROLLBACK_FUNCTION}()
    `);

    let response: InjectResponse;
    try {
      response = await submit(candidate.presentation);
    } finally {
      await removeForcedRollback();
    }
    expect(response.statusCode).toBe(500);
    expect(publicErrorSchema.parse(response.json())).toMatchObject({
      code: "INTERNAL_ERROR",
      usageDelta: 0,
      actionDelta: 0,
    });
    await expectNoAcceptance(candidate.challenge.challengeId);
  });

  it("prevents every immutable accepted-use field from changing", async () => {
    if (!database) throw new Error("TEST_DATABASE_UNAVAILABLE");
    const candidate = await createCandidate(360);
    const response = await submit(candidate.presentation);
    const accepted = useResultSchema.parse(response.json());
    expect(response.statusCode).toBe(202);
    const immutableFields = [
      ["demo_run_id", operationId(900)],
      ["scope_hash", `sha256:${"a".repeat(64)}`],
      ["nullifier_key", `hmac-sha256:${"b".repeat(64)}`],
      ["operation_id", operationId(901)],
      ["intent_digest", `sha256:${"c".repeat(64)}`],
      ["action_key", `hmac-sha256:${"d".repeat(64)}`],
    ] as const;
    const before = await database.pool.query(
      `SELECT demo_run_id, scope_hash, nullifier_key, operation_id, intent_digest, action_key
       FROM verifier.use_records WHERE use_id = $1`,
      [accepted.useId]
    );

    for (const [column, value] of immutableFields) {
      let failure: unknown;
      try {
        await database.pool.query(
          `UPDATE verifier.use_records SET ${column} = $1 WHERE use_id = $2`,
          [value, accepted.useId]
        );
      } catch (error) {
        failure = error;
      }
      expect(databaseFailure(failure)).toEqual({
        code: "23514",
        constraint: "ck_use_records_identity_immutable",
      });
    }

    const after = await database.pool.query(
      `SELECT demo_run_id, scope_hash, nullifier_key, operation_id, intent_digest, action_key
       FROM verifier.use_records WHERE use_id = $1`,
      [accepted.useId]
    );
    expect(after.rows).toEqual(before.rows);
  });

  it("requires JSON and an idempotency key matching the presentation operation", async () => {
    const candidate = await createCandidate(370);
    const wrongContentType = await submit(candidate.presentation, { contentType: "text/plain" });
    expect(wrongContentType.statusCode).toBe(400);
    expect(publicErrorSchema.parse(wrongContentType.json()).code).toBe("BAD_REQUEST");

    const wrongKey = await submit(candidate.presentation, { idempotencyKey: operationId(999) });
    expect(wrongKey.statusCode).toBe(400);
    expect(publicErrorSchema.parse(wrongKey.json()).code).toBe("BAD_REQUEST");

    if (!app) throw new Error("TEST_APP_UNAVAILABLE");
    const oversized = await app.inject({
      method: "POST",
      url: "/v1/verifier/presentations",
      headers: {
        "content-type": "application/json",
        "idempotency-key": candidate.presentation.operationId,
      },
      payload: JSON.stringify({ ...candidate.presentation, padding: "x".repeat(17_000) }),
    });
    expect(oversized.statusCode).toBe(400);
    expect(publicErrorSchema.parse(oversized.json())).toMatchObject({
      code: "BAD_REQUEST",
      usageDelta: 0,
      actionDelta: 0,
    });
    await expectNoAcceptance(candidate.challenge.challengeId);
  });
});
