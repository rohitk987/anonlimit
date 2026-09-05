import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  challengeResponseSchema,
  type Action,
  type ChallengeResponse,
  type Policy,
  type Presentation,
} from "@anonlimit/contracts";
import {
  canonicalJson,
  computeIntentDigest,
  computePolicyDigest,
  computeScopeHash,
} from "@anonlimit/domain";
import { createSimulatedHolder, sha256Hex } from "@anonlimit/crypto/holder";
import { createSimulatedIssuer } from "@anonlimit/crypto/issuer";
import {
  createLookupProtection,
  createSimulatedVerifier,
  type VerificationInput,
} from "@anonlimit/crypto/verifier";
import { createSimulatedAuditor } from "@anonlimit/crypto/audit";

const now = Date.parse("2026-09-05T12:00:00.000Z");
const runId = "00000000-0000-4000-8000-000000000001";
const operationIds = [
  "00000000-0000-4000-8000-000000000010",
  "00000000-0000-4000-8000-000000000011",
  "00000000-0000-4000-8000-000000000012",
  "00000000-0000-4000-8000-000000000013",
] as const;
const challengeIds = [
  "00000000-0000-4000-8000-000000000020",
  "00000000-0000-4000-8000-000000000021",
  "00000000-0000-4000-8000-000000000022",
  "00000000-0000-4000-8000-000000000023",
] as const;
const action: Action = {
  type: "REDEEM_DEMO_BENEFIT",
  payload: { benefitCode: "HACKATHON" },
};
const policy: Policy = {
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

function randomHex(bytes = 32): string {
  return Buffer.from(webcrypto.getRandomValues(new Uint8Array(bytes))).toString("hex");
}
function deterministicIssuanceRandom() {
  let iv = 0;
  const seed = webcrypto.getRandomValues(new Uint8Array(32));
  return (length: number): Uint8Array => {
    if (length === 32) return new Uint8Array(seed);
    if (length !== 12) throw new Error("Unexpected test random request");
    const value = new Uint8Array(length);
    new DataView(value.buffer).setUint32(8, ++iv);
    return value;
  };
}
async function intentDigest(operationId: string, selectedAction: Action): Promise<string> {
  return computeIntentDigest(
    {
      protocolVersion: "AnonLimit/v1",
      operationId,
      method: "POST",
      resource: "/v1/verifier/presentations",
      action: selectedAction,
    },
    sha256Hex
  );
}
async function challenge(
  selectedPolicy: Policy,
  index: number,
  overrides: Partial<ChallengeResponse> = {}
): Promise<ChallengeResponse> {
  return challengeResponseSchema.parse({
    challengeId: challengeIds[index],
    nonce: (index + 1).toString(16).repeat(64),
    policyDigest: await computePolicyDigest(selectedPolicy, sha256Hex),
    expiresAt: "2026-09-05T12:05:00.000Z",
    ...overrides,
  });
}
async function verificationInput(input: {
  selectedPolicy: Policy;
  selectedRunId?: string;
  selectedAction?: Action;
  operationId: string;
  challenge: ChallengeResponse;
  presentation: Presentation;
  publicParameters: {
    provider: "SIMULATED_CAPABILITIES_V1";
    issuerKeyId: string;
  };
}): Promise<VerificationInput> {
  const selectedAction = input.selectedAction ?? action;
  return {
    policy: input.selectedPolicy,
    demoRunId: input.selectedRunId ?? runId,
    issuerPublicParameters: input.publicParameters,
    challenge: input.challenge,
    expectedOperationId: input.operationId,
    expectedIntentDigest: await intentDigest(input.operationId, selectedAction),
    presentation: input.presentation,
  };
}
function decodeCredential(value: string): {
  version: string;
  policy: Policy;
  demoRunId: string;
  slots: { nullifier: string; authenticationKey: string; ticket: string }[];
} {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
    version: string;
    policy: Policy;
    demoRunId: string;
    slots: { nullifier: string; authenticationKey: string; ticket: string }[];
  };
}
function encodeCredential(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
function flip(value: string): string {
  const replacement = value.at(-1) === "A" ? "B" : "A";
  return value.slice(0, -1) + replacement;
}
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing test fixture value");
  return value;
}

async function fixture() {
  const issuerSecret = randomHex();
  const providerOptions = { issuerKeyId: policy.issuerKeyId, issuerSecret, now: () => now };
  const issuer = createSimulatedIssuer({
    ...providerOptions,
    randomBytes: deterministicIssuanceRandom(),
  });
  const issued = await issuer.issueAnonymousCredential({ policy, demoRunId: runId });
  const holder = createSimulatedHolder();
  const verifier = createSimulatedVerifier(providerOptions);
  return { providerOptions, issuer, issued, holder, verifier };
}

