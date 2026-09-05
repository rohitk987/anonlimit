import { z } from "zod";
import {
  blindedHolderRequestSchema,
  opaqueCredentialSchema,
  policyReferenceSchema,
  protocolVersionSchema,
  uuidSchema,
} from "./primitives.js";
import { policySchema } from "./policy.contract.js";

export const issuanceRequestSchema = policyReferenceSchema.extend({
  protocolVersion: protocolVersionSchema,
  blindedHolderRequest: blindedHolderRequestSchema.optional(),
});
export const issuanceResponseSchema = z.strictObject({
  protocolVersion: protocolVersionSchema,
  demoRunId: uuidSchema,
  credential: opaqueCredentialSchema,
  policy: policySchema,
});
export type IssuanceRequest = z.infer<typeof issuanceRequestSchema>;
export type IssuanceResponse = z.infer<typeof issuanceResponseSchema>;
