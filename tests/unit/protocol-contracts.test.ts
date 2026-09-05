import { describe, expect, it } from "vitest";
import {
  actionSchema,
  challengeRequestSchema,
  challengeResponseSchema,
  demoDropAckRequestSchema,
  demoLinkabilityRequestSchema,
  demoRaceRequestSchema,
  demoResetRequestSchema,
  demoResetResponseSchema,
  eventNameSchema,
  evidenceReportSchema,
  issuanceRequestSchema,
  issuanceResponseSchema,
  linkabilityReportSchema,
  opaqueCredentialSchema,
  opaqueProofSchema,
  policySchema,
  presentationSchema,
  protocolEventSchema,
  publicErrorSchema,
  receiptSchema,
  useResultSchema,
  useStatusResponseSchema,
} from "@anonlimit/contracts";
import {
  internalActionRequestSchema,
  internalActionResponseSchema,
} from "@anonlimit/contracts/internal-action";

const id = "00000000-0000-4000-8000-000000000001";
const secondId = "00000000-0000-4000-8000-000000000002";
const actionKey = `hmac-sha256:${"a".repeat(64)}`;
const digest = `sha256:${"b".repeat(64)}`;
const policy = {
  id: "anon-demo",
  version: 1,
  issuerKeyId: "demo-issuer-v1",
  audience: "demo-service",
  maxUses: 3,
  quotaWindowId: "hackathon-demo",
  status: "ACTIVE",
  validFrom: "2026-09-05T00:00:00.000Z",
  validUntil: "2026-09-06T00:00:00.000Z",
};
const action = { type: "REDEEM_DEMO_BENEFIT", payload: { benefitCode: "HACKATHON" } };
const issuanceRequest = {
  protocolVersion: "AnonLimit/v1",
  policyId: policy.id,
  policyVersion: policy.version,
};
const challengeRequest = { ...issuanceRequest, audience: policy.audience, operationId: id, action };
const challengeResponse = {
  challengeId: secondId,
  nonce: "c".repeat(64),
  policyDigest: digest,
  expiresAt: "2026-09-05T00:01:00.000Z",
};
const presentation = {
  ...challengeRequest,
  challengeId: secondId,
  nonce: challengeResponse.nonce,
  nullifier: "d".repeat(64),
  opaqueProof: "simulated_proof_opaque_value",
};
const receipt = {
  receiptId: secondId,
  useId: id,
  actionKey,
  status: "COMMITTED",
  committedAt: "2026-09-05T00:00:01.000Z",
};
const internalAction = {
  demoRunId: id,
  useId: id,
  actionKey,
  intentDigest: digest,
  payloadDigest: digest,
  action,
};
const event = {
  sequence: 1,
  occurredAt: receipt.committedAt,
  event: "USE_ACCEPTED",
  traceId: id,
  demoRunId: secondId,
  policyId: policy.id,
  policyVersion: 1,
  usageDelta: 1,
  actionDelta: 0,
  maskedUseRef: "use_abcdef123456",
};
const unmeasuredEvidence = {
  protocolVersion: "AnonLimit/v1",
  demoRunId: id,
  generatedAt: receipt.committedAt,
  declaredLimit: 3,
  counts: {
    committedUses: null,
    outboxEvents: null,
    externalActions: null,
    retryUsageDelta: null,
    retryActionDelta: null,
    failedAttemptUses: null,
    credentialWideIdentifiersStored: null,
    storedHolderIdentities: null,
    linkedDistinctLegitimateUsePairs: null,
  },
  checks: {
    boundedUse: { status: "NOT_RUN" },
    singleAcceptance: { status: "NOT_RUN" },
    retryIdempotency: { status: "NOT_RUN" },
    noFailedVerificationConsumption: { status: "NOT_RUN" },
    singleExternalEffect: { status: "NOT_RUN" },
    recoverability: { status: "NOT_RUN" },
    noStableIdentity: { status: "NOT_RUN" },
    distinctUseUnlinkability: { status: "NOT_RUN" },
    retryRecognition: { status: "NOT_RUN" },
    overLimitRejected: { status: "NOT_RUN" },
    allReceiptsStable: { status: "NOT_RUN" },
  },
  overall: "NOT_RUN",
  uses: [],
  linkability: { status: "NOT_RUN", pairs: [] },
};

