import { z } from "zod";
import { policySchema } from "./policy.contract.js";
import { presentationSchema } from "./presentation.contract.js";
import { protocolVersionSchema, timestampSchema, uuidSchema } from "./primitives.js";

export const emptyRequestSchema = z.strictObject({});
export const demoResetRequestSchema = emptyRequestSchema;
export const demoBoundaryProbeRequestSchema = emptyRequestSchema;
export const demoResetResponseSchema = z.strictObject({
  protocolVersion: protocolVersionSchema,
  demoRunId: uuidSchema,
  resetAt: timestampSchema,
  policy: policySchema,
});
export const demoDropAckRequestSchema = z.strictObject({ operationId: uuidSchema });
export const demoFaultResponseSchema = z.strictObject({
  demoRunId: uuidSchema,
  operationId: uuidSchema,
  fault: z.literal("DROP_NEXT_ACK_AFTER_COMMIT"),
  armed: z.literal(true),
});
export const demoRaceRequestSchema = z.strictObject({
  presentation: presentationSchema,
  copies: z.number().int().min(2).max(20),
});
export const demoLinkabilityRequestSchema = z.strictObject({
  presentations: z.array(presentationSchema).min(2).max(101),
});
export type DemoResetRequest = z.infer<typeof demoResetRequestSchema>;
export type DemoBoundaryProbeRequest = z.infer<typeof demoBoundaryProbeRequestSchema>;
export type DemoResetResponse = z.infer<typeof demoResetResponseSchema>;
export type DemoDropAckRequest = z.infer<typeof demoDropAckRequestSchema>;
export type DemoFaultResponse = z.infer<typeof demoFaultResponseSchema>;
export type DemoRaceRequest = z.infer<typeof demoRaceRequestSchema>;
export type DemoLinkabilityRequest = z.infer<typeof demoLinkabilityRequestSchema>;
