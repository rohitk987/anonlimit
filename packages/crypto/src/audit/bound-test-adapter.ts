import { z } from "zod";
import {
  actionSchema,
  challengeResponseSchema,
  policySchema,
  presentationSchema,
  uuidSchema,
  type Action,
  type ChallengeResponse,
  type Policy,
  type Presentation,
} from "@anonlimit/contracts";
import { canonicalJson, canonicalQuotaScope, computePolicyDigest } from "@anonlimit/domain";
import { presentationBinding, PROTOCOL_VERSION } from "../holder/context.js";
import {
  encodeOpaque,
  hex,
  hmacSha256Hex,
  secureRandomBytes,
  sha256Hex,
} from "../holder/primitives.js";
import { serverCipher, type SimulatorOptions } from "../simulated-provider/server.js";

export interface BoundTestPresentationRequest {
  policy: Policy;
  demoRunId: string;
  operationId: string;
  action: Action;
  challenge: ChallengeResponse;
}

export interface BoundTestAdapter {
  /** Builds the provider-authenticated boundary slot L for an explicit simulator probe. */
  createOutOfRangePresentation(request: BoundTestPresentationRequest): Promise<Presentation>;
}

export interface BoundTestOptions extends SimulatorOptions {
  randomBytes?: (length: number) => Uint8Array;
}

export interface BoundaryProbeOptions extends BoundTestOptions {
  readonly demoMode: boolean;
}

const requestSchema = z.strictObject({
  policy: policySchema,
  demoRunId: uuidSchema,
  operationId: uuidSchema,
  action: actionSchema,
  challenge: challengeResponseSchema,
});

/**
 * Private oracle for the simulated provider, enabled only for tests and explicit demo probes.
 * It never creates a legitimate credential or adds a slot to the holder wallet.
 * The returned presentation has the ordinary public shape; the boundary slot exists only inside
 * an issuer-authenticated encrypted ticket.
 */
export function createSimulatedBoundaryProbeAdapter(
  options: BoundaryProbeOptions
): BoundTestAdapter {
  if (options.demoMode !== true) throw new Error("DEMO_DISABLED");
  const cipher = serverCipher(options);
  const randomBytes = options.randomBytes ?? secureRandomBytes;
  const now = options.now ?? Date.now;

  function random(length: number): Uint8Array<ArrayBuffer> {
    const result = randomBytes(length);
    if (!(result instanceof Uint8Array) || result.length !== length)
      throw new Error("PRESENTATION_REJECTED");
    return new Uint8Array(result);
  }

  return {
    async createOutOfRangePresentation(request) {
      const seed = random(32);
      try {
        const { policy, demoRunId, operationId, action, challenge } = requestSchema.parse(request);
        const time = now();
        if (
          policy.issuerKeyId !== options.issuerKeyId ||
          policy.status !== "ACTIVE" ||
          !Number.isFinite(time) ||
          time < Date.parse(policy.validFrom) ||
          time >= Date.parse(policy.validUntil)
        )
          throw new Error("PRESENTATION_REJECTED");

        const slotIndex = policy.maxUses;
        const scope = canonicalQuotaScope(policy);
        const policyDigest = await computePolicyDigest(policy, sha256Hex);
        const nullifier = await hmacSha256Hex(
          hex(seed),
          canonicalJson({ domain: "AnonLimit/v1", scope, slot: slotIndex })
        );
        const authenticationKey = await hmacSha256Hex(
          hex(seed),
          canonicalJson({
            domain: "AnonLimit/simulated-slot-auth/v1",
            scope,
            slot: slotIndex,
          })
        );
        const ticket = await cipher.seal(
          {
            version: "simulated-capabilities/v1",
            issuerKeyId: options.issuerKeyId,
            scope,
            policyDigest,
            demoRunId,
            slotIndex,
            nullifier,
            authenticationKey,
          },
          random(12)
        );
        const binding = await presentationBinding({
          policy,
          demoRunId,
          operationId,
          action,
          challenge,
        });
        if (challenge.policyDigest !== binding.policyDigest)
          throw new Error("PRESENTATION_REJECTED");
        const authenticator = await hmacSha256Hex(
          authenticationKey,
          canonicalJson({
            domain: "AnonLimit/simulated-proof/v1",
            nullifier,
            proofContext: binding.proofContext,
          })
        );
        return presentationSchema.parse({
          protocolVersion: PROTOCOL_VERSION,
          policyId: policy.id,
          policyVersion: policy.version,
          audience: policy.audience,
          operationId,
          challengeId: challenge.challengeId,
          nonce: challenge.nonce,
          action,
          nullifier,
          opaqueProof: encodeOpaque({
            version: "simulated-capabilities/v1",
            ticket,
            authenticator,
          }),
        });
      } catch {
        throw new Error("PRESENTATION_REJECTED");
      } finally {
        seed.fill(0);
      }
    },
  };
}

/** Test-only convenience wrapper. Runtime code must use the demo-gated factory above. */
export function createSimulatedBoundTestAdapter(options: BoundTestOptions): BoundTestAdapter {
  return createSimulatedBoundaryProbeAdapter({ ...options, demoMode: true });
}
