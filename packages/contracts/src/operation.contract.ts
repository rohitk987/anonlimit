import { z } from "zod";
import { actionKeySchema, timestampSchema, uuidSchema } from "./primitives.js";

export const benefitCodeSchema = z.enum(["HACKATHON", "WORKSHOP"]);
export const actionSchema = z.strictObject({
  type: z.literal("REDEEM_DEMO_BENEFIT"),
  payload: z.strictObject({ benefitCode: benefitCodeSchema }),
});
export const operationPathSchema = z.strictObject({ useId: uuidSchema });
export const idempotencyHeaderSchema = uuidSchema;
export const receiptSchema = z.strictObject({
  receiptId: uuidSchema,
  useId: uuidSchema,
  actionKey: actionKeySchema,
  status: z.literal("COMMITTED"),
  committedAt: timestampSchema,
});
export type Action = z.infer<typeof actionSchema>;
export type Receipt = z.infer<typeof receiptSchema>;
export type OperationPath = z.infer<typeof operationPathSchema>;
