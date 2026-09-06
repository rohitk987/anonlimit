import { describe, expect, it } from "vitest";
import {
  abuseReportSchema,
  auditSummarySchema,
  evidenceReportSchema,
  type EvidenceReport,
  type ProtocolEvent,
} from "@anonlimit/contracts";
import { analyzeInsights } from "../../apps/api/src/modules/insights/analyze.js";

const runId = "70000000-0000-4000-8000-000000000001";
const generatedAt = "2026-09-06T12:00:00.000Z";
const checkNames = [
  "boundedUse",
  "singleAcceptance",
  "retryIdempotency",
  "noFailedVerificationConsumption",
  "singleExternalEffect",
  "recoverability",
  "noStableIdentity",
  "distinctUseUnlinkability",
  "retryRecognition",
  "overLimitRejected",
  "allReceiptsStable",
] as const;

function completeEvidence(): EvidenceReport {
  const uses = [1, 2, 3].map((index) => ({
    maskedUseRef: `use_${String(index).repeat(12)}`,
    intentDigest: `sha256:${String(index).repeat(64)}`,
    status: "SUCCEEDED",
    receiptId: `70000000-0000-4000-8000-${String(100 + index).padStart(12, "0")}`,
    actionKey: `hmac-sha256:${String(index).repeat(64)}`,
  }));
  return evidenceReportSchema.parse({
    protocolVersion: "AnonLimit/v1",
    demoRunId: runId,
    generatedAt,
    declaredLimit: 3,
    counts: {
      committedUses: 3,
      outboxEvents: 3,
      externalActions: 3,
      retryUsageDelta: 0,
      retryActionDelta: 0,
      failedAttemptUses: 0,
      credentialWideIdentifiersStored: 0,
      storedHolderIdentities: 0,
      linkedDistinctLegitimateUsePairs: 0,
    },
    checks: Object.fromEntries(checkNames.map((name) => [name, { status: "PASS" }])),
    overall: "PASS",
    uses,
    linkability: {
      status: "PASS",
      pairs: [
        {
          leftUseRef: "use_111111111111",
          rightUseRef: "use_222222222222",
          expected: "UNLINKABLE",
          result: "UNLINKABLE",
        },
        {
          leftUseRef: "use_111111111111",
          rightUseRef: "use_333333333333",
          expected: "UNLINKABLE",
          result: "UNLINKABLE",
        },
        {
          leftUseRef: "use_222222222222",
          rightUseRef: "use_333333333333",
          expected: "UNLINKABLE",
          result: "UNLINKABLE",
        },
        {
          leftUseRef: "use_222222222222",
          rightUseRef: "use_222222222222",
          expected: "SAME_USE",
          result: "SAME_USE",
        },
      ],
    },
  });
}

function event(index: number, name: ProtocolEvent["event"]): ProtocolEvent {
  return {
    sequence: index,
    traceId: `70000000-0000-4000-8000-${String(200 + index).padStart(12, "0")}`,
    occurredAt: generatedAt,
    demoRunId: runId,
    policyId: "private-policy-canary",
    policyVersion: 1,
    event: name,
    usageDelta: name === "USE_ACCEPTED" ? 1 : 0,
    actionDelta: name === "EXTERNAL_ACTION_COMMITTED" ? 1 : 0,
  };
}

