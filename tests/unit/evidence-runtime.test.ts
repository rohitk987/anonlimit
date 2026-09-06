import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { insightsReportSchema, type Presentation, type ProtocolEvent } from "@anonlimit/contracts";
import { assertNoForbiddenData } from "@anonlimit/testing";
import type { AuditAdapter } from "@anonlimit/crypto/audit";
import type { AiNarrator } from "../../apps/api/src/modules/insights/ai-narrator.js";
import { computeScopeHash, type Receipt } from "@anonlimit/domain";
import {
  createEvidenceController,
  type EvidenceRepository,
} from "../../apps/api/src/modules/evidence/evidence-controller.js";
import { createEventStreamController } from "../../apps/api/src/modules/events/events-controller.js";
import { type VerifierEvidenceSnapshot } from "../../packages/db/src/verifier/evidence.queries.js";

const policy = {
  id: "anon-demo",
  version: 1,
  issuerKeyId: "demo-issuer-v1",
  audience: "demo-service",
  maxUses: 3,
  quotaWindowId: "hackathon-demo",
  status: "ACTIVE" as const,
  validFrom: "2026-01-01T00:00:00.000Z",
  validUntil: "2036-01-01T00:00:00.000Z",
};
const runId = "70000000-0000-4000-8000-000000000001";
const TRACE_ID = "70000000-0000-4000-8000-000000000099";

function receipt(index: number): Receipt {
  const useId = `70000000-0000-4000-8000-00000000010${index}`;
  const actionKey = `hmac-sha256:${String(index).repeat(64)}`;
  return {
    receiptId: `70000000-0000-4000-8000-00000000020${index}`,
    useId,
    actionKey,
    status: "COMMITTED",
    committedAt: "2026-09-05T00:00:00.000Z",
  };
}

function event(sequence: number, name: ProtocolEvent["event"], useRef?: string): ProtocolEvent {
  return {
    sequence,
    occurredAt: "2026-09-05T00:00:00.000Z",
    event: name,
    traceId: `70000000-0000-4000-8000-${String(300 + sequence).padStart(12, "0")}`,
    demoRunId: runId,
    policyId: policy.id,
    policyVersion: policy.version,
    usageDelta: name === "USE_ACCEPTED" ? 1 : 0,
    actionDelta: name === "EXTERNAL_ACTION_COMMITTED" ? 1 : 0,
    ...(useRef === undefined ? {} : { maskedUseRef: useRef }),
  };
}

