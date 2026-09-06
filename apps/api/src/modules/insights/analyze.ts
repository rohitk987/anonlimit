import {
  protocolEventSchema,
  type AbuseReport,
  type AuditSummary,
  type CheckStatus,
  type EvidenceReport,
  type InsightsReport,
  type ProtocolEvent,
} from "@anonlimit/contracts";

const measured = (value: number | null): string =>
  value === null ? "not measured" : String(value);

function findingText(status: CheckStatus, texts: Record<CheckStatus, string>): string {
  return texts[status];
}

function summarize(evidence: EvidenceReport): AuditSummary {
  const { counts, checks, declaredLimit } = evidence;
  const findings: AuditSummary["findings"] = [
    {
      id: "boundedUse",
      status: checks.boundedUse.status,
      text: findingText(checks.boundedUse.status, {
        PASS: `The declared ${declaredLimit}-use bound was reached: ${measured(counts.committedUses)} uses accepted.`,
        FAIL: `The bound check failed. Accepted uses: ${measured(counts.committedUses)}; declared limit: ${declaredLimit}.`,
        NOT_RUN: `The full bound has not been demonstrated. Accepted uses: ${measured(counts.committedUses)}; declared limit: ${declaredLimit}.`,
        INCOMPLETE: `Bound evidence is incomplete. Accepted uses: ${measured(counts.committedUses)}; declared limit: ${declaredLimit}.`,
      }),
    },
    {
      id: "retryIdempotency",
      status: checks.retryIdempotency.status,
      text: findingText(checks.retryIdempotency.status, {
        PASS: "Measured retries consumed no extra uses and committed no extra actions.",
        FAIL: `Retry safety failed. Extra uses: ${measured(counts.retryUsageDelta)}; extra actions: ${measured(counts.retryActionDelta)}.`,
        NOT_RUN: "Retry safety has not been demonstrated; an exact retry must be measured.",
        INCOMPLETE: "Retry evidence is incomplete; no safe-retry conclusion is available.",
      }),
    },
    {
      id: "overLimitRejected",
      status: checks.overLimitRejected.status,
      text: findingText(checks.overLimitRejected.status, {
        PASS: "The measured over-limit attempt was rejected without consuming a use or creating an action.",
        FAIL: "The over-limit check failed: the attempt was accepted or changed protected state.",
        NOT_RUN: "An over-limit attempt has not yet been demonstrated.",
        INCOMPLETE: "Over-limit rejection evidence is incomplete.",
      }),
    },
    {
      id: "noStableIdentity",
      status: checks.noStableIdentity.status,
      text: findingText(checks.noStableIdentity.status, {
        PASS: "The measured verifier schema contains no identity fields for holders or credential-wide identifier fields. This does not audit every external system or prove real-world anonymity.",
        FAIL: `Verifier identity-storage check failed. Holder identity fields: ${measured(counts.storedHolderIdentities)}; credential-wide identifier fields: ${measured(counts.credentialWideIdentifiersStored)}.`,
        NOT_RUN:
          "Verifier identity-storage measurements are unavailable; absence of stored identity has not been established.",
        INCOMPLETE:
          "Verifier identity-storage evidence is incomplete; absence of stored identity has not been established.",
      }),
    },
    {
      id: "distinctUseUnlinkability",
      status: checks.distinctUseUnlinkability.status,
      text: findingText(checks.distinctUseUnlinkability.status, {
        PASS: "Every measured distinct-use pair passed the simulated provider's unlinkability test. This is a simulator assumption, not a proof of production anonymity.",
        FAIL: "The distinct-use unlinkability check failed under the simulated provider; review the measured comparisons.",
        NOT_RUN: "The simulated provider's distinct-use unlinkability test has not run.",
        INCOMPLETE:
          "Distinct-use comparisons are incomplete or the simulated audit provider is unavailable.",
      }),
    },
  ];
  const nextSteps: string[] = [];
  if (checks.boundedUse.status !== "PASS") {
    nextSteps.push(
      checks.boundedUse.status === "FAIL"
        ? "Inspect the accepted-use ledger and configured limit before trusting the bound."
        : `Issue one pass and complete its ${declaredLimit} allowed uses in the current demo run.`
    );
  }
  if (checks.retryIdempotency.status !== "PASS") {
    nextSteps.push(
      checks.retryIdempotency.status === "FAIL"
        ? "Investigate the extra use or action recorded during retry."
        : "Simulate a lost acknowledgement, then retry the saved request to measure zero extra uses and actions."
    );
  }
  if (checks.overLimitRejected.status !== "PASS") {
    nextSteps.push(
      checks.overLimitRejected.status === "FAIL"
        ? "Investigate the over-limit acceptance or unexpected state change."
        : "After the allowed uses, run the controlled over-limit attempt."
    );
  }
  if (checks.noStableIdentity.status !== "PASS") {
    nextSteps.push(
      "Inspect the verifier schema privacy measurements and resolve missing or prohibited fields."
    );
  }
  if (
    checks.distinctUseUnlinkability.status !== "PASS" ||
    checks.retryRecognition.status !== "PASS"
  ) {
    nextSteps.push(
      "Run the privacy audit after completing the uses and exact retry; inspect distinct-use and same-use comparisons."
    );
  }
  if (checks.noFailedVerificationConsumption.status !== "PASS") {
    nextSteps.push(
      "Measure a rejected presentation and verify that it consumes no use and creates no action."
    );
  }
  if (checks.singleAcceptance.status !== "PASS" || checks.singleExternalEffect.status !== "PASS") {
    nextSteps.push(
      "Inspect use, outbox, and external-action evidence for missing records or duplicate effects."
    );
  }
  if (checks.recoverability.status !== "PASS" || checks.allReceiptsStable.status !== "PASS") {
    nextSteps.push(
      "Wait for pending delivery, recover the stored receipts, and inspect any failed or inconsistent outcomes."
    );
  }
  const headlines: Record<CheckStatus, string> = {
    PASS: "All measured demo checks passed under the simulated crypto contract.",
    FAIL: "At least one measured demo check failed; inspect the evidence before drawing conclusions.",
    NOT_RUN: "The demonstration is still in progress; required checks have not all run.",
    INCOMPLETE: "The audit is incomplete; some required evidence or comparisons are unavailable.",
  };
  return {
    status: evidence.overall,
    headline: headlines[evidence.overall],
    declaredLimit,
    counts: { ...counts },
    findings,
    nextSteps,
  };
}

