import { describe, expect, it } from "vitest";
import { policySchema } from "@anonlimit/contracts";
import {
  assertPolicy,
  assertPolicyFresh,
  assertPolicyBinding,
  assertChallengeFresh,
  classifyRetry,
  type Policy,
  type ChallengeBinding,
} from "@anonlimit/domain";
const policy: Policy = {
  id: "anon-demo",
  version: 1,
  issuerKeyId: "issuer",
  audience: "articles",
  maxUses: 3,
  status: "ACTIVE",
  quotaWindowId: "window",
  validFrom: "2026-09-05T00:00:00.000Z",
  validUntil: "2026-09-06T00:00:00.000Z",
};
const reference = {
  policyId: policy.id,
  policyVersion: policy.version,
  issuerKeyId: policy.issuerKeyId,
  audience: policy.audience,
  quotaWindowId: policy.quotaWindowId,
};
const challenge: ChallengeBinding = {
  challengeId: "challenge",
  nonce: "nonce",
  expiresAt: "2026-09-05T00:01:00.000Z",
  demoRunId: "run",
  scopeHash: "scope",
  operationId: "op",
  intentDigest: "intent",
  policyDigest: "policy",
};
describe("server policy and challenge freshness", () => {
  it("rejects disabled policy only for new acceptance", () => {
    expect(() =>
      assertPolicyFresh({ ...policy, status: "DISABLED" }, Date.parse(policy.validFrom))
    ).toThrow("POLICY_REJECTED");
    expect(() => assertPolicy({ ...policy, status: "DISABLED" })).not.toThrow();
  });
  it("uses an injected clock with inclusive start and exclusive end", () => {
    expect(() => assertPolicyFresh(policy, Date.parse(policy.validFrom))).not.toThrow();
    expect(() => assertPolicyFresh(policy, Date.parse(policy.validUntil) - 1)).not.toThrow();
    for (const now of [
      Date.parse(policy.validFrom) - 1,
      Date.parse(policy.validUntil),
      Number.NaN,
      Infinity,
    ])
      expect(() => assertPolicyFresh(policy, now)).toThrow("POLICY_REJECTED");
  });
  it("rejects invalid policy bounds and normalized invalid calendar dates", () => {
    for (const changed of [
      { ...policy, maxUses: 0 },
      { ...policy, maxUses: 1.5 },
      { ...policy, version: 0 },
      { ...policy, validUntil: policy.validFrom },
      { ...policy, validFrom: "2026-02-30T00:00:00.000Z" },
      { ...policy, validFrom: "yesterday" },
    ])
      expect(() => assertPolicy(changed)).toThrow("POLICY_REJECTED");
  });
  it("keeps wire and domain timestamp validation identical", () => {
    for (const validFrom of [
      "2026-09-05T00:00:00Z",
      "2026-09-05T00:00:00.1Z",
      "2026-09-05T00:00:00.12Z",
      "2026-09-05T00:00:00.123Z",
    ]) {
      const parsed = policySchema.parse({ ...policy, validFrom });
      expect(() => assertPolicy(parsed)).not.toThrow();
    }
    for (const validFrom of [
      "2026-09-05T00:00:00.1234Z",
      "2026-09-05T00:00:00+00:00",
      "2026-02-30T00:00:00Z",
    ]) {
      expect(policySchema.safeParse({ ...policy, validFrom }).success).toBe(false);
      expect(() => assertPolicy({ ...policy, validFrom })).toThrow("POLICY_REJECTED");
    }
  });
  it("checks every authorized policy reference field", () => {
    expect(() => assertPolicyBinding(policy, reference)).not.toThrow();
    for (const key of ["policyId", "issuerKeyId", "audience", "quotaWindowId"] as const)
      expect(() => assertPolicyBinding(policy, { ...reference, [key]: "changed" })).toThrow(
        "POLICY_REJECTED"
      );
    expect(() => assertPolicyBinding(policy, { ...reference, policyVersion: 2 })).toThrow(
      "POLICY_REJECTED"
    );
  });
  it("checks challenge state, every request binding, and exact expiry", () => {
    const issued = { ...challenge, state: "ISSUED" } as const;
    const now = Date.parse(challenge.expiresAt) - 1;
    expect(() => assertChallengeFresh(issued, challenge, now)).not.toThrow();
    for (const key of Object.keys(challenge) as (keyof ChallengeBinding)[])
      expect(() => assertChallengeFresh(issued, { ...challenge, [key]: "changed" }, now)).toThrow(
        "CHALLENGE_REJECTED"
      );
    expect(() => assertChallengeFresh({ ...issued, state: "CONSUMED" }, challenge, now)).toThrow(
      "CHALLENGE_REJECTED"
    );
    expect(() => assertChallengeFresh(issued, challenge, now + 1)).toThrow("CHALLENGE_EXPIRED");
  });
  it("can recover accepted work even after the original challenge and policy expire", () => {
    const incoming = {
      demoRunId: "run",
      scopeHash: "scope",
      operationId: "op",
      nullifierKey: "nf",
      intentDigest: "intent",
    };
    const record = { ...incoming, useId: "use", status: "ACCEPTED_PENDING_ACTION" } as const;
    expect(() => assertPolicyFresh(policy, Date.parse(policy.validUntil))).toThrow(
      "POLICY_REJECTED"
    );
    expect(classifyRetry(incoming, { byNullifier: record, byOperation: record })).toMatchObject({
      kind: "RETRY",
      code: "RETRY_IN_PROGRESS",
      usageDelta: 0,
    });
  });
});