describe("strict public protocol boundaries", () => {
  it("accepts policy, issuance, challenge, and presentation without holder identity", () => {
    expect(policySchema.parse(policy)).toEqual(policy);
    expect(issuanceRequestSchema.parse(issuanceRequest)).toEqual(issuanceRequest);
    expect(
      issuanceResponseSchema.parse({
        protocolVersion: "AnonLimit/v1",
        demoRunId: id,
        credential: "opaque_credential_for_simulation",
        policy,
      }).policy.maxUses
    ).toBe(3);
    expect(challengeRequestSchema.parse(challengeRequest)).toEqual(challengeRequest);
    expect(challengeResponseSchema.parse(challengeResponse)).toEqual(challengeResponse);
    expect(presentationSchema.parse(presentation)).toEqual(presentation);
  });
  it.each([
    "holderId",
    "credentialId",
    "hiddenSlot",
    "email",
    "accountId",
    "demoRunId",
    "quotaScope",
    "quotaWindowId",
    "intentDigest",
    "policyDigest",
  ])("rejects caller-supplied %s", (field) => {
    expect(presentationSchema.safeParse({ ...presentation, [field]: "unreviewed" }).success).toBe(
      false
    );
    expect(
      challengeRequestSchema.safeParse({ ...challengeRequest, [field]: "unreviewed" }).success
    ).toBe(false);
  });
  it("rejects identity-bearing fields nested in action and policy responses", () => {
    expect(actionSchema.safeParse({ ...action, recipient: "person" }).success).toBe(false);
    expect(
      actionSchema.safeParse({
        ...action,
        payload: { ...action.payload, email: "person@example.test" },
      }).success
    ).toBe(false);
    expect(
      actionSchema.safeParse({ ...action, payload: { benefitCode: "person@example.test" } }).success
    ).toBe(false);
    expect(
      issuanceResponseSchema.safeParse({
        protocolVersion: "AnonLimit/v1",
        demoRunId: id,
        credential: "opaque_credential_for_simulation",
        policy: { ...policy, holderId: "person" },
      }).success
    ).toBe(false);
    expect(
      issuanceRequestSchema.safeParse({ ...issuanceRequest, demoRunId: secondId }).success
    ).toBe(false);
  });
  it.each([0, -1, 1.5, 101, Infinity, NaN])("rejects invalid maxUses %s", (maxUses) => {
    expect(policySchema.safeParse({ ...policy, maxUses }).success).toBe(false);
  });
  it("requires a valid increasing UTC policy interval and version", () => {
    expect(policySchema.safeParse({ ...policy, validUntil: policy.validFrom }).success).toBe(false);
    expect(policySchema.safeParse({ ...policy, validFrom: "2026-02-30T00:00:00Z" }).success).toBe(
      false
    );
    expect(
      policySchema.safeParse({ ...policy, validUntil: "2026-09-06T00:00:00+05:30" }).success
    ).toBe(false);
    expect(policySchema.safeParse({ ...policy, version: 0 }).success).toBe(false);
    expect(
      presentationSchema.safeParse({ ...presentation, protocolVersion: "AnonLimit/v2" }).success
    ).toBe(false);
  });
  it("bounds opaque values and refuses readable JSON, control characters, malformed IDs and markers", () => {
    expect(opaqueCredentialSchema.safeParse("a".repeat(262_144)).success).toBe(true);
    expect(opaqueCredentialSchema.safeParse("a".repeat(262_145)).success).toBe(false);
    expect(opaqueProofSchema.safeParse("a".repeat(8_193)).success).toBe(false);
    expect(opaqueProofSchema.safeParse('{"credential":"secret"}').success).toBe(false);
    expect(opaqueProofSchema.safeParse("opaque_proof\nvalue").success).toBe(false);
    expect(
      presentationSchema.safeParse({ ...presentation, operationId: "holder@example.test" }).success
    ).toBe(false);
    expect(
      presentationSchema.safeParse({ ...presentation, nullifier: "D".repeat(64) }).success
    ).toBe(false);
    expect(
      challengeResponseSchema.safeParse({ ...challengeResponse, policyDigest: "b".repeat(64) })
        .success
    ).toBe(false);
  });
});

