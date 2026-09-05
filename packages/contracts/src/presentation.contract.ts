import type { z } from "zod";
import { challengeRequestSchema } from "./challenge.contract.js";
import { hex64Schema, opaqueProofSchema, uuidSchema } from "./primitives.js";

export const presentationSchema = challengeRequestSchema.extend({
  challengeId: uuidSchema,
  nonce: hex64Schema,
  nullifier: hex64Schema,
  opaqueProof: opaqueProofSchema,
});
export type Presentation = z.infer<typeof presentationSchema>;
