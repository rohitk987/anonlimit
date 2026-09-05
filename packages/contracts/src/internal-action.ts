import { z } from "zod";
import { actionSchema, receiptSchema } from "./operation.contract.js";
import { actionKeySchema, digestSchema, timestampSchema, uuidSchema } from "./primitives.js";

// These fields are assembled by the trusted worker, never copied from a public envelope.
export const internalActionRequestSchema = z.strictObject({
  demoRunId: uuidSchema,
  actionKey: actionKeySchema,
  useId: uuidSchema,
  intentDigest: digestSchema,
  payloadDigest: digestSchema,
  action: actionSchema,
});
export const internalActionResponseSchema = z.union([
  z.strictObject({ receipt: receiptSchema, replayed: z.literal(false), actionDelta: z.literal(1) }),
  z.strictObject({ receipt: receiptSchema, replayed: z.literal(true), actionDelta: z.literal(0) }),
]);
export const internalDemoResetRequestSchema = z.strictObject({
  demoRunId: uuidSchema,
});
export const internalDemoResetResponseSchema = z.strictObject({
  demoRunId: uuidSchema,
  resetAt: timestampSchema,
});
export const internalActionEvidenceResponseSchema = z.strictObject({
  externalActions: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  receipts: z.array(receiptSchema).max(100_000),
});
export const internalActionEvidenceQuerySchema = z.strictObject({
  demoRunId: uuidSchema.optional(),
});
export type InternalActionRequest = z.infer<typeof internalActionRequestSchema>;
export type InternalActionResponse = z.infer<typeof internalActionResponseSchema>;
export type InternalDemoResetRequest = z.infer<typeof internalDemoResetRequestSchema>;
export type InternalDemoResetResponse = z.infer<typeof internalDemoResetResponseSchema>;
export type InternalActionEvidenceResponse = z.infer<typeof internalActionEvidenceResponseSchema>;