type Decision = "accepted" | "rejected" | "conflicts" | "retries" | "overLimit";
const decisions = {
  USE_ACCEPTED: "accepted",
  PRESENTATION_REJECTED: "rejected",
  NULLIFIER_CONFLICT: "conflicts",
  RETRY_MATCHED: "retries",
  OVER_LIMIT_REJECTED: "overLimit",
} as const;
const decisionPriority: Record<Decision, number> = {
  rejected: 1,
  accepted: 2,
  retries: 3,
  conflicts: 4,
  overLimit: 5,
};

function analyzeActivity(evidence: EvidenceReport, events: readonly ProtocolEvent[]): AbuseReport {
  const windowEnd = Date.parse(evidence.generatedAt);
  const byRequest = new Map<string, Decision>();
  for (const candidate of events) {
    const parsed = protocolEventSchema.safeParse(candidate);
    if (!parsed.success || !Number.isFinite(windowEnd)) continue;
    const event = parsed.data;
    const occurredAt = Date.parse(event.occurredAt);
    // A rolling window is (generatedAt - 60s, generatedAt]; future events are excluded.
    if (
      event.demoRunId !== evidence.demoRunId ||
      !Number.isFinite(occurredAt) ||
      occurredAt <= windowEnd - 60_000 ||
      occurredAt > windowEnd ||
      !(event.event in decisions)
    )
      continue;
    const decision = decisions[event.event as keyof typeof decisions];
    const prior = byRequest.get(event.traceId);
    // Rejections can have a second, more specific diagnostic event in the same request.
    if (prior === undefined || decisionPriority[decision] > decisionPriority[prior]) {
      byRequest.set(event.traceId, decision);
    }
  }
  const counters: AbuseReport["counters"] = {
    attempts: byRequest.size,
    accepted: 0,
    rejected: 0,
    conflicts: 0,
    retries: 0,
    overLimit: 0,
  };
  for (const decision of byRequest.values()) counters[decision] += 1;
  const candidates: AbuseReport["signals"] = [
    {
      code: "REQUEST_BURST",
      observed: counters.attempts,
      threshold: 30,
      explanation:
        "Elevated aggregate request activity in this demo run. Review traffic or an intentional concurrency test; this does not identify a person.",
    },
    {
      code: "REJECTION_BURST",
      observed: counters.rejected,
      threshold: 5,
      explanation:
        "Repeated generic presentation rejections. Review client configuration or deliberate invalid-proof tests; rejection alone does not establish abuse.",
    },
    {
      code: "CONFLICTING_REPLAYS",
      observed: counters.conflicts,
      threshold: 3,
      explanation:
        "Repeated conflicting replay decisions. Review changed requests or a deliberate conflict test; no holder identity is inferred.",
    },
    {
      code: "RETRY_BURST",
      observed: counters.retries,
      threshold: 10,
      explanation:
        "Frequent exact retries can result from network trouble, concurrency, or a recovery test. They are not extra consumed uses or proof of abuse.",
    },
    {
      code: "REPEATED_BOUNDARY_PROBES",
      observed: counters.overLimit,
      threshold: 3,
      explanation:
        "Repeated over-limit probes in the demo run. Check whether the evaluator intentionally repeated the boundary test; no person is identified or blocked by this signal.",
    },
  ];
  const signals = candidates.filter((signal) => signal.observed >= signal.threshold);
  return {
    level: signals.length > 0 ? "REVIEW" : counters.attempts > 0 ? "QUIET" : "NO_ACTIVITY",
    windowSeconds: 60,
    counters,
    signals,
  };
}

/** Explains measured evidence and flags aggregate activity; never makes protocol decisions. */
export function analyzeInsights(
  evidence: EvidenceReport,
  events: readonly ProtocolEvent[]
): Pick<InsightsReport, "summary" | "abuse"> {
  return { summary: summarize(evidence), abuse: analyzeActivity(evidence, events) };
}
