import { z } from "zod";
import { checkStatusSchema, evidenceCountsSchema } from "./evidence.contract.js";
import { protocolVersionSchema, timestampSchema, uuidSchema } from "./primitives.js";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const insightFindingIdSchema = z.enum([
  "boundedUse",
  "retryIdempotency",
  "overLimitRejected",
  "noStableIdentity",
  "distinctUseUnlinkability",
]);
export const auditSummarySchema = z.strictObject({
  status: checkStatusSchema,
  declaredLimit: z.number().int().min(1).max(100),
  counts: evidenceCountsSchema,
  headline: z.string().min(1).max(300),
  findings: z
    .array(
      z.strictObject({
        id: insightFindingIdSchema,
        status: checkStatusSchema,
        text: z.string().min(1).max(500),
      })
    )
    .length(5),
  nextSteps: z.array(z.string().min(1).max(300)).max(8),
});
export const abuseSignalCodeSchema = z.enum([
  "REQUEST_BURST",
  "REJECTION_BURST",
  "CONFLICTING_REPLAYS",
  "RETRY_BURST",
  "REPEATED_BOUNDARY_PROBES",
]);
export const abuseReportSchema = z.strictObject({
  level: z.enum(["NO_ACTIVITY", "QUIET", "REVIEW"]),
  windowSeconds: z.literal(60),
  counters: z.strictObject({
    attempts: count,
    accepted: count,
    rejected: count,
    conflicts: count,
    retries: count,
    overLimit: count,
  }),
  signals: z
    .array(
      z.strictObject({
        code: abuseSignalCodeSchema,
        observed: count,
        threshold: count,
        explanation: z.string().min(1).max(500),
      })
    )
    .max(5),
});
export const aiCommentarySchema = z.strictObject({
  summary: z.string().trim().min(1).max(1600),
  abuseExplanation: z.string().trim().min(1).max(1200),
});
export const aiNarrationSchema = z
  .strictObject({
    status: z.enum(["DISABLED", "WAITING", "READY", "UNAVAILABLE"]),
    commentary: aiCommentarySchema.nullable(),
  })
  .refine((value) => (value.status === "READY") === (value.commentary !== null));
export const insightsReportSchema = z.strictObject({
  protocolVersion: protocolVersionSchema,
  demoRunId: uuidSchema,
  generatedAt: timestampSchema,
  analysisVersion: z.literal("rules-v1"),
  scope: z.literal("ACTIVE_DEMO_RUN"),
  advisoryOnly: z.literal(true),
  summary: auditSummarySchema,
  abuse: abuseReportSchema,
  ai: aiNarrationSchema,
});
export type AuditSummary = z.infer<typeof auditSummarySchema>;
export type AbuseReport = z.infer<typeof abuseReportSchema>;
export type AiCommentary = z.infer<typeof aiCommentarySchema>;
export type AiNarration = z.infer<typeof aiNarrationSchema>;
export type InsightsReport = z.infer<typeof insightsReportSchema>;
