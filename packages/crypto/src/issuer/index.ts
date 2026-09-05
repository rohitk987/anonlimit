import { z } from "zod";
import {
  issuanceResponseSchema,
  policySchema,
  uuidSchema,
  blindedHolderRequestSchema,
  type Policy,
  type IssuanceResponse,
} from "@anonlimit/contracts";
import { canonicalJson, canonicalQuotaScope, computePolicyDigest } from "@anonlimit/domain";
import {
  encodeOpaque,
  hex,
  hmacSha256Hex,
  secureRandomBytes,
  sha256Hex,
} from "../holder/primitives.js";
import { walletCredentialSchema } from "../holder/envelopes.js";
import {
  serverCipher,
  type IssuerPublicParameters,
  type SimulatorOptions,
} from "../simulated-provider/server.js";

export interface IssuanceInput {
  policy: Policy;
  demoRunId: string;
  /** Opaque interface placeholder; real blind issuance is not implemented by this simulator. */
  blindedHolderRequest?: string;
}
export interface IssuerAdapter {
  readonly publicParameters: IssuerPublicParameters;
  issueAnonymousCredential(input: IssuanceInput): Promise<IssuanceResponse>;
}
export interface IssuerOptions extends SimulatorOptions {
  randomBytes?: (length: number) => Uint8Array;
}
const inputSchema = z.strictObject({
  policy: policySchema,
  demoRunId: uuidSchema,
  blindedHolderRequest: blindedHolderRequestSchema.optional(),
});

export function createSimulatedIssuer(options: IssuerOptions): IssuerAdapter {
  const cipher = serverCipher(options);
  const randomBytes = options.randomBytes ?? secureRandomBytes;
  const now = options.now ?? Date.now;
  const keyId = options.issuerKeyId;
  function random(length: number): Uint8Array<ArrayBuffer> {
    const result = randomBytes(length);
    if (!(result instanceof Uint8Array) || result.length !== length)
      throw new Error("ISSUANCE_FAILED");
    return new Uint8Array(result);
  }
  return {
    publicParameters: Object.freeze({ provider: "SIMULATED_CAPABILITIES_V1", issuerKeyId: keyId }),
    async issueAnonymousCredential(input) {
      try {
        const { policy, demoRunId } = inputSchema.parse(input);
        const time = now();
        if (
          policy.issuerKeyId !== keyId ||
          policy.status !== "ACTIVE" ||
          !Number.isFinite(time) ||
          time < Date.parse(policy.validFrom) ||
          time >= Date.parse(policy.validUntil)
        )
          throw new Error("ISSUANCE_FAILED");
        // One seed determines exactly maxUses slot markers. No counter or credential registry is kept.
        const seed = random(32);
        try {
          const scope = canonicalQuotaScope(policy);
          const policyDigest = await computePolicyDigest(policy, sha256Hex);
          const slots = [];
          for (let slot = 0; slot < policy.maxUses; slot++) {
            const nullifier = await hmacSha256Hex(
              hex(seed),
              canonicalJson({ domain: "AnonLimit/v1", scope, slot })
            );
            const authenticationKey = await hmacSha256Hex(
              hex(seed),
              canonicalJson({ domain: "AnonLimit/simulated-slot-auth/v1", scope, slot })
            );
            const ticket = await cipher.seal(
              {
                version: "simulated-capabilities/v1",
                issuerKeyId: keyId,
                scope,
                policyDigest,
                demoRunId,
                slotIndex: slot,
                nullifier,
                authenticationKey,
              },
              random(12)
            );
            slots.push({ nullifier, authenticationKey, ticket });
          }
          const credential = encodeOpaque(
            walletCredentialSchema.parse({
              version: "simulated-capabilities/v1",
              policy,
              demoRunId,
              slots,
            })
          );
          return issuanceResponseSchema.parse({
            protocolVersion: "AnonLimit/v1",
            credential,
            policy,
            demoRunId,
          });
        } finally {
          seed.fill(0);
        }
      } catch {
        throw new Error("ISSUANCE_FAILED");
      }
    },
  };
}
export type { IssuerPublicParameters } from "../simulated-provider/server.js";
