import { z } from "zod";
import { actionSchema, receiptSchema } from "./operation.contract.js";
import { actionKeySchema, digestSchema, uuidSchema } from "./primitives.js";

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
export type InternalActionRequest = z.infer<typeof internalActionRequestSchema>;
export type InternalActionResponse = z.infer<typeof internalActionResponseSchema>;
