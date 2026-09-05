import { z } from "zod";
import { identifierSchema, timestampSchema } from "./primitives.js";

export const policySchema = z
  .strictObject({
    id: identifierSchema,
    version: z.number().int().min(1).max(2_147_483_647),
    issuerKeyId: identifierSchema,
    audience: identifierSchema,
    maxUses: z.number().int().min(1).max(100),
    quotaWindowId: identifierSchema,
    status: z.enum(["ACTIVE", "DISABLED"]),
    validFrom: timestampSchema,
    validUntil: timestampSchema,
  })
  .refine((policy) => Date.parse(policy.validFrom) < Date.parse(policy.validUntil), {
    message: "Policy validity interval must be increasing.",
  });
export const policyPathSchema = z.strictObject({
  id: identifierSchema,
  version: z
    .string()
    .regex(/^[1-9][0-9]{0,9}$/)
    .refine((value) => Number(value) <= 2_147_483_647),
});
export type Policy = z.infer<typeof policySchema>;
export type PolicyPath = z.infer<typeof policyPathSchema>;
