import { z } from "zod";
import { policySchema } from "@anonlimit/contracts";

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
export const ticketSchema = z
  .string()
  .max(4096)
  .regex(/^simcap1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
export const walletCredentialSchema = z
  .strictObject({
    version: z.literal("simulated-capabilities/v1"),
    policy: policySchema,
    demoRunId: z.uuid(),
    slots: z
      .array(z.strictObject({ nullifier: hex64, authenticationKey: hex64, ticket: ticketSchema }))
      .min(1)
      .max(100),
  })
  .refine((value) => value.slots.length === value.policy.maxUses);

// Only one per-use ticket and a context MAC leave the holder. No slot or credential identifier.
export const proofEnvelopeSchema = z.strictObject({
  version: z.literal("simulated-capabilities/v1"),
  ticket: ticketSchema,
  authenticator: hex64,
});