describe("use results and destination receipts", () => {
  const results = [
    {
      useId: id,
      status: "ACCEPTED_PENDING_ACTION",
      code: "ACCEPTED_PENDING_ACTION",
      replayed: false,
      usageDelta: 1,
      actionDelta: 0,
    },
    {
      useId: id,
      status: "ACCEPTED_PENDING_ACTION",
      code: "RETRY_IN_PROGRESS",
      replayed: true,
      usageDelta: 0,
      actionDelta: 0,
    },
    {
      useId: id,
      status: "SUCCEEDED",
      code: "SUCCEEDED",
      replayed: false,
      usageDelta: 1,
      actionDelta: 1,
      receipt,
    },
    {
      useId: id,
      status: "SUCCEEDED",
      code: "RETRY_RESOLVED",
      replayed: true,
      usageDelta: 0,
      actionDelta: 0,
      receipt,
    },
    {
      useId: id,
      status: "FAILED_FINAL",
      code: "ACTION_FAILED_FINAL",
      replayed: false,
      usageDelta: 1,
      actionDelta: 0,
      failureCode: "ACTION_FAILED_FINAL",
    },
    {
      useId: id,
      status: "FAILED_FINAL",
      code: "RETRY_RESOLVED",
      replayed: true,
      usageDelta: 0,
      actionDelta: 0,
      failureCode: "ACTION_FAILED_FINAL",
    },
  ];
  it.each(results)("accepts $code replayed=$replayed only with coherent deltas", (result) => {
    expect(useResultSchema.safeParse(result).success).toBe(true);
    expect(useResultSchema.safeParse({ ...result, replayed: !result.replayed }).success).toBe(
      false
    );
    expect(
      useResultSchema.safeParse({ ...result, usageDelta: result.usageDelta === 0 ? 1 : 0 }).success
    ).toBe(false);
  });
  it("rejects mismatched receipts, extra result data, and terminal state without result", () => {
    expect(
      useResultSchema.safeParse({ ...results[3], receipt: { ...receipt, useId: secondId } }).success
    ).toBe(false);
    expect(useResultSchema.safeParse({ ...results[1], receipt }).success).toBe(false);
    expect(useStatusResponseSchema.safeParse({ useId: id, status: "SUCCEEDED" }).success).toBe(
      false
    );
    expect(
      useStatusResponseSchema.safeParse({
        useId: id,
        status: "FAILED_FINAL",
        failureCode: "provider secret",
      }).success
    ).toBe(false);
    expect(receiptSchema.safeParse({ ...receipt, credential: "secret" }).success).toBe(false);
    expect(useStatusResponseSchema.parse({ useId: id, status: "SUCCEEDED", receipt })).toEqual({
      useId: id,
      status: "SUCCEEDED",
      receipt,
    });
  });
  it("restricts worker delivery to approved action fields and enforces zero effect on replay", () => {
    expect(internalActionRequestSchema.parse(internalAction)).toEqual(internalAction);
    for (const field of ["nullifier", "opaqueProof", "credential", "hiddenSlot", "holderId"]) {
      expect(
        internalActionRequestSchema.safeParse({ ...internalAction, [field]: "secret" }).success
      ).toBe(false);
    }
    expect(
      internalActionResponseSchema.safeParse({ receipt, replayed: true, actionDelta: 0 }).success
    ).toBe(true);
    expect(
      internalActionResponseSchema.safeParse({ receipt, replayed: true, actionDelta: 1 }).success
    ).toBe(false);
  });
});

describe("safe events, errors, and demo controls", () => {
  it("requires allowlisted event names and rejects sensitive event/error fields", () => {
    expect(protocolEventSchema.parse(event)).toEqual(event);
    expect(eventNameSchema.safeParse("CACHED_RECEIPT_RETURNED").success).toBe(true);
    for (const field of [
      "message",
      "opaqueProof",
      "nullifier",
      "credential",
      "hiddenSlot",
      "userAgent",
      "ipAddress",
    ]) {
      expect(protocolEventSchema.safeParse({ ...event, [field]: "secret" }).success).toBe(false);
    }
    expect(protocolEventSchema.safeParse({ ...event, event: "some provider text" }).success).toBe(
      false
    );
    expect(protocolEventSchema.safeParse({ ...event, maskedUseRef: "d".repeat(64) }).success).toBe(
      false
    );
    expect(protocolEventSchema.safeParse({ ...event, usageDelta: 0.5 }).success).toBe(false);
    const error = { code: "PRESENTATION_REJECTED", traceId: id, usageDelta: 0, actionDelta: 0 };
    expect(publicErrorSchema.parse(error)).toEqual(error);
    expect(publicErrorSchema.safeParse({ ...error, code: "BOUND_EXCEEDED" }).success).toBe(false);
    expect(publicErrorSchema.safeParse({ ...error, stack: "secret" }).success).toBe(false);
  });
  it("prevents caller-selected reset scope and bounds nested controlled scenarios", () => {
    expect(demoResetRequestSchema.safeParse({}).success).toBe(true);
    expect(demoResetRequestSchema.safeParse({ demoRunId: id }).success).toBe(false);
    expect(
      demoResetResponseSchema.safeParse({
        protocolVersion: "AnonLimit/v1",
        demoRunId: id,
        resetAt: receipt.committedAt,
        policy,
      }).success
    ).toBe(true);
    expect(demoDropAckRequestSchema.safeParse({ operationId: id }).success).toBe(true);
    expect(demoRaceRequestSchema.safeParse({ presentation, copies: 20 }).success).toBe(true);
    expect(demoRaceRequestSchema.safeParse({ presentation, copies: 21 }).success).toBe(false);
    expect(
      demoLinkabilityRequestSchema.safeParse({
        presentations: [presentation, presentation],
        credentialLabels: ["holder"],
      }).success
    ).toBe(false);
    expect(
      demoRaceRequestSchema.safeParse({
        presentation: { ...presentation, credentialId: "holder" },
        copies: 20,
      }).success
    ).toBe(false);
  });
});

