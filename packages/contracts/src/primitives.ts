import { z } from "zod";

export const protocolVersionSchema = z.literal("AnonLimit/v1");
export const identifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
export const uuidSchema = z
  .string()
  .regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
export const timestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/)
  .refine((value) => {
    const timestamp = Date.parse(value);
    return (
      Number.isFinite(timestamp) &&
      new Date(timestamp).toISOString().slice(0, 19) === value.slice(0, 19)
    );
  });
export const hex64Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const actionKeySchema = z.string().regex(/^hmac-sha256:[a-f0-9]{64}$/);
export const opaqueCredentialSchema = z
  .string()
  .min(16)
  .max(262_144)
  .regex(/^[A-Za-z0-9_-]+$/);
export const opaqueProofSchema = z
  .string()
  .min(16)
  .max(8_192)
  .regex(/^[A-Za-z0-9_-]+$/);
export const blindedHolderRequestSchema = z
  .string()
  .min(16)
  .max(4_096)
  .regex(/^[A-Za-z0-9_-]+$/);
export const policyReferenceSchema = z.strictObject({
  policyId: identifierSchema,
  policyVersion: z.number().int().min(1).max(2_147_483_647),
});
export type PolicyReference = z.infer<typeof policyReferenceSchema>;