describe("measured audit summaries and aggregate activity", () => {
  it("explains a passing golden run without flagging ordinary uses, retry or one boundary probe", () => {
    const events = [
      event(1, "USE_ACCEPTED"),
      event(2, "USE_ACCEPTED"),
      event(3, "USE_ACCEPTED"),
      event(4, "RETRY_MATCHED"),
      event(5, "OVER_LIMIT_REJECTED"),
      event(6, "EXTERNAL_ACTION_COMMITTED"),
      event(7, "ACK_DROPPED"),
      event(8, "RETRY_RESOLVED"),
      event(9, "PRIVACY_AUDIT_COMPLETED"),
    ];
    const analysis = analyzeInsights(completeEvidence(), events);
    expect(auditSummarySchema.safeParse(analysis.summary).success).toBe(true);
    expect(abuseReportSchema.safeParse(analysis.abuse).success).toBe(true);
    expect(analysis.summary.status).toBe("PASS");
    expect(analysis.summary.nextSteps).toEqual([]);
    expect(analysis.summary.findings.every((finding) => finding.status === "PASS")).toBe(true);
    expect(
      analysis.summary.findings.find((finding) => finding.id === "noStableIdentity")?.text
    ).toContain("measured verifier schema");
    expect(
      analysis.summary.findings.find((finding) => finding.id === "distinctUseUnlinkability")?.text
    ).toContain("simulator assumption");
    expect(analysis.abuse).toEqual({
      level: "QUIET",
      windowSeconds: 60,
      signals: [],
      counters: { attempts: 5, accepted: 3, rejected: 0, conflicts: 0, retries: 1, overLimit: 1 },
    });
  });

  it("preserves unavailable measurements and guides every missing scenario without inventing passes", () => {
    const evidence = completeEvidence();
    for (const name of checkNames) evidence.checks[name].status = "NOT_RUN";
    for (const name of Object.keys(evidence.counts) as (keyof EvidenceReport["counts"])[])
      evidence.counts[name] = null;
    evidence.overall = "NOT_RUN";
    const { summary, abuse } = analyzeInsights(evidence, []);
    expect(summary.status).toBe("NOT_RUN");
    expect(summary.findings.every((finding) => finding.status === "NOT_RUN")).toBe(true);
    expect(Object.values(summary.counts).every((count) => count === null)).toBe(true);
    expect(summary.findings[0]?.text).toContain("not measured");
    expect(summary.nextSteps).toHaveLength(8);
    expect(abuse.level).toBe("NO_ACTIVITY");
    expect(auditSummarySchema.safeParse(summary).success).toBe(true);
  });

  it("preserves failed and incomplete findings and an overall failure from another backend check", () => {
    const evidence = completeEvidence();
    evidence.checks.retryIdempotency.status = "FAIL";
    evidence.counts.retryUsageDelta = 1;
    evidence.checks.distinctUseUnlinkability.status = "INCOMPLETE";
    evidence.overall = "FAIL";
    let summary = analyzeInsights(evidence, []).summary;
    expect(summary.status).toBe("FAIL");
    expect(summary.findings.find((finding) => finding.id === "retryIdempotency")).toMatchObject({
      status: "FAIL",
      text: expect.stringContaining("Extra uses: 1"),
    });
    expect(
      summary.findings.find((finding) => finding.id === "distinctUseUnlinkability")?.status
    ).toBe("INCOMPLETE");
    expect(summary.nextSteps).toContain(
      "Investigate the extra use or action recorded during retry."
    );

    const otherFailure = completeEvidence();
    otherFailure.checks.singleExternalEffect.status = "FAIL";
    otherFailure.overall = "FAIL";
    summary = analyzeInsights(otherFailure, []).summary;
    expect(summary.status).toBe("FAIL");
    expect(summary.findings.every((finding) => finding.status === "PASS")).toBe(true);
    expect(summary.nextSteps.join(" ")).toContain("duplicate effects");
  });

  it.each([
    ["USE_ACCEPTED", "REQUEST_BURST", 30],
    ["PRESENTATION_REJECTED", "REJECTION_BURST", 5],
    ["NULLIFIER_CONFLICT", "CONFLICTING_REPLAYS", 3],
    ["RETRY_MATCHED", "RETRY_BURST", 10],
    ["OVER_LIMIT_REJECTED", "REPEATED_BOUNDARY_PROBES", 3],
  ] as const)("signals %s at its inclusive threshold only", (name, code, threshold) => {
    const events = Array.from({ length: threshold }, (_, index) => event(index + 1, name));
    const below = analyzeInsights(completeEvidence(), events.slice(0, -1)).abuse;
    expect(below.signals).toEqual([]);
    const at = analyzeInsights(completeEvidence(), events).abuse;
    expect(at.level).toBe("REVIEW");
    expect(at.signals).toEqual([expect.objectContaining({ code, observed: threshold, threshold })]);
    expect(at.counters.attempts).toBe(
      at.counters.accepted +
        at.counters.rejected +
        at.counters.conflicts +
        at.counters.retries +
        at.counters.overLimit
    );
    if (code === "RETRY_BURST")
      expect(at.signals[0]?.explanation).toMatch(/network trouble, concurrency/);
  });

  it("uses the evidence clock and active run, excluding stale, future and malformed events", () => {
    const events = [
      { ...event(1, "USE_ACCEPTED"), occurredAt: "2026-09-06T11:59:00.001Z" },
      event(2, "USE_ACCEPTED"),
      { ...event(3, "USE_ACCEPTED"), occurredAt: "2026-09-06T11:59:00.000Z" },
      { ...event(4, "USE_ACCEPTED"), occurredAt: "2026-09-06T12:00:00.001Z" },
      { ...event(5, "USE_ACCEPTED"), occurredAt: "invalid" },
      { ...event(6, "USE_ACCEPTED"), demoRunId: "70000000-0000-4000-8000-000000000002" },
      { ...event(7, "USE_ACCEPTED"), traceId: "invalid" },
    ];
    expect(analyzeInsights(completeEvidence(), events).abuse.counters.attempts).toBe(2);
    expect(
      analyzeInsights({ ...completeEvidence(), generatedAt: "invalid" }, events).abuse.level
    ).toBe("NO_ACTIVITY");
  });

  it("counts each request once and gives specific rejection diagnostics priority in either event order", () => {
    const generic = event(1, "PRESENTATION_REJECTED");
    const conflict = { ...generic, event: "NULLIFIER_CONFLICT" as const, sequence: 2 };
    const boundary = event(3, "OVER_LIMIT_REJECTED");
    const genericBoundary = { ...boundary, event: "PRESENTATION_REJECTED" as const, sequence: 4 };
    const retry = event(5, "RETRY_MATCHED");
    const events = [
      generic,
      conflict,
      boundary,
      genericBoundary,
      retry,
      retry,
      { ...retry, event: "CACHED_RECEIPT_RETURNED" as const },
    ];
    const forward = analyzeInsights(completeEvidence(), events).abuse;
    expect(forward.counters).toEqual({
      attempts: 3,
      accepted: 0,
      rejected: 0,
      conflicts: 1,
      retries: 1,
      overLimit: 1,
    });
    expect(analyzeInsights(completeEvidence(), [...events].reverse()).abuse).toEqual(forward);
  });

  it("returns only aggregates and fixed narration without mutating or disclosing evidence identifiers", () => {
    const evidence = completeEvidence();
    const events = [event(1, "USE_ACCEPTED")];
    const before = JSON.stringify({ evidence, events });
    const output = JSON.stringify(analyzeInsights(evidence, events));
    expect(JSON.stringify({ evidence, events })).toBe(before);
    expect(output).not.toMatch(
      /private-policy-canary|70000000|use_111111|sha256:|traceId|receiptId|maskedUseRef|demoRunId/
    );
  });
});