describe("opaque simulated provider contract", () => {
  it("verifies exactly slots zero through L minus one with stable, distinct nullifiers", async () => {
    const { issuer, issued, holder, verifier } = await fixture();
    const presentations: Presentation[] = [];
    for (let slot = 0; slot < policy.maxUses; slot++) {
      const currentChallenge = await challenge(policy, slot);
      const presentation = await holder.createPresentation({
        credential: issued.credential,
        hiddenSlot: slot,
        operationId: operationIds[slot] ?? operationIds[0],
        action,
        challenge: currentChallenge,
      });
      const result = await verifier.verifyPresentation(
        await verificationInput({
          selectedPolicy: policy,
          operationId: presentation.operationId,
          challenge: currentChallenge,
          presentation,
          publicParameters: issuer.publicParameters,
        })
      );
      expect(result).toEqual({ valid: true, diagnosticCode: "VERIFIED" });
      presentations.push(presentation);
    }
    expect(new Set(presentations.map((entry) => entry.nullifier)).size).toBe(policy.maxUses);

    const retryChallenge = await challenge(policy, 3);
    const retry = await holder.createPresentation({
      credential: issued.credential,
      hiddenSlot: 1,
      operationId: operationIds[3],
      action,
      challenge: retryChallenge,
    });
    expect(retry.nullifier).toBe(presentations[1]?.nullifier);
    for (const hiddenSlot of [-1, policy.maxUses, 1.5, Number.NaN, Infinity])
      await expect(
        holder.createPresentation({
          credential: issued.credential,
          hiddenSlot,
          operationId: operationIds[3],
          action,
          challenge: retryChallenge,
        })
      ).rejects.toThrow("PRESENTATION_REJECTED");
  });

  it("binds proofs to policy, audience, run, operation, action, and challenge", async () => {
    const { issuer, issued, holder, verifier } = await fixture();
    const originalChallenge = await challenge(policy, 0);
    const presentation = await holder.createPresentation({
      credential: issued.credential,
      hiddenSlot: 0,
      operationId: operationIds[0],
      action,
      challenge: originalChallenge,
    });
    const original = await verificationInput({
      selectedPolicy: policy,
      operationId: operationIds[0],
      challenge: originalChallenge,
      presentation,
      publicParameters: issuer.publicParameters,
    });
    expect(await verifier.verifyPresentation(original)).toMatchObject({ valid: true });

    const alteredAction: Action = {
      type: "REDEEM_DEMO_BENEFIT",
      payload: { benefitCode: "WORKSHOP" },
    };
    const variants: VerificationInput[] = [
      { ...original, expectedOperationId: operationIds[1] },
      { ...original, expectedIntentDigest: await intentDigest(operationIds[0], alteredAction) },
      { ...original, demoRunId: "00000000-0000-4000-8000-000000000099" },
      { ...original, policy: { ...policy, audience: "other-service" } },
      { ...original, policy: { ...policy, version: 2 } },
      { ...original, policy: { ...policy, quotaWindowId: "next-window" } },
      { ...original, policy: { ...policy, status: "DISABLED" } },
      {
        ...original,
        issuerPublicParameters: {
          ...original.issuerPublicParameters,
          issuerKeyId: "another-issuer",
        },
      },
      {
        ...original,
        challenge: {
          ...originalChallenge,
          challengeId: challengeIds[1],
        },
      },
      {
        ...original,
        challenge: {
          ...originalChallenge,
          nonce: "f".repeat(64),
        },
      },
      {
        ...original,
        presentation: {
          ...presentation,
          action: alteredAction,
        },
      },
    ];
    for (const variant of variants)
      expect(await verifier.verifyPresentation(variant)).toEqual({
        valid: false,
        diagnosticCode: "PRESENTATION_REJECTED",
      });
  });

  it("rejects expired inputs and every tested ticket, proof, or marker alteration", async () => {
    const { providerOptions, issuer, issued, holder, verifier } = await fixture();
    const originalChallenge = await challenge(policy, 0);
    const presentation = await holder.createPresentation({
      credential: issued.credential,
      hiddenSlot: 0,
      operationId: operationIds[0],
      action,
      challenge: originalChallenge,
    });
    const original = await verificationInput({
      selectedPolicy: policy,
      operationId: operationIds[0],
      challenge: originalChallenge,
      presentation,
      publicParameters: issuer.publicParameters,
    });
    const proof = JSON.parse(
      Buffer.from(presentation.opaqueProof, "base64url").toString("utf8")
    ) as {
      version: string;
      ticket: string;
      authenticator: string;
    };
    const alteredProofs = [
      { ...proof, authenticator: "0".repeat(64) },
      { ...proof, ticket: flip(proof.ticket) },
      { ...proof, unexpected: "private" },
    ];
    for (const alteredProof of alteredProofs) {
      const alteredPresentation = {
        ...presentation,
        opaqueProof: Buffer.from(JSON.stringify(alteredProof)).toString("base64url"),
      };
      expect(
        await verifier.verifyPresentation({ ...original, presentation: alteredPresentation })
      ).toEqual({ valid: false, diagnosticCode: "PRESENTATION_REJECTED" });
    }
    expect(
      await verifier.verifyPresentation({
        ...original,
        presentation: { ...presentation, nullifier: "e".repeat(64) },
      })
    ).toEqual({ valid: false, diagnosticCode: "PRESENTATION_REJECTED" });
    const wrongKeyVerifier = createSimulatedVerifier({
      issuerKeyId: policy.issuerKeyId,
      issuerSecret: randomHex(),
      now: () => now,
    });
    expect(await wrongKeyVerifier.verifyPresentation(original)).toEqual({
      valid: false,
      diagnosticCode: "PRESENTATION_REJECTED",
    });
    const expiredVerifier = createSimulatedVerifier({
      ...providerOptions,
      now: () => Date.parse(originalChallenge.expiresAt),
    });
    expect(await expiredVerifier.verifyPresentation(original)).toEqual({
      valid: false,
      diagnosticCode: "PRESENTATION_REJECTED",
    });
  });

  it("copies and slot reordering cannot increase the credential's nullifier set", async () => {
    const { issuer, issued, holder, verifier } = await fixture();
    async function nullifierSet(credential: string): Promise<Set<string>> {
      const values = new Set<string>();
      for (let slot = 0; slot < policy.maxUses; slot++) {
        const currentChallenge = await challenge(policy, slot);
        const presentation = await holder.createPresentation({
          credential,
          hiddenSlot: slot,
          operationId: operationIds[slot] ?? operationIds[0],
          action,
          challenge: currentChallenge,
        });
        const verified = await verifier.verifyPresentation(
          await verificationInput({
            selectedPolicy: policy,
            operationId: presentation.operationId,
            challenge: currentChallenge,
            presentation,
            publicParameters: issuer.publicParameters,
          })
        );
        expect(verified.valid).toBe(true);
        values.add(presentation.nullifier);
      }
      return values;
    }
    const original = await nullifierSet(issued.credential);
    const copied = await nullifierSet(String(issued.credential));
    const decoded = decodeCredential(issued.credential);
    decoded.slots.reverse();
    const reordered = await nullifierSet(encodeCredential(decoded));
    expect([...copied].sort()).toEqual([...original].sort());
    expect([...reordered].sort()).toEqual([...original].sort());

    const expanded = decodeCredential(issued.credential);
    expanded.policy = { ...expanded.policy, maxUses: 4 };
    expanded.slots.push(structuredClone(required(expanded.slots[0])));
    const expandedChallenge = await challenge(expanded.policy, 3);
    const extraPresentation = await holder.createPresentation({
      credential: encodeCredential(expanded),
      hiddenSlot: 3,
      operationId: operationIds[3],
      action,
      challenge: expandedChallenge,
    });
    expect(
      await verifier.verifyPresentation(
        await verificationInput({
          selectedPolicy: expanded.policy,
          operationId: operationIds[3],
          challenge: expandedChallenge,
          presentation: extraPresentation,
          publicParameters: issuer.publicParameters,
        })
      )
    ).toMatchObject({ valid: false });
  });

  it("separates nullifier domains while using the same injected credential seed", async () => {
    const issuerSecret = randomHex();
    const issuer = createSimulatedIssuer({
      issuerKeyId: policy.issuerKeyId,
      issuerSecret,
      now: () => now,
      randomBytes: deterministicIssuanceRandom(),
    });
    const changedPolicy = { ...policy, audience: "second-service" };
    const [first, second] = await Promise.all([
      issuer.issueAnonymousCredential({ policy, demoRunId: runId }),
      issuer.issueAnonymousCredential({ policy: changedPolicy, demoRunId: runId }),
    ]);
    const holder = createSimulatedHolder();
    const [firstPresentation, secondPresentation] = await Promise.all([
      holder.createPresentation({
        credential: first.credential,
        hiddenSlot: 0,
        operationId: operationIds[0],
        action,
        challenge: await challenge(policy, 0),
      }),
      holder.createPresentation({
        credential: second.credential,
        hiddenSlot: 0,
        operationId: operationIds[1],
        action,
        challenge: await challenge(changedPolicy, 1),
      }),
    ]);
    expect(firstPresentation.nullifier).not.toBe(secondPresentation.nullifier);
  });

  it("recognizes the same use and treats distinct valid uses as unlinkable under its stated assumption", async () => {
    const { providerOptions, issuer, issued, holder } = await fixture();
    const inputs: VerificationInput[] = [];
    for (let slot = 0; slot < 2; slot++) {
      const currentChallenge = await challenge(policy, slot);
      const presentation = await holder.createPresentation({
        credential: issued.credential,
        hiddenSlot: slot,
        operationId: operationIds[slot] ?? operationIds[0],
        action,
        challenge: currentChallenge,
      });
      inputs.push(
        await verificationInput({
          selectedPolicy: policy,
          operationId: presentation.operationId,
          challenge: currentChallenge,
          presentation,
          publicParameters: issuer.publicParameters,
        })
      );
    }
    const auditor = createSimulatedAuditor({
      ...providerOptions,
      now: () => Date.parse(policy.validUntil),
    });
    expect(
      await auditor.testLinkability(required(inputs[0]), structuredClone(required(inputs[0])))
    ).toEqual({
      ok: true,
      result: "SAME_USE",
      basis: "SIMULATED_PROVIDER_ASSUMPTION",
    });
    expect(await auditor.testLinkability(required(inputs[0]), required(inputs[1]))).toEqual({
      ok: true,
      result: "UNLINKABLE",
      basis: "SIMULATED_PROVIDER_ASSUMPTION",
    });
    const invalid = structuredClone(required(inputs[1]));
    invalid.presentation.opaqueProof = flip(invalid.presentation.opaqueProof);
    expect(await auditor.testLinkability(required(inputs[0]), invalid)).toEqual({
      ok: false,
      code: "PRESENTATION_REJECTED",
    });
  });

  it("derives stable protected lookup/action keys without exposing raw inputs", async () => {
    const protection = createLookupProtection({ ledgerKey: randomHex(), actionKey: randomHex() });
    const scopeHash = await computeScopeHash(policy, sha256Hex);
    const rawNullifier = randomHex();
    const first = await protection.protectNullifier({ scopeHash, rawNullifier });
    const again = await protection.protectNullifier({ scopeHash, rawNullifier });
    expect(first).toBe(again);
    expect(first).toMatch(/^hmac-sha256:[a-f0-9]{64}$/);
    expect(first).not.toContain(rawNullifier);
    const actionKey = await protection.deriveActionKey({
      useId: operationIds[0],
      intentDigest: await intentDigest(operationIds[0], action),
    });
    expect(actionKey).toMatch(/^hmac-sha256:[a-f0-9]{64}$/);
    expect(actionKey).not.toContain(operationIds[0]);
  });

  it("exposes no hidden slot, per-slot secret, or credential identifier in public outputs", async () => {
    const { issuer, issued, holder, verifier } = await fixture();
    const currentChallenge = await challenge(policy, 0);
    const presentation = await holder.createPresentation({
      credential: issued.credential,
      hiddenSlot: 0,
      operationId: operationIds[0],
      action,
      challenge: currentChallenge,
    });
    expect(Object.keys(presentation).sort()).toEqual(
      [
        "action",
        "audience",
        "challengeId",
        "nonce",
        "opaqueProof",
        "operationId",
        "policyId",
        "policyVersion",
        "protocolVersion",
        "nullifier",
      ].sort()
    );
    const proof = JSON.parse(
      Buffer.from(presentation.opaqueProof, "base64url").toString("utf8")
    ) as object;
    expect(Object.keys(proof).sort()).toEqual(["authenticator", "ticket", "version"]);
    const verified = await verifier.verifyPresentation(
      await verificationInput({
        selectedPolicy: policy,
        operationId: operationIds[0],
        challenge: currentChallenge,
        presentation,
        publicParameters: issuer.publicParameters,
      })
    );
    expect(verified).toEqual({ valid: true, diagnosticCode: "VERIFIED" });
    const serialized = canonicalJson({ presentation, verified });
    for (const marker of ["hiddenSlot", "authenticationKey", "credentialId", "holderId"])
      expect(serialized).not.toContain(marker);
  });
});
