import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ApiEnv } from "@anonlimit/config/server";
import { publicErrorSchema } from "@anonlimit/contracts";
import { createSimulatedBoundaryProbeAdapter } from "@anonlimit/crypto/audit";
import { createSimulatedIssuer } from "@anonlimit/crypto/issuer";
import {
  createLookupProtection,
  createSimulatedVerifier,
  sha256Hex,
} from "@anonlimit/crypto/verifier";
import { seedDefaultPolicy } from "@anonlimit/db/seed";
import { createVerifierDatabase, type VerifierDatabase } from "@anonlimit/db/verifier";
import { createApp } from "../../apps/api/src/app.js";
import { createDemoBoundaryController } from "../../apps/api/src/modules/demo/boundary-controller.js";
import {
  createProtocolService,
  type ProtocolService,
} from "../../apps/api/src/modules/protocol/protocol-service.js";
import { startPhase3Postgres, type Phase3Postgres } from "../helpers/phase3-postgres.js";
import {
  createPhase3Presentation,
  PHASE3_ACTION,
  PHASE3_ACTION_KEY,
  PHASE3_ISSUER_SECRET,
  PHASE3_LEDGER_KEY,
  PHASE3_POLICY,
} from "../helpers/phase3-protocol.js";

describe("Phase 8 real demo boundary probe", () => {
  let database: Phase3Postgres | undefined;
  let repository: VerifierDatabase | undefined;
  let app: ReturnType<typeof createApp> | undefined;
  let protocol: ProtocolService | undefined;

  beforeAll(async () => {
    database = await startPhase3Postgres();
    await database.migrate();
    await seedDefaultPolicy(database.ownerConnectionString, {
      issuerKeyId: PHASE3_POLICY.issuerKeyId,
    });
    repository = createVerifierDatabase(database.connectionStringFor("verifier_api"));
    const cryptoOptions = {
      issuerKeyId: PHASE3_POLICY.issuerKeyId,
      issuerSecret: PHASE3_ISSUER_SECRET,
    };
    protocol = createProtocolService({
      repository,
      issuer: createSimulatedIssuer(cryptoOptions),
      verifier: createSimulatedVerifier({ ...cryptoOptions, demoMode: true }),
      lookupProtection: createLookupProtection({
        ledgerKey: PHASE3_LEDGER_KEY,
        actionKey: PHASE3_ACTION_KEY,
      }),
      sha256Hex,
    });
    const config: ApiEnv = {
      nodeEnv: "test",
      logLevel: "silent",
      port: 4000,
      webOrigin: "http://localhost:5173",
      databaseUrl: database.connectionStringFor("verifier_api"),
      demoMode: true,
      actionServiceUrl: "http://localhost:4100",
      actionServiceToken: "44".repeat(32),
      verifierLedgerHmacKey: PHASE3_LEDGER_KEY,
      verifierActionHmacKey: PHASE3_ACTION_KEY,
      opaqueCryptoProvider: "simulated",
      issuerKeyId: PHASE3_POLICY.issuerKeyId,
      issuerPrivateKeyPath: "/test/issuer.key",
      issuerPublicParametersPath: "/test/issuer-public.json",
    };
    app = createApp(
      config,
      repository.check,
      protocol,
      undefined,
      undefined,
      undefined,
      undefined,
      createDemoBoundaryController({
        repository,
        protocol,
        probeAdapter: createSimulatedBoundaryProbeAdapter({ ...cryptoOptions, demoMode: true }),
        policyId: PHASE3_POLICY.id,
        policyVersion: PHASE3_POLICY.version,
      })
    );
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await repository?.close();
    await database?.stop();
  }, 30_000);

  it("rejects an authenticated fourth-slot proof after three uses without consuming a challenge or creating a use, outbox item, action, or receipt", async () => {
    if (!database || !protocol || !app) throw new Error("TEST_UNAVAILABLE");
    const traceId = "80000000-0000-4000-8000-000000000001";
    const { body: issuance } = await protocol.issueCredential(
      {
        protocolVersion: "AnonLimit/v1",
        policyId: PHASE3_POLICY.id,
        policyVersion: PHASE3_POLICY.version,
      },
      traceId
    );
    for (let hiddenSlot = 0; hiddenSlot < 3; hiddenSlot += 1) {
      const operationId = `80000000-0000-4000-8000-${(hiddenSlot + 2).toString().padStart(12, "0")}`;
      const { body: challenge } = await protocol.createChallenge({
        protocolVersion: "AnonLimit/v1",
        policyId: issuance.policy.id,
        policyVersion: issuance.policy.version,
        audience: issuance.policy.audience,
        operationId,
        action: PHASE3_ACTION,
      });
      const presentation = await createPhase3Presentation({
        credential: issuance.credential,
        challenge,
        operationId,
        hiddenSlot,
      });
      expect((await protocol.present(presentation, traceId)).statusCode).toBe(202);
    }
    const snapshot = async () => {
      const result = await database?.pool.query<Record<string, number>>(`SELECT
        (SELECT count(*)::int FROM verifier.use_records) AS uses,
        (SELECT count(*)::int FROM verifier.outbox_events) AS outbox,
        (SELECT count(*)::int FROM verifier.verification_challenges WHERE state = 'CONSUMED') AS consumed,
        (SELECT count(*)::int FROM action_sim.action_results) AS actions,
        (SELECT count(*)::int FROM verifier.use_records WHERE cached_result IS NOT NULL) AS receipts`);
      return result?.rows[0];
    };
    const before = await snapshot();
    expect(before).toEqual({ uses: 3, outbox: 3, consumed: 3, actions: 0, receipts: 0 });
    const response = await app.inject({
      method: "POST",
      url: "/v1/demo/attempt-fourth-use",
      payload: {},
    });
    expect(response.statusCode).toBe(422);
    expect(publicErrorSchema.parse(response.json())).toMatchObject({
      code: "PRESENTATION_REJECTED",
      usageDelta: 0,
      actionDelta: 0,
    });
    expect(await snapshot()).toEqual(before);
    const rejection = await database.pool.query<{
      event_name: string;
      usage_delta: number;
      action_delta: number;
    }>(
      "SELECT event_name, usage_delta, action_delta FROM verifier.protocol_events WHERE event_name = 'OVER_LIMIT_REJECTED'"
    );
    expect(rejection.rows).toEqual([
      { event_name: "OVER_LIMIT_REJECTED", usage_delta: 0, action_delta: 0 },
    ]);
  });
});
