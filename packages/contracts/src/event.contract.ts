import { z } from "zod";
import { publicErrorCodeSchema } from "./error.contract.js";
import { identifierSchema, timestampSchema, uuidSchema } from "./primitives.js";

export const maskedUseRefSchema = z.string().regex(/^use_[a-f0-9]{12}$/);
export const eventNameSchema = z.enum([
  "CREDENTIAL_ISSUED",
  "PRESENTATION_RECEIVED",
  "PROOF_ACCEPTED",
  "USE_ACCEPTED",
  "ACTION_DISPATCH_STARTED",
  "EXTERNAL_ACTION_COMMITTED",
  "RECEIPT_STORED",
  "ACK_DROPPED",
  "RETRY_MATCHED",
  "CACHED_RECEIPT_RETURNED",
  "NULLIFIER_CONFLICT",
  "OVER_LIMIT_REJECTED",
  "PRIVACY_AUDIT_COMPLETED",
  "RETRY_IN_PROGRESS",
  "RETRY_RESOLVED",
  "PRESENTATION_REJECTED",
  "USE_FAILED_FINAL",
  "DEMO_RESET",
]);
export const decisionCodeSchema = z.union([
  publicErrorCodeSchema,
  z.enum([
    "ACCEPTED_PENDING_ACTION",
    "SUCCEEDED",
    "RETRY_IN_PROGRESS",
    "RETRY_RESOLVED",
    "EXTERNAL_ACTION_COMMITTED",
    "DEMO_RESET",
  ]),
]);
export const eventStateSchema = z.enum([
  "UNSEEN",
  "REJECTED",
  "ACCEPTED_PENDING_ACTION",
  "SUCCEEDED",
  "FAILED_FINAL",
]);
export const protocolEventSchema = z.strictObject({
  sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  occurredAt: timestampSchema,
  event: eventNameSchema,
  traceId: uuidSchema,
  demoRunId: uuidSchema,
  policyId: identifierSchema,
  policyVersion: z.number().int().min(1).max(2_147_483_647),
  fromState: eventStateSchema.optional(),
  toState: eventStateSchema.optional(),
  decisionCode: decisionCodeSchema.optional(),
  usageDelta: z.union([z.literal(0), z.literal(1)]),
  actionDelta: z.union([z.literal(0), z.literal(1)]),
  latencyMs: z.number().finite().nonnegative().max(86_400_000).optional(),
  maskedUseRef: maskedUseRefSchema.optional(),
});
export const eventStreamQuerySchema = z.strictObject({
  after: z
    .string()
    .regex(/^(0|[1-9][0-9]{0,15})$/)
    .refine((value) => Number.isSafeInteger(Number(value)))
    .optional(),
});
export type EventName = z.infer<typeof eventNameSchema>;
export type DecisionCode = z.infer<typeof decisionCodeSchema>;
export type ProtocolEvent = z.infer<typeof protocolEventSchema>;
export type EventStreamQuery = z.infer<typeof eventStreamQuerySchema>;
