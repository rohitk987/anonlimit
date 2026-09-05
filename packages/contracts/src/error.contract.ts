import { z } from "zod";
import { uuidSchema } from "./primitives.js";

export const publicErrorCodeSchema = z.enum([
  "BAD_REQUEST",
  "PRESENTATION_REJECTED",
  "CHALLENGE_EXPIRED",
  "POLICY_REJECTED",
  "NULLIFIER_REUSE_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "ACTION_INTEGRITY_CONFLICT",
  "ACTION_FAILED_FINAL",
  "NOT_FOUND",
  "DEMO_DISABLED",
  "SERVICE_UNAVAILABLE",
  "INTERNAL_ERROR",
]);
export const publicErrorSchema = z.strictObject({
  code: publicErrorCodeSchema,
  traceId: uuidSchema,
  usageDelta: z.literal(0),
  actionDelta: z.literal(0),
});
export type PublicErrorCode = z.infer<typeof publicErrorCodeSchema>;
export type PublicError = z.infer<typeof publicErrorSchema>;
