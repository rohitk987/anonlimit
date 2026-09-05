import type { Action, ChallengeResponse, Policy, Presentation } from "@anonlimit/contracts";
import { createSimulatedHolder } from "@anonlimit/crypto/holder";

export const PHASE3_NOW = Date.parse("2026-09-05T18:00:00.000Z");
export const PHASE3_ISSUER_SECRET = "11".repeat(32);
export const PHASE3_LEDGER_KEY = "22".repeat(32);
export const PHASE3_ACTION_KEY = "33".repeat(32);

export const PHASE3_POLICY: Policy = Object.freeze({
  id: "anon-demo",
  version: 1,
  issuerKeyId: "demo-issuer-v1",
  audience: "demo-service",
  maxUses: 3,
  quotaWindowId: "hackathon-demo",
  status: "ACTIVE",
  validFrom: "2026-01-01T00:00:00.000Z",
  validUntil: "2036-01-01T00:00:00.000Z",
});

export const PHASE3_ACTION: Action = Object.freeze({
  type: "REDEEM_DEMO_BENEFIT",
  payload: Object.freeze({ benefitCode: "HACKATHON" }),
});

const holder = createSimulatedHolder();

export function createPhase3Presentation(input: {
  readonly credential: string;
  readonly challenge: ChallengeResponse;
  readonly operationId: string;
  readonly hiddenSlot?: number;
  readonly action?: Action;
}): Promise<Presentation> {
  return holder.createPresentation({
    credential: input.credential,
    challenge: input.challenge,
    operationId: input.operationId,
    hiddenSlot: input.hiddenSlot ?? 0,
    action: input.action ?? PHASE3_ACTION,
  });
}

export function tamperOpaqueProof(presentation: Presentation): Presentation {
  const decoded: unknown = JSON.parse(
    Buffer.from(presentation.opaqueProof, "base64url").toString("utf8")
  );
  if (
    !decoded ||
    typeof decoded !== "object" ||
    !("authenticator" in decoded) ||
    typeof decoded.authenticator !== "string" ||
    !/^[a-f0-9]{64}$/.test(decoded.authenticator)
  )
    throw new Error("TEST_PROOF_ENVELOPE_INVALID");
  const authenticator = decoded.authenticator;
  const replacement = authenticator.endsWith("0") ? "1" : "0";
  const opaqueProof = Buffer.from(
    JSON.stringify({
      ...decoded,
      authenticator: authenticator.slice(0, -1) + replacement,
    })
  ).toString("base64url");
  return { ...presentation, opaqueProof };
}
