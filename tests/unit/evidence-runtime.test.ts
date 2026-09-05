import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type ProtocolEvent } from "@anonlimit/contracts";
import { computeScopeHash, type Receipt } from "@anonlimit/domain";
import { createEvidenceController } from "../../apps/api/src/modules/evidence/evidence-controller.js";
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
    traceId: `70000000-0000-4000-8000-00000000030${sequence}`,
    demoRunId: runId,
    policyId: policy.id,
    policyVersion: policy.version,
    usageDelta: name === "USE_ACCEPTED" ? 1 : 0,
    actionDelta: 0,
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
      maskedUseRef: `use_${String(index).repeat(12)}`,
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
      event(2, "RETRY_MATCHED", records[1]?.maskedUseRef),
      event(3, "OVER_LIMIT_REJECTED"),
    ],
    privacy: { storedHolderIdentities: 0, credentialWideIdentifiersStored: 0 },
  };
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function auditPresentations(data: VerifierEvidenceSnapshot): {
  readonly presentations: readonly Record<string, unknown>[];
  readonly challenges: ReadonlyMap<string, Record<string, unknown>>;
} {
  const challenges = new Map<string, Record<string, unknown>>();
  const presentations = data.uses.map((record, index) => {
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
    presentations: [...presentations, presentations[1] as Record<string, unknown>],
    challenges,
  };
}

describe("Phase 7 evidence runtime", () => {
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
        getChallenge: async (challengeId) => challenges.get(challengeId) as never,
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
