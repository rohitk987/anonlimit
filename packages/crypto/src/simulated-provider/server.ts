import { z } from "zod";
import {
  challengeResponseSchema,
  digestSchema,
  hex64Schema,
  identifierSchema,
  policySchema,
  presentationSchema,
  uuidSchema,
  type Policy,
  type Presentation,
  type ChallengeResponse,
} from "@anonlimit/contracts";
import { canonicalJson } from "@anonlimit/domain";
import { presentationBinding } from "../holder/context.js";
import { proofEnvelopeSchema, ticketSchema } from "../holder/envelopes.js";
import {
  decodeBytes,
  decodeOpaque,
  encodeBytes,
  fromHex,
  verifyMac,
} from "../holder/primitives.js";

export interface SimulatorOptions {
  issuerKeyId: string;
  /** A separately generated, injected 32-byte simulator key, encoded as lowercase hex. */
  issuerSecret: string;
  now?: () => number;
}

export interface IssuerPublicParameters {
  provider: "SIMULATED_CAPABILITIES_V1";
  issuerKeyId: string;
}

export interface VerificationInput {
  policy: Policy;
  demoRunId: string;
  issuerPublicParameters: IssuerPublicParameters;
  challenge: ChallengeResponse;
  /** Loaded from the server's challenge record, never copied from an untrusted envelope. */
  expectedOperationId: string;
  expectedIntentDigest: string;
  presentation: Presentation;
}

export type VerificationResult =
  | { valid: true; diagnosticCode: "VERIFIED" }
  | { valid: false; diagnosticCode: "PRESENTATION_REJECTED" };

export const publicParametersSchema = z.strictObject({
  provider: z.literal("SIMULATED_CAPABILITIES_V1"),
  issuerKeyId: identifierSchema,
});
export const capabilitySchema = z.strictObject({
  version: z.literal("simulated-capabilities/v1"),
  issuerKeyId: identifierSchema,
  scope: z.string().min(1).max(4096),
  policyDigest: digestSchema,
  demoRunId: uuidSchema,
  nullifier: hex64Schema,
  authenticationKey: hex64Schema,
});

export function serverCipher(options: SimulatorOptions) {
  if (
    !hex64Schema.safeParse(options.issuerSecret).success ||
    !identifierSchema.safeParse(options.issuerKeyId).success
  )
    throw new Error("CONFIGURATION_INVALID");
  const key = globalThis.crypto.subtle.importKey(
    "raw",
    fromHex(options.issuerSecret),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"]
  );
  const aad = new TextEncoder().encode("AnonLimit/simulated-capability/v1");
  return {
    async seal(
      claims: z.infer<typeof capabilitySchema>,
      iv: Uint8Array<ArrayBuffer>
    ): Promise<string> {
      if (iv.length !== 12) throw new Error("ISSUANCE_FAILED");
      const ciphertext = await globalThis.crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: aad },
        await key,
        new TextEncoder().encode(canonicalJson(capabilitySchema.parse(claims)))
      );
      return ticketSchema.parse(
        "simcap1." + encodeBytes(iv) + "." + encodeBytes(new Uint8Array(ciphertext))
      );
    },
    async open(ticket: string): Promise<z.infer<typeof capabilitySchema>> {
      const parts = ticketSchema.parse(ticket).split(".");
      const iv = decodeBytes(parts[1] ?? "");
      if (iv.length !== 12) throw new Error("PRESENTATION_REJECTED");
      const plaintext = await globalThis.crypto.subtle.decrypt(
        { name: "AES-GCM", iv, additionalData: aad },
        await key,
        decodeBytes(parts[2] ?? "")
      );
      return capabilitySchema.parse(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)) as unknown
      );
    },
  };
}

/** Private provider helper. Only the audit adapter may omit live time checks. */
export function createBindingVerifier(options: SimulatorOptions, checkFreshness: boolean) {
  const cipher = serverCipher(options);
  const keyId = options.issuerKeyId;
  const now = options.now ?? Date.now;
  return async (input: VerificationInput): Promise<VerificationResult> => {
    try {
      const policy = policySchema.parse(input.policy);
      const demoRunId = uuidSchema.parse(input.demoRunId);
      const parameters = publicParametersSchema.parse(input.issuerPublicParameters);
      const challenge = challengeResponseSchema.parse(input.challenge);
      const presentation = presentationSchema.parse(input.presentation);
      const expectedOperationId = uuidSchema.parse(input.expectedOperationId);
      const expectedIntentDigest = digestSchema.parse(input.expectedIntentDigest);
      if (
        parameters.issuerKeyId !== keyId ||
        policy.issuerKeyId !== keyId ||
        presentation.policyId !== policy.id ||
        presentation.policyVersion !== policy.version ||
        presentation.audience !== policy.audience ||
        presentation.challengeId !== challenge.challengeId ||
        presentation.nonce !== challenge.nonce ||
        presentation.operationId !== expectedOperationId
      )
        throw new Error("PRESENTATION_REJECTED");

      const binding = await presentationBinding({
        policy,
        demoRunId,
        operationId: presentation.operationId,
        action: presentation.action,
        challenge,
      });
      if (
        binding.policyDigest !== challenge.policyDigest ||
        binding.intentDigest !== expectedIntentDigest
      )
        throw new Error("PRESENTATION_REJECTED");
      if (checkFreshness) {
        const time = now();
        if (
          policy.status !== "ACTIVE" ||
          !Number.isFinite(time) ||
          time < Date.parse(policy.validFrom) ||
          time >= Date.parse(policy.validUntil) ||
          time >= Date.parse(challenge.expiresAt)
        )
          throw new Error("PRESENTATION_REJECTED");
      }
      const proof = proofEnvelopeSchema.parse(decodeOpaque(presentation.opaqueProof, 8192));
      const claims = await cipher.open(proof.ticket);
      if (
        claims.issuerKeyId !== keyId ||
        claims.scope !== binding.scope ||
        claims.policyDigest !== binding.policyDigest ||
        claims.demoRunId !== demoRunId ||
        claims.nullifier !== presentation.nullifier
      )
        throw new Error("PRESENTATION_REJECTED");
      const valid = await verifyMac(
        claims.authenticationKey,
        canonicalJson({
          domain: "AnonLimit/simulated-proof/v1",
          nullifier: presentation.nullifier,
          proofContext: binding.proofContext,
        }),
        proof.authenticator
      );
      return valid
        ? { valid: true, diagnosticCode: "VERIFIED" }
        : { valid: false, diagnosticCode: "PRESENTATION_REJECTED" };
    } catch {
      return { valid: false, diagnosticCode: "PRESENTATION_REJECTED" };
    }
  };
}