describe("evidence preserves unmeasured checks", () => {
  it("retains NOT_RUN and null measurements and rejects an unsupported overall PASS", () => {
    expect(evidenceReportSchema.parse(unmeasuredEvidence)).toEqual(unmeasuredEvidence);
    expect(evidenceReportSchema.safeParse({ ...unmeasuredEvidence, overall: "PASS" }).success).toBe(
      false
    );
    expect(
      evidenceReportSchema.safeParse({
        ...unmeasuredEvidence,
        counts: { ...unmeasuredEvidence.counts, holderId: "person" },
      }).success
    ).toBe(false);
    expect(
      evidenceReportSchema.safeParse({
        ...unmeasuredEvidence,
        checks: {
          ...unmeasuredEvidence.checks,
          boundedUse: { status: "PASS", detail: "private value" },
        },
      }).success
    ).toBe(false);
  });
  it("requires actual, consistent, distinct comparisons instead of an empty passing audit", () => {
    expect(linkabilityReportSchema.safeParse({ status: "PASS", pairs: [] }).success).toBe(false);
    const pair = {
      leftUseRef: "use_000000000001",
      rightUseRef: "use_000000000002",
      expected: "UNLINKABLE",
      result: "UNLINKABLE",
    };
    expect(linkabilityReportSchema.safeParse({ status: "PASS", pairs: [pair] }).success).toBe(true);
    expect(linkabilityReportSchema.safeParse({ status: "PASS", pairs: [pair, pair] }).success).toBe(
      false
    );
    expect(
      linkabilityReportSchema.safeParse({
        status: "PASS",
        pairs: [{ ...pair, result: "SAME_USE" }],
      }).success
    ).toBe(false);
    expect(
      linkabilityReportSchema.safeParse({
        status: "FAIL",
        pairs: [{ ...pair, result: "SAME_USE" }],
      }).success
    ).toBe(true);
    expect(
      linkabilityReportSchema.safeParse({
        status: "PASS",
        pairs: [{ ...pair, rightUseRef: pair.leftUseRef }],
      }).success
    ).toBe(false);
  });
  it("does not accept partial pair coverage or a missing retry comparison as passing evidence", () => {
    const uses = ["use_000000000001", "use_000000000002", "use_000000000003"].map(
      (maskedUseRef) => ({
        maskedUseRef,
        intentDigest: digest,
        status: "ACCEPTED_PENDING_ACTION",
        receiptId: null,
        actionKey,
      })
    );
    const incomplete = {
      ...unmeasuredEvidence,
      uses,
      checks: { ...unmeasuredEvidence.checks, distinctUseUnlinkability: { status: "PASS" } },
      linkability: {
        status: "PASS",
        pairs: [
          {
            leftUseRef: "use_000000000001",
            rightUseRef: "use_000000000002",
            expected: "UNLINKABLE",
            result: "UNLINKABLE",
          },
        ],
      },
    };
    expect(evidenceReportSchema.safeParse(incomplete).success).toBe(false);
    expect(
      evidenceReportSchema.safeParse({
        ...unmeasuredEvidence,
        checks: { ...unmeasuredEvidence.checks, retryRecognition: { status: "PASS" } },
      }).success
    ).toBe(false);
  });
});
