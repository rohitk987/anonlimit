import { z } from "zod";

export const healthResponseSchema = z
  .object({
    status: z.enum(["ok", "unavailable"]),
    service: z.enum(["api", "action-simulator"]),
    phase: z.literal(1),
  })
  .strict();

export type HealthResponse = z.infer<typeof healthResponseSchema>;