function snapshot(): VerifierEvidenceSnapshot {
  const records = [1, 2, 3].map((index) => {
    const useId = `70000000-0000-4000-8000-00000000010${index}`;
    const item = receipt(index);
    return {
      acceptedUse: {
        useId,
        demoRunId: runId,
        scopeHash: "sha256:" + "a".repeat(64),
        nullifierKey: "hmac-sha256:" + String(index).repeat(64),
        operationId: `70000000-0000-4000-8000-00000000040${index}`,
        intentDigest: "sha256:" + String(index).repeat(64),
        status: "SUCCEEDED" as const,
        receipt: item,
      },
      actionKey: item.actionKey,
      maskedUseRef: `use_${digest(useId).slice(0, 12)}`,
    };
  });
  return {
    demoRunId: runId,
    policy,
    credentialIssuances: 1,
    uses: records,
    outboxUseIds: records.map((record) => record.acceptedUse.useId),
    events: [
      event(1, "CREDENTIAL_ISSUED"),
      ...records.flatMap((record, index) => [
        event(index * 2 + 2, "USE_ACCEPTED", record.maskedUseRef),
        event(index * 2 + 3, "EXTERNAL_ACTION_COMMITTED", record.maskedUseRef),
      ]),
      event(8, "RETRY_MATCHED", records[1]?.maskedUseRef),
      {
        ...event(9, "RETRY_RESOLVED", records[1]?.maskedUseRef),
        traceId: event(8, "RETRY_MATCHED").traceId,
      },
      {
        ...event(10, "CACHED_RECEIPT_RETURNED", records[1]?.maskedUseRef),
        traceId: event(8, "RETRY_MATCHED").traceId,
      },
      event(11, "OVER_LIMIT_REJECTED"),
    ],
    privacy: { storedHolderIdentities: 0, credentialWideIdentifiersStored: 0 },
  };
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function auditPresentations(data: VerifierEvidenceSnapshot): {
  readonly presentations: readonly Presentation[];
  readonly challenges: ReadonlyMap<
    string,
    NonNullable<Awaited<ReturnType<EvidenceRepository["getChallenge"]>>>
  >;
} {
  const challenges = new Map<
    string,
    NonNullable<Awaited<ReturnType<EvidenceRepository["getChallenge"]>>>
  >();
  const presentations = data.uses.map((record, index): Presentation => {
    const challengeId = `70000000-0000-4000-8000-00000000050${index + 1}`;
    const nonce = String(index + 1).repeat(64);
    const challenge = {
      challengeId,
      nonceHash: `sha256:${digest(nonce)}`,
      demoRunId: runId,
      policyId: policy.id,
      policyVersion: policy.version,
      operationId: record.acceptedUse.operationId,
      intentDigest: record.acceptedUse.intentDigest,
      scopeHash: record.acceptedUse.scopeHash,
      policyDigest: `sha256:${"f".repeat(64)}`,
      expiresAt: "2030-01-01T00:00:00.000Z",
    };
    challenges.set(challengeId, challenge);
    return {
      protocolVersion: "AnonLimit/v1",
      policyId: policy.id,
      policyVersion: policy.version,
      audience: policy.audience,
      operationId: record.acceptedUse.operationId,
      action: { type: "REDEEM_DEMO_BENEFIT", payload: { benefitCode: "HACKATHON" } },
      challengeId,
      nonce,
      nullifier: String(index + 1).repeat(64),
      opaqueProof: `proof-${String(index + 1).repeat(20)}`,
    };
  });
  return {
    presentations: [...presentations, presentations[1] as Presentation],
    challenges,
  };
}

const workingAudit: AuditAdapter = {
  testLinkability: async (left, right) => ({
    ok: true,
    result:
      left.presentation.nullifier === right.presentation.nullifier ? "SAME_USE" : "UNLINKABLE",
    basis: "SIMULATED_PROVIDER_ASSUMPTION",
  }),
};

async function fixture(adapter: AuditAdapter = workingAudit, aiNarrator?: AiNarrator) {
  const source = snapshot();
  const scopeHash = await computeScopeHash(policy, async (value) => digest(value));
  let data: VerifierEvidenceSnapshot = {
    ...source,
    uses: source.uses.map((record) => ({
      ...record,
      acceptedUse: { ...record.acceptedUse, scopeHash },
    })),
  };
  const { presentations, challenges } = auditPresentations(data);
  const controller = createEvidenceController({
    ...(aiNarrator ? { aiNarrator } : {}),
    repository: {
      getEvidenceSnapshot: async () => data,
      getChallenge: async (challengeId) => challenges.get(challengeId) ?? null,
      findAcceptedUses: async (input) => ({
        byNullifier:
          data.uses.find((record) => record.acceptedUse.nullifierKey === input.nullifierKey)
            ?.acceptedUse ?? null,
        byOperation:
          data.uses.find((record) => record.acceptedUse.operationId === input.operationId)
            ?.acceptedUse ?? null,
      }),
    },
    actionClient: {
      getEvidence: async () => ({
        externalActions: data.uses.length,
        receipts: data.uses.flatMap((record) =>
          record.acceptedUse.status === "SUCCEEDED" ? [record.acceptedUse.receipt] : []
        ),
      }),
    },
    auditAdapter: adapter,
    issuerPublicParameters: {
      provider: "SIMULATED_CAPABILITIES_V1",
      issuerKeyId: policy.issuerKeyId,
    },
    lookupProtection: {
      protectNullifier: async ({ rawNullifier }) => `hmac-sha256:${rawNullifier}`,
    },
    sha256Hex: async (value) => digest(value),
    now: () => Date.parse("2026-09-05T00:00:00.000Z"),
  });
  return {
    controller,
    presentations,
    get data() {
      return data;
    },
    setData(value: VerifierEvidenceSnapshot) {
      data = value;
    },
  };
}

describe("Phase 7 evidence runtime", () => {
  it("automatically summarizes the same evidence, without extra protocol mutations or identifiers", async () => {
    const test = await fixture();
    const partial = await test.controller.getInsights();
    expect(partial.summary.status).toBe("INCOMPLETE");
    await test.controller.runLinkability({ presentations: test.presentations }, TRACE_ID);
    const before = JSON.stringify(test.data);
    const report = insightsReportSchema.parse(await test.controller.getInsights());
    expect(report.summary.status).toBe("PASS");
    expect(report.summary.counts.committedUses).toBe(3);
    expect(report.abuse.counters).toMatchObject({
      attempts: 5,
      accepted: 3,
      retries: 1,
      overLimit: 1,
    });
    expect(report.abuse.level).toBe("QUIET");
    expect(report.ai.status).toBe("DISABLED");
    expect(JSON.stringify(test.data)).toBe(before);
    assertNoForbiddenData(report, {
      markers: test.presentations.flatMap((item) => [
        item.nullifier,
        item.opaqueProof,
        item.operationId,
        item.challengeId,
      ]),
    });
    expect(JSON.stringify(report)).not.toMatch(
      /traceId|maskedUseRef|receiptId|actionKey|intentDigest/
    );
    // Another server-owned run cannot inherit this run's completed audit or events.
    test.setData({
      ...test.data,
      demoRunId: "70000000-0000-4000-8000-000000000002",
      uses: [],
      outboxUseIds: [],
      events: [],
      credentialIssuances: 0,
    });
    const reset = await test.controller.getInsights();
    expect(reset.summary.status).not.toBe("PASS");
    expect(reset.abuse.level).toBe("NO_ACTIVITY");
  });

  it("keeps audit facts available if the optional AI adapter fails", async () => {
    const test = await fixture(workingAudit, {
      explain: async () => {
        throw new Error("PRIVATE_PROVIDER_ERROR");
      },
    });
    const report = await test.controller.getInsights();
    expect(report.summary.counts.committedUses).toBe(3);
    expect(report.ai).toEqual({ status: "UNAVAILABLE", commentary: null });
    expect(JSON.stringify(report)).not.toContain("PRIVATE_PROVIDER_ERROR");
  });
  it("reports backend measurements and keeps an unavailable audit explicitly incomplete", async () => {
    const data = snapshot();
    const controller = createEvidenceController({
      repository: {
        getEvidenceSnapshot: async () => data,
        getChallenge: async () => null,
        findAcceptedUses: async () => ({ byNullifier: null, byOperation: null }),
      },
      actionClient: {
        getEvidence: async () => ({
          externalActions: 3,
          receipts: data.uses.flatMap((record) =>
            record.acceptedUse.status === "SUCCEEDED" ? [record.acceptedUse.receipt] : []
          ),
        }),
      },
      issuerPublicParameters: {
        provider: "SIMULATED_CAPABILITIES_V1",
        issuerKeyId: policy.issuerKeyId,
      },
      lookupProtection: { protectNullifier: async () => "" },
      sha256Hex: async (value) => value,
      now: () => Date.parse("2026-09-05T00:00:00.000Z"),
    });
    const report = await controller.getEvidence();
    expect(report.overall).toBe("INCOMPLETE");
    expect(report.counts).toMatchObject({
      committedUses: 3,
      outboxEvents: 3,
      externalActions: 3,
      retryUsageDelta: 0,
      retryActionDelta: 0,
      failedAttemptUses: 0,
    });
    expect(report.linkability).toEqual({ status: "INCOMPLETE", pairs: [] });
    expect(JSON.stringify(report)).not.toContain("nullifierKey");
  });

  it("formats only allowlisted event data as replayable SSE frames", () => {
    const controller = createEventStreamController({
      getProtocolEvents: async () => [event(4, "USE_ACCEPTED", "use_aaaaaaaaaaaa")],
    });
    const frame = controller.format([event(4, "USE_ACCEPTED", "use_aaaaaaaaaaaa")]);
    expect(frame).toContain("id: 4\nevent: protocol\ndata: {");
    expect(frame).toContain('"event":"USE_ACCEPTED"');
    expect(frame).not.toContain("nullifier");
    expect(frame.endsWith("\n\n")).toBe(true);
  });

  it("cannot turn missing transactional evidence into zero retry deltas", async () => {
    const test = await fixture();
    test.setData({
      ...test.data,
      events: test.data.events.filter((item) => item.event !== "USE_ACCEPTED"),
    });
    const report = await test.controller.getEvidence();
    expect(report.checks.retryIdempotency.status).toBe("INCOMPLETE");
    expect(report.checks.overLimitRejected.status).toBe("INCOMPLETE");
    expect(report.counts.retryUsageDelta).toBeNull();
  });

  it("measures extra acceptance under a retry trace instead of fabricating unchanged totals", async () => {
    const test = await fixture();
    const retry = test.data.events.find((item) => item.event === "RETRY_MATCHED");
    if (!retry) throw new Error("TEST_FIXTURE_INVALID");
    test.setData({
      ...test.data,
      events: test.data.events.map((item) =>
        item.event === "USE_ACCEPTED" && item.maskedUseRef === test.data.uses[2]?.maskedUseRef
          ? { ...item, traceId: retry.traceId }
          : item
      ),
    });
    const report = await test.controller.getEvidence();
    expect(report.checks.retryIdempotency.status).toBe("FAIL");
    expect(report.counts.retryUsageDelta).toBe(1);
    expect(report.overall).toBe("FAIL");
  });

  it("cannot accept an incomplete retry event chain", async () => {
    const test = await fixture();
    test.setData({
      ...test.data,
      events: test.data.events.filter((item) => item.event !== "RETRY_RESOLVED"),
    });
    const report = await test.controller.getEvidence();
    expect(report.checks.retryIdempotency.status).toBe("INCOMPLETE");
    expect(report.counts.retryUsageDelta).toBeNull();
  });

  it.each(["throws", "rejects"])(
    "keeps unavailable audit output incomplete when the adapter %s",
    async (mode) => {
      const test = await fixture({
        testLinkability: async () => {
          if (mode === "throws") throw new Error("ADAPTER_UNAVAILABLE");
          return { ok: false, code: "PRESENTATION_REJECTED" };
        },
      });
      expect(
        await test.controller.runLinkability({ presentations: test.presentations }, TRACE_ID)
      ).toEqual({ status: "INCOMPLETE", pairs: [] });
      expect((await test.controller.getEvidence()).overall).toBe("INCOMPLETE");
    }
  );

  it("does not count a different proof for the same use as an exact replay", async () => {
    const test = await fixture();
    const presentations = test.presentations.map((presentation, index) =>
      index === 3
        ? { ...presentation, opaqueProof: presentation.opaqueProof + "changed" }
        : presentation
    );
    expect(await test.controller.runLinkability({ presentations }, TRACE_ID)).toEqual({
      status: "INCOMPLETE",
      pairs: [],
    });
  });

  it("requires a recorded verifier retry before claiming retry recognition", async () => {
    const test = await fixture();
    test.setData({
      ...test.data,
      events: test.data.events.filter((item) => item.event !== "RETRY_MATCHED"),
    });
    expect(
      await test.controller.runLinkability({ presentations: test.presentations }, TRACE_ID)
    ).toEqual({ status: "INCOMPLETE", pairs: [] });
  });

  it("runs all distinct-use pairs and recognizes only the exact retry", async () => {
    const source = snapshot();
    const actualScopeHash = await computeScopeHash(policy, async (value) => digest(value));
    const data: VerifierEvidenceSnapshot = {
      ...source,
      uses: source.uses.map((record) => ({
        ...record,
        acceptedUse: { ...record.acceptedUse, scopeHash: actualScopeHash },
        maskedUseRef: `use_${digest(record.acceptedUse.useId).slice(0, 12)}`,
      })),
    };
    const { presentations, challenges } = auditPresentations(data);
    const byOperation = new Map(
      data.uses.map((record) => [record.acceptedUse.operationId, record])
    );
    const byNullifier = new Map(
      data.uses.map((record, index) => [String(index + 1).repeat(64), record])
    );
    const controller = createEvidenceController({
      repository: {
        getEvidenceSnapshot: async () => data,
        getChallenge: async (challengeId) => challenges.get(challengeId) ?? null,
        findAcceptedUses: async (input) => {
          const record = byOperation.get(input.operationId) ?? byNullifier.get(input.nullifierKey);
          return {
            byNullifier:
              record?.acceptedUse.nullifierKey === input.nullifierKey ? record.acceptedUse : null,
            byOperation:
              record?.acceptedUse.operationId === input.operationId ? record.acceptedUse : null,
          };
        },
        appendProtocolEvent: async () => undefined,
      },
      actionClient: {
        getEvidence: async () => ({
          externalActions: 3,
          receipts: data.uses.flatMap((record) =>
            record.acceptedUse.status === "SUCCEEDED" ? [record.acceptedUse.receipt] : []
          ),
        }),
      },
      auditAdapter: {
        testLinkability: async (left, right) => ({
          ok: true,
          result:
            left.presentation.nullifier === right.presentation.nullifier
              ? "SAME_USE"
              : "UNLINKABLE",
          basis: "SIMULATED_PROVIDER_ASSUMPTION",
        }),
      },
      issuerPublicParameters: {
        provider: "SIMULATED_CAPABILITIES_V1",
        issuerKeyId: policy.issuerKeyId,
      },
      lookupProtection: {
        protectNullifier: async ({ rawNullifier }) =>
          byNullifier.get(rawNullifier)?.acceptedUse.nullifierKey ??
          "hmac-sha256:" + "0".repeat(64),
      },
      sha256Hex: async (value) => digest(value),
      now: () => Date.parse("2026-09-05T00:00:00.000Z"),
    });
    expect(actualScopeHash).toBe(data.uses[0]?.acceptedUse.scopeHash);
    const linkability = await controller.runLinkability({ presentations }, TRACE_ID);
    expect(linkability.status).toBe("PASS");
    expect(linkability.pairs).toHaveLength(4);
    expect(linkability.pairs.filter((pair) => pair.expected === "UNLINKABLE")).toHaveLength(3);
    expect(linkability.pairs.filter((pair) => pair.expected === "SAME_USE")).toHaveLength(1);
    const report = await controller.getEvidence();
    expect(report.overall).toBe("PASS");
    expect(Object.values(report.checks).every((check) => check.status === "PASS")).toBe(true);
    expect(report.counts).toMatchObject({
      committedUses: 3,
      externalActions: 3,
      retryUsageDelta: 0,
      retryActionDelta: 0,
      linkedDistinctLegitimateUsePairs: 0,
    });
  });
});
