import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { uuidSchema } from "@anonlimit/contracts";
import {
  canonicalJson,
  canonicalQuotaScope,
  canonicalAction,
  computePolicyDigest,
  computeScopeHash,
  computeIntentDigest,
  computeProofContext,
  deriveActionKey,
  deriveNullifierKey,
  PROTOCOL_VERSION,
  type Intent,
  type Policy,
} from "@anonlimit/domain";

const sha = async (input: string) => createHash("sha256").update(input, "utf8").digest("hex");
const hmac = async (key: string, input: string) =>
  createHmac("sha256", key).update(input, "utf8").digest("hex");
const policy: Policy = {
  id: "anon-demo",
  version: 1,
  issuerKeyId: "issuer-1",
  audience: "articles",
  maxUses: 3,
  status: "ACTIVE",
  quotaWindowId: "demo-window",
  validFrom: "2026-09-05T00:00:00.000Z",
  validUntil: "2026-09-06T00:00:00.000Z",
};
const intent: Intent = {
  protocolVersion: PROTOCOL_VERSION,
  operationId: "00000000-0000-4000-8000-000000000001",
  method: "POST",
  resource: "/v1/verifier/presentations",
  action: { type: "REDEEM_DEMO_BENEFIT", payload: { benefitCode: "HACKATHON" } },
};
const hex = "a".repeat(64);
const context = {
  protocolVersion: PROTOCOL_VERSION,
  scope: canonicalQuotaScope(policy),
  intentDigest: `sha256:${hex}`,
  challengeId: "00000000-0000-4000-8000-000000000002",
  nonce: hex,
  expiresAt: "2026-09-05T01:00:00.000Z",
  policyDigest: `sha256:${hex}`,
  demoRunId: "00000000-0000-4000-8000-000000000003",
};

