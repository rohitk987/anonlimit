import {
  actionSchema,
  challengeResponseSchema,
  presentationSchema,
  uuidSchema,
  type Action,
  type ChallengeResponse,
  type Presentation,
} from "@anonlimit/contracts";
import { canonicalJson } from "@anonlimit/domain";
import { presentationBinding, PROTOCOL_VERSION } from "./context.js";
import { decodeOpaque, encodeOpaque, hmacSha256Hex } from "./primitives.js";
import { walletCredentialSchema } from "./envelopes.js";

export interface PresentationRequest {
  credential: string;
  hiddenSlot: number;
  operationId: string;
  action: Action;
  challenge: ChallengeResponse;
}

export interface HolderAdapter {
  createPresentation(request: PresentationRequest): Promise<Presentation>;
}

export function createSimulatedHolder(): HolderAdapter {
  return {
    async createPresentation(request) {
      try {
        const credential = walletCredentialSchema.parse(decodeOpaque(request.credential, 262144));
        if (
          !Number.isInteger(request.hiddenSlot) ||
          request.hiddenSlot < 0 ||
          request.hiddenSlot >= credential.policy.maxUses
        )
          throw new Error("PRESENTATION_REJECTED");
        const slot = credential.slots[request.hiddenSlot];
        if (!slot) throw new Error("PRESENTATION_REJECTED");
        const action = actionSchema.parse(request.action);
        const challenge = challengeResponseSchema.parse(request.challenge);
        const operationId = uuidSchema.parse(request.operationId);
        const binding = await presentationBinding({
          ...credential,
          operationId,
          action,
          challenge,
        });
        if (challenge.policyDigest !== binding.policyDigest)
          throw new Error("PRESENTATION_REJECTED");
        const authenticator = await hmacSha256Hex(
          slot.authenticationKey,
          canonicalJson({
            domain: "AnonLimit/simulated-proof/v1",
            nullifier: slot.nullifier,
            proofContext: binding.proofContext,
          })
        );
        return presentationSchema.parse({
          protocolVersion: PROTOCOL_VERSION,
          policyId: credential.policy.id,
          policyVersion: credential.policy.version,
          audience: credential.policy.audience,
          operationId,
          challengeId: challenge.challengeId,
          nonce: challenge.nonce,
          action,
          nullifier: slot.nullifier,
          opaqueProof: encodeOpaque({
            version: credential.version,
            ticket: slot.ticket,
            authenticator,
          }),
        });
      } catch {
        throw new Error("PRESENTATION_REJECTED");
      }
    },
  };
}

export { sha256Hex } from "./primitives.js";
