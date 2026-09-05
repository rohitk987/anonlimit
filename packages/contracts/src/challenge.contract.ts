import { z } from "zod";
import { actionSchema } from "./operation.contract.js";
import {
  digestSchema,
  hex64Schema,
  identifierSchema,
  policyReferenceSchema,
  protocolVersionSchema,
  timestampSchema,
  uuidSchema,
} from "./primitives.js";

export const challengeRequestSchema = policyReferenceSchema.extend({
  protocolVersion: protocolVersionSchema,
  audience: identifierSchema,
  operationId: uuidSchema,
  action: actionSchema,
});
export const challengeResponseSchema = z.strictObject({
  challengeId: uuidSchema,
  nonce: hex64Schema,
  policyDigest: digestSchema,
  expiresAt: timestampSchema,
});
export type ChallengeRequest = z.infer<typeof challengeRequestSchema>;
export type ChallengeResponse = z.infer<typeof challengeResponseSchema>;