describe("canonical protocol encoding", () => {
  it("matches fixed recursive, numeric-key, escaping, and Unicode vectors", () => {
    const vectors: readonly [unknown, string][] = [
      [
        { z: 1, a: { y: [true, null, -0], x: 'line\n"quote"' } },
        '{"a":{"x":"line\\n\\\"quote\\\"","y":[true,null,0]},"z":1}',
      ],
      [{ "2": "two", "10": "ten" }, '{"10":"ten","2":"two"}'],
      [
        { "😀": "emoji", é: "café", a: "हिन्दी", é: "combining" },
        '{"a":"हिन्दी","é":"combining","é":"café","😀":"emoji"}',
      ],
      [[1e30, 1e-7, 0.000001], "[1e+30,1e-7,0.000001]"],
    ];
    for (const [value, expected] of vectors) expect(canonicalJson(value)).toBe(expected);
    expect(canonicalJson({ word: "é" })).not.toBe(canonicalJson({ word: "é" }));
  });
  it("preserves repeated values without mistaking them for cycles", () => {
    const value = { value: "shared" };
    expect(canonicalJson([value, value])).toBe('[{"value":"shared"},{"value":"shared"}]');
  });
  it.each([
    undefined,
    Number.NaN,
    Infinity,
    -Infinity,
    1n,
    Symbol("x"),
    () => 0,
    new Date(0),
    new Map(),
    /x/u,
    "\ud800",
    [undefined],
    new Array(1),
    { value: undefined },
  ])("rejects non-JSON or ambiguous values %#", (value) => {
    expect(() => canonicalJson(value)).toThrow("INVALID_CANONICAL_VALUE");
  });
  it("rejects cycles, symbols, extra array fields, non-enumerable values, and accessors without executing them", () => {
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    const accessor = vi.fn(() => "private-value");
    const getter = Object.defineProperty({}, "secret", { enumerable: true, get: accessor });
    const hidden = Object.defineProperty({}, "hidden", { value: "secret" });
    const extraArray = Object.assign([1], { accountId: "private" });
    for (const value of [
      cycle,
      getter,
      hidden,
      extraArray,
      { [Symbol("hidden")]: "private" },
      { "\ud800": "bad" },
    ])
      expect(() => canonicalJson(value)).toThrow("INVALID_CANONICAL_VALUE");
    expect(accessor).not.toHaveBeenCalled();
  });
  it("only uses the five issuer-authorized scope fields", () => {
    expect(canonicalQuotaScope(policy)).toBe(
      '{"issuerKeyId":"issuer-1","policyId":"anon-demo","policyVersion":1,"quotaWindowId":"demo-window","verifierAudience":"articles"}'
    );
    expect(
      canonicalQuotaScope({ ...policy, maxUses: 4, validUntil: "2026-10-06T00:00:00.000Z" })
    ).toBe(canonicalQuotaScope(policy));
    const extra = { ...policy, operationId: "attacker", demoRunId: "other-run", action: "other" };
    expect(canonicalQuotaScope(extra)).toBe(canonicalQuotaScope(policy));
    expect(canonicalQuotaScope({ ...policy, id: "a:b", issuerKeyId: "c" })).not.toBe(
      canonicalQuotaScope({ ...policy, id: "a", issuerKeyId: "b:c" })
    );
  });
  it.each(["id", "version", "issuerKeyId", "audience", "quotaWindowId"] as const)(
    "scope changes with authorized %s",
    (key) => {
      const changed =
        key === "version" ? { ...policy, version: 2 } : { ...policy, [key]: "different" };
      expect(canonicalQuotaScope(changed)).not.toBe(canonicalQuotaScope(policy));
    }
  );
  it("rejects identity-bearing action fields and unapproved benefit codes", () => {
    const extra = { ...intent.action, userId: "private" };
    expect(() => canonicalAction(extra)).toThrow("INVALID_ACTION");
    const nested = { ...intent.action, payload: { benefitCode: "ABC", email: "private" } };
    expect(() => canonicalAction(nested)).toThrow("INVALID_ACTION");
    expect(() =>
      canonicalAction({ type: "REDEEM_DEMO_BENEFIT", payload: { benefitCode: "नमस्ते" } })
    ).toThrow("INVALID_ACTION");
  });
  it("hashes a fixed, independently specified intent encoding and reordered payload identically", async () => {
    const expectedEncoding =
      '{"domain":"AnonLimit/v1/intent","value":{"action":{"payload":{"benefitCode":"HACKATHON"},"type":"REDEEM_DEMO_BENEFIT"},"method":"POST","operationId":"00000000-0000-4000-8000-000000000001","protocolVersion":"AnonLimit/v1","resource":"/v1/verifier/presentations"}}';
    expect(await computeIntentDigest(intent, sha)).toBe(`sha256:${await sha(expectedEncoding)}`);
    expect(
      await computeIntentDigest(
        { ...intent, action: { payload: intent.action.payload, type: intent.action.type } },
        sha
      )
    ).toBe(await computeIntentDigest(intent, sha));
  });
  it("binds each mutable intent field", async () => {
    const baseline = await computeIntentDigest(intent, sha);
    for (const changed of [
      { ...intent, operationId: context.challengeId },
      { ...intent, method: "PUT" },
      { ...intent, resource: "/other" },
      { ...intent, action: { ...intent.action, payload: { benefitCode: "WORKSHOP" } } },
    ])
      expect(await computeIntentDigest(changed, sha)).not.toBe(baseline);
    await expect(computeIntentDigest({ ...intent, method: "post" }, sha)).rejects.toThrow(
      "INVALID_INTENT"
    );
    await expect(
      computeIntentDigest({ ...intent, resource: "/v1?identity=private" }, sha)
    ).rejects.toThrow("INVALID_INTENT");
  });
  it("keeps wire and domain UUID validation identical", async () => {
    const validIds = [
      "00000000-0000-4000-8000-000000000001",
      "018f47f2-c6a4-7cc8-a123-123456789abc",
    ];
    for (const operationId of validIds) {
      expect(uuidSchema.safeParse(operationId).success).toBe(true);
      await expect(computeIntentDigest({ ...intent, operationId }, sha)).resolves.toMatch(
        /^sha256:[a-f0-9]{64}$/
      );
    }
    for (const operationId of [
      "00000000-0000-0000-0000-000000000000",
      "018f47f2-c6a4-4cc8-7123-123456789abc",
      "018F47F2-C6A4-7CC8-A123-123456789ABC",
      "not-a-uuid",
    ]) {
      expect(uuidSchema.safeParse(operationId).success).toBe(false);
      await expect(computeIntentDigest({ ...intent, operationId }, sha)).rejects.toThrow(
        "INVALID_INTENT"
      );
    }
  });
  it("binds full policy validity and bounds without changing scope", async () => {
    const changed = { ...policy, maxUses: 4 };
    expect(await computeScopeHash(changed, sha)).toBe(await computeScopeHash(policy, sha));
    expect(await computePolicyDigest(changed, sha)).not.toBe(
      await computePolicyDigest(policy, sha)
    );
    expect(await computeScopeHash({ ...policy, status: "DISABLED" }, sha)).toBe(
      await computeScopeHash(policy, sha)
    );
    expect(await computePolicyDigest({ ...policy, status: "DISABLED" }, sha)).not.toBe(
      await computePolicyDigest(policy, sha)
    );
  });
  it("binds every proof context value, including server run outside quota scope", async () => {
    const baseline = await computeProofContext(context, sha);
    for (const changed of [
      { ...context, scope: canonicalQuotaScope({ ...policy, audience: "other" }) },
      { ...context, intentDigest: `sha256:${"b".repeat(64)}` },
      { ...context, policyDigest: `sha256:${"b".repeat(64)}` },
      { ...context, challengeId: intent.operationId },
      { ...context, demoRunId: intent.operationId },
      { ...context, nonce: "b".repeat(64) },
      { ...context, expiresAt: "2026-09-05T02:00:00.000Z" },
    ])
      expect(await computeProofContext(changed, sha)).not.toBe(baseline);
  });
  it("derives stable, separately keyed lookup/action values and rejects malformed hash adapters", async () => {
    const ledger = { scopeHash: await computeScopeHash(policy, sha), rawNullifier: hex };
    const action = {
      useId: intent.operationId,
      intentDigest: await computeIntentDigest(intent, sha),
    };
    const secret = "k".repeat(32);
    expect(await deriveNullifierKey(ledger, secret, hmac)).toBe(
      await deriveNullifierKey(ledger, secret, hmac)
    );
    expect(await deriveActionKey(action, secret, hmac)).toBe(
      await deriveActionKey(action, secret, hmac)
    );
    expect(await deriveActionKey(action, secret, hmac)).not.toBe(
      await deriveNullifierKey(ledger, secret, hmac)
    );
    expect(await deriveActionKey(action, secret, hmac)).not.toBe(
      await deriveActionKey(action, "x".repeat(32), hmac)
    );
    expect(
      await deriveNullifierKey({ ...ledger, rawNullifier: "b".repeat(64) }, secret, hmac)
    ).not.toBe(await deriveNullifierKey(ledger, secret, hmac));
    expect(await deriveActionKey({ ...action, useId: context.challengeId }, secret, hmac)).not.toBe(
      await deriveActionKey(action, secret, hmac)
    );
    await expect(
      computePolicyDigest(policy, async () => "not-a-digest-private-data")
    ).rejects.toThrow("INVALID_HASH_OUTPUT");
    await expect(deriveActionKey(action, "short", hmac)).rejects.toThrow("INVALID_INTENT");
  });
});
