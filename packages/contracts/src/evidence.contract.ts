import { z } from "zod";
import { maskedUseRefSchema } from "./event.contract.js";
import {
  actionKeySchema,
  digestSchema,
  protocolVersionSchema,
  timestampSchema,
  uuidSchema,
} from "./primitives.js";
import { useStateSchema } from "./use-result.contract.js";

export const checkStatusSchema = z.enum(["PASS", "FAIL", "NOT_RUN", "INCOMPLETE"]);
export const invariantCheckSchema = z.strictObject({ status: checkStatusSchema });
const measuredCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
export const evidenceCountsSchema = z.strictObject({
  committedUses: measuredCountSchema,
  outboxEvents: measuredCountSchema,
  externalActions: measuredCountSchema,
  retryUsageDelta: measuredCountSchema,
  retryActionDelta: measuredCountSchema,
  failedAttemptUses: measuredCountSchema,
  credentialWideIdentifiersStored: measuredCountSchema,
  storedHolderIdentities: measuredCountSchema,
  linkedDistinctLegitimateUsePairs: measuredCountSchema,
});
export const evidenceChecksSchema = z.strictObject({
  boundedUse: invariantCheckSchema,
  singleAcceptance: invariantCheckSchema,
  retryIdempotency: invariantCheckSchema,
  noFailedVerificationConsumption: invariantCheckSchema,
  singleExternalEffect: invariantCheckSchema,
  recoverability: invariantCheckSchema,
  noStableIdentity: invariantCheckSchema,
  distinctUseUnlinkability: invariantCheckSchema,
  retryRecognition: invariantCheckSchema,
  overLimitRejected: invariantCheckSchema,
  allReceiptsStable: invariantCheckSchema,
});
export const linkabilityResultSchema = z.enum(["SAME_USE", "UNLINKABLE"]);
export const linkabilityPairSchema = z
  .strictObject({
    leftUseRef: maskedUseRefSchema,
    rightUseRef: maskedUseRefSchema,
    expected: linkabilityResultSchema,
    result: linkabilityResultSchema,
  })
  .refine((pair) => (pair.leftUseRef === pair.rightUseRef) === (pair.expected === "SAME_USE"), {
    message: "Expected linkability must match the compared use references.",
  });
export const linkabilityReportSchema = z
  .strictObject({
    status: checkStatusSchema,
    pairs: z.array(linkabilityPairSchema).max(5_050),
  })
  .refine(
    (report) => {
      if (report.status === "NOT_RUN" || report.status === "INCOMPLETE")
        return report.pairs.length === 0;
      if (report.pairs.length === 0) return false;
      const pairKeys = report.pairs.map((pair) =>
        [pair.leftUseRef, pair.rightUseRef].sort().join(":")
      );
      if (new Set(pairKeys).size !== pairKeys.length) return false;
      const failed = report.pairs.some((pair) => pair.expected !== pair.result);
      return report.status === (failed ? "FAIL" : "PASS");
    },
    { message: "Linkability status must reflect the supplied comparisons." }
  );
export const evidenceUseSchema = z
  .strictObject({
    maskedUseRef: maskedUseRefSchema,
    intentDigest: digestSchema,
    status: useStateSchema,
    receiptId: uuidSchema.nullable(),
    actionKey: actionKeySchema,
  })
  .refine((use) => (use.status === "SUCCEEDED") === (use.receiptId !== null), {
    message: "Only completed uses contain a receipt.",
  });
export const evidenceReportSchema = z
  .strictObject({
    protocolVersion: protocolVersionSchema,
    demoRunId: uuidSchema,
    generatedAt: timestampSchema,
    declaredLimit: z.number().int().min(1).max(100),
    counts: evidenceCountsSchema,
    checks: evidenceChecksSchema,
    overall: checkStatusSchema,
    uses: z.array(evidenceUseSchema).max(10_000),
    linkability: linkabilityReportSchema,
  })
  .superRefine((report, context) => {
    const statuses = Object.values(report.checks).map((check) => check.status);
    const expected = statuses.includes("FAIL")
      ? "FAIL"
      : statuses.includes("INCOMPLETE")
        ? "INCOMPLETE"
        : statuses.every((status) => status === "PASS")
          ? "PASS"
          : "NOT_RUN";
    if (report.overall !== expected)
      context.addIssue({
        code: "custom",
        message: "Overall status must reflect all checks.",
        path: ["overall"],
      });
    if (
      report.overall === "PASS" &&
      (Object.values(report.counts).some((count) => count === null) ||
        report.linkability.status !== "PASS")
    ) {
      context.addIssue({
        code: "custom",
        message: "Passing evidence requires measurements and a completed audit.",
        path: ["overall"],
      });
    }
    const useRefs = report.uses.map((use) => use.maskedUseRef);
    if (new Set(useRefs).size !== useRefs.length)
      context.addIssue({
        code: "custom",
        message: "Evidence use references must be unique.",
        path: ["uses"],
      });
    const useSet = new Set(useRefs);
    if (
      report.linkability.pairs.some(
        (pair) => !useSet.has(pair.leftUseRef) || !useSet.has(pair.rightUseRef)
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Audit comparisons must reference reported uses.",
        path: ["linkability"],
      });
    }
    if (report.checks.distinctUseUnlinkability.status === "PASS") {
      const expectedPairs = (useRefs.length * (useRefs.length - 1)) / 2;
      const distinctPairs = report.linkability.pairs.filter(
        (pair) => pair.expected === "UNLINKABLE"
      );
      if (
        expectedPairs === 0 ||
        distinctPairs.length !== expectedPairs ||
        distinctPairs.some((pair) => pair.result !== "UNLINKABLE")
      ) {
        context.addIssue({
          code: "custom",
          message: "Distinct-use evidence requires every accepted-use pair.",
          path: ["checks", "distinctUseUnlinkability"],
        });
      }
    }
    if (
      report.checks.retryRecognition.status === "PASS" &&
      !report.linkability.pairs.some(
        (pair) => pair.expected === "SAME_USE" && pair.result === "SAME_USE"
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Retry evidence requires a same-use comparison.",
        path: ["checks", "retryRecognition"],
      });
    }
  });
export type CheckStatus = z.infer<typeof checkStatusSchema>;
export type InvariantCheck = z.infer<typeof invariantCheckSchema>;
export type EvidenceCounts = z.infer<typeof evidenceCountsSchema>;
export type EvidenceChecks = z.infer<typeof evidenceChecksSchema>;
export type LinkabilityResult = z.infer<typeof linkabilityResultSchema>;
export type LinkabilityReport = z.infer<typeof linkabilityReportSchema>;
export type EvidenceUse = z.infer<typeof evidenceUseSchema>;
export type EvidenceReport = z.infer<typeof evidenceReportSchema>;
