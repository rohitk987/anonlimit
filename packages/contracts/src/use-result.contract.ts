import { z } from "zod";
import { receiptSchema } from "./operation.contract.js";
import { uuidSchema } from "./primitives.js";

export const useStateSchema = z.enum(["ACCEPTED_PENDING_ACTION", "SUCCEEDED", "FAILED_FINAL"]);
export const actionFailureCodeSchema = z.enum(["ACTION_FAILED_FINAL", "ACTION_INTEGRITY_CONFLICT"]);

const newPendingSchema = z.strictObject({
  useId: uuidSchema,
  status: z.literal("ACCEPTED_PENDING_ACTION"),
  code: z.literal("ACCEPTED_PENDING_ACTION"),
  replayed: z.literal(false),
  usageDelta: z.literal(1),
  actionDelta: z.literal(0),
});
const retryPendingSchema = newPendingSchema.extend({
  code: z.literal("RETRY_IN_PROGRESS"),
  replayed: z.literal(true),
  usageDelta: z.literal(0),
});
const newSucceededSchema = z.strictObject({
  useId: uuidSchema,
  status: z.literal("SUCCEEDED"),
  code: z.literal("SUCCEEDED"),
  replayed: z.literal(false),
  usageDelta: z.literal(1),
  actionDelta: z.literal(1),
  receipt: receiptSchema,
});
const retrySucceededSchema = newSucceededSchema.extend({
  code: z.literal("RETRY_RESOLVED"),
  replayed: z.literal(true),
  usageDelta: z.literal(0),
  actionDelta: z.literal(0),
});
const newFailedSchema = z.strictObject({
  useId: uuidSchema,
  status: z.literal("FAILED_FINAL"),
  code: z.literal("ACTION_FAILED_FINAL"),
  replayed: z.literal(false),
  usageDelta: z.literal(1),
  actionDelta: z.literal(0),
  failureCode: actionFailureCodeSchema,
});
const retryFailedSchema = newFailedSchema.extend({
  code: z.literal("RETRY_RESOLVED"),
  replayed: z.literal(true),
  usageDelta: z.literal(0),
});

export const useResultSchema = z
  .union([
    newPendingSchema,
    retryPendingSchema,
    newSucceededSchema,
    retrySucceededSchema,
    newFailedSchema,
    retryFailedSchema,
  ])
  .refine((result) => !("receipt" in result) || result.useId === result.receipt.useId, {
    message: "Receipt must belong to the returned use.",
  });

export const useStatusResponseSchema = z
  .discriminatedUnion("status", [
    z.strictObject({ useId: uuidSchema, status: z.literal("ACCEPTED_PENDING_ACTION") }),
    z.strictObject({ useId: uuidSchema, status: z.literal("SUCCEEDED"), receipt: receiptSchema }),
    z.strictObject({
      useId: uuidSchema,
      status: z.literal("FAILED_FINAL"),
      failureCode: actionFailureCodeSchema,
    }),
  ])
  .refine((result) => !("receipt" in result) || result.useId === result.receipt.useId, {
    message: "Receipt must belong to the returned use.",
  });
export type UseState = z.infer<typeof useStateSchema>;
export type ActionFailureCode = z.infer<typeof actionFailureCodeSchema>;
export type UseResult = z.infer<typeof useResultSchema>;
export type UseStatusResponse = z.infer<typeof useStatusResponseSchema>;
