import { type Action, type ChallengeResponse, type Policy } from "@anonlimit/contracts";
import {
  canonicalQuotaScope,
  computeIntentDigest,
  computePolicyDigest,
  computeProofContext,
} from "@anonlimit/domain";
import { sha256Hex } from "./primitives.js";

export const PROTOCOL_VERSION = "AnonLimit/v1";
export const PRESENTATION_RESOURCE = "/v1/verifier/presentations";

export async function presentationBinding(input: {
  policy: Policy;
  demoRunId: string;
  operationId: string;
  action: Action;
  challenge: ChallengeResponse;
}): Promise<{ scope: string; policyDigest: string; intentDigest: string; proofContext: string }> {
  const scope = canonicalQuotaScope(input.policy);
  const policyDigest = await computePolicyDigest(input.policy, sha256Hex);
  const intentDigest = await computeIntentDigest(
    {
      protocolVersion: PROTOCOL_VERSION,
      operationId: input.operationId,
      method: "POST",
      resource: PRESENTATION_RESOURCE,
      action: input.action,
    },
    sha256Hex
  );
  const proofContext = await computeProofContext(
    {
      protocolVersion: PROTOCOL_VERSION,
      scope,
      policyDigest,
      intentDigest,
      demoRunId: input.demoRunId,
      challengeId: input.challenge.challengeId,
      nonce: input.challenge.nonce,
      expiresAt: input.challenge.expiresAt,
    },
    sha256Hex
  );
  return { scope, policyDigest, intentDigest, proofContext };
}
