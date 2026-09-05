import { describe, expect, it } from "vitest";
import {
  calculateInvariants,
  type AcceptedUse,
  type EvidenceObservations,
  type Receipt,
} from "@anonlimit/domain";

const unmeasured: EvidenceObservations = {
  declaredLimit: 3,
  credentialIssuances: null,
  uses: null,
  outboxUseIds: null,
  actions: null,
  retries: null,
  rejectedAttempts: null,
  privacy: null,
  receiptRecoveries: null,
  linkability: null,
};
function complete(): EvidenceObservations {
  const receipts: Receipt[] = [1, 2, 3].map((id) => ({
    receiptId: `receipt-${id}`,
    useId: `use-${id}`,
    actionKey: `action-${id}`,
    status: "COMMITTED",
    committedAt: "2026-09-05T00:00:00.000Z",
  }));
  const uses: AcceptedUse[] = receipts.map((receipt) => ({
    demoRunId: "run",
    scopeHash: "scope",
    useId: receipt.useId,
    operationId: `operation-${receipt.useId}`,
    nullifierKey: `protected-${receipt.useId}`,
    intentDigest: `intent-${receipt.useId}`,
    status: "SUCCEEDED",
    receipt,
  }));
  const snapshot = { uses: 3, outboxEvents: 3, externalActions: 3, receipts: 3 };
  return {
    declaredLimit: 3,
    credentialIssuances: 1,
    uses,
    outboxUseIds: uses.map((use) => use.useId),
    actions: receipts.map((receipt) => ({ useId: receipt.useId, actionKey: receipt.actionKey })),
    retries: [{ before: { ...snapshot }, after: { ...snapshot } }],
    rejectedAttempts: [
      { kind: "OVER_LIMIT", rejected: true, before: { ...snapshot }, after: { ...snapshot } },
    ],
    privacy: { storedHolderIdentities: 0, credentialWideIdentifiersStored: 0 },
    receiptRecoveries: receipts.map((receipt) => ({
      useId: receipt.useId,
      original: { ...receipt },
      recovered: { ...receipt },
    })),
    linkability: {
      distinctUseRefs: uses.map((use) => use.useId),
      pairs: [
        { leftUseRef: "use-1", rightUseRef: "use-2", expected: "UNLINKABLE", result: "UNLINKABLE" },
        { leftUseRef: "use-1", rightUseRef: "use-3", expected: "UNLINKABLE", result: "UNLINKABLE" },
        { leftUseRef: "use-2", rightUseRef: "use-3", expected: "UNLINKABLE", result: "UNLINKABLE" },
        { leftUseRef: "use-2", rightUseRef: "use-2", expected: "SAME_USE", result: "SAME_USE" },
      ],
    },
  };
}
describe("authoritative measured invariant calculation", () => {
  it("keeps every unavailable measurement NOT_RUN and never substitutes zero", () => {
    const report = calculateInvariants(unmeasured);
    expect(report.overall).toBe("NOT_RUN");
    expect(Object.values(report.checks).every((item) => item.status === "NOT_RUN")).toBe(true);
    expect(Object.values(report.counts).every((item) => item === null)).toBe(true);
  });
  it("derives PASS from a complete consistent measured scenario without exposing ledger fields", () => {
    const report = calculateInvariants(complete());
    expect(report.overall).toBe("PASS");
    expect(report.counts).toEqual({
      committedUses: 3,
      outboxEvents: 3,
      externalActions: 3,
      retryUsageDelta: 0,
      retryActionDelta: 0,
      failedAttemptUses: 0,
      credentialWideIdentifiersStored: 0,
      storedHolderIdentities: 0,
      linkedDistinctLegitimateUsePairs: 0,
    });
    expect(JSON.stringify(report)).not.toMatch(/protected-use|operation-use|intent-use|receipt-1/);
  });
  it("cannot infer a per-credential bound from multiple credentials or quota scopes", () => {
    const evidence = complete();
    expect(
      calculateInvariants({ ...evidence, credentialIssuances: 2 }).checks.boundedUse.status
    ).toBe("NOT_RUN");
    expect(
      calculateInvariants({
        ...evidence,
        uses: evidence.uses?.map((use, index) => ({ ...use, scopeHash: `scope-${index}` })) ?? null,
      }).checks.boundedUse.status
    ).toBe("NOT_RUN");
    expect(calculateInvariants({ ...evidence, uses: [] }).checks.boundedUse.status).toBe("NOT_RUN");
  });
  it("requires reaching the declared limit before claiming the demonstration passed", () => {
    const evidence = complete();
    expect(
      calculateInvariants({ ...evidence, uses: evidence.uses?.slice(0, 2) ?? null }).checks
        .boundedUse.status
    ).toBe("NOT_RUN");
    expect(calculateInvariants({ ...evidence, declaredLimit: 2 }).checks.boundedUse.status).toBe(
      "FAIL"
    );
  });
  it("detects duplicate use, nullifier, operation, outbox and external effect records", () => {
    const evidence = complete();
    for (const uses of [
      evidence.uses?.map((use) => ({ ...use, useId: "duplicate" })),
      evidence.uses?.map((use) => ({ ...use, nullifierKey: "duplicate" })),
      evidence.uses?.map((use) => ({ ...use, operationId: "duplicate" })),
    ])
      expect(
        calculateInvariants({ ...evidence, uses: uses ?? null }).checks.singleAcceptance.status
      ).toBe("FAIL");
    expect(
      calculateInvariants({ ...evidence, outboxUseIds: ["use-1", "use-1", "use-2"] }).checks
        .singleAcceptance.status
    ).toBe("FAIL");
    for (const actions of [
      [{ useId: "orphan", actionKey: "other" }],
      [
        { useId: "use-1", actionKey: "a" },
        { useId: "use-1", actionKey: "b" },
      ],
      [{ useId: "use-1", actionKey: "wrong" }],
    ])
      expect(calculateInvariants({ ...evidence, actions }).checks.singleExternalEffect.status).toBe(
        "FAIL"
      );
  });
  it("detects extra mutations from retry or rejected proof, including outbox-only changes", () => {
    const evidence = complete();
    const before = { uses: 3, outboxEvents: 3, externalActions: 3, receipts: 3 };
    for (const key of ["uses", "outboxEvents", "externalActions", "receipts"] as const) {
      const mutation = { before, after: { ...before, [key]: 4 } };
      expect(
        calculateInvariants({ ...evidence, retries: [mutation] }).checks.retryIdempotency.status
      ).toBe("FAIL");
      const report = calculateInvariants({
        ...evidence,
        rejectedAttempts: [{ ...mutation, kind: "OVER_LIMIT", rejected: true }],
      });
      expect(report.checks.overLimitRejected.status).toBe("FAIL");
      expect(report.checks.noFailedVerificationConsumption.status).toBe("FAIL");
    }
  });
  it("requires real rejection observations rather than an empty or successful attempt", () => {
    const evidence = complete();
    expect(
      calculateInvariants({ ...evidence, rejectedAttempts: [] }).checks.overLimitRejected.status
    ).toBe("NOT_RUN");
    expect(
      calculateInvariants({
        ...evidence,
        rejectedAttempts:
          evidence.rejectedAttempts?.map((item) => ({ ...item, rejected: false })) ?? null,
      }).checks.overLimitRejected.status
    ).toBe("FAIL");
  });
  it("fails identity leakage and keeps unavailable privacy scans unmeasured", () => {
    const evidence = complete();
    expect(calculateInvariants({ ...evidence, privacy: null }).checks.noStableIdentity.status).toBe(
      "NOT_RUN"
    );
    for (const privacy of [
      { storedHolderIdentities: 1, credentialWideIdentifiersStored: 0 },
      { storedHolderIdentities: 0, credentialWideIdentifiersStored: 1 },
    ])
      expect(calculateInvariants({ ...evidence, privacy }).checks.noStableIdentity.status).toBe(
        "FAIL"
      );
  });
  it("requires every accepted-use pair from the adapter and never infers unlinkability from unique nullifiers", () => {
    const evidence = complete();
    expect(
      calculateInvariants({ ...evidence, linkability: null }).checks.distinctUseUnlinkability.status
    ).toBe("NOT_RUN");
    const linkability = evidence.linkability;
    if (!linkability) throw new Error("Fixture missing audit");
    expect(
      calculateInvariants({
        ...evidence,
        linkability: { ...linkability, pairs: linkability.pairs.slice(1) },
      }).checks.distinctUseUnlinkability.status
    ).toBe("NOT_RUN");
    expect(
      calculateInvariants({
        ...evidence,
        linkability: {
          ...linkability,
          pairs: linkability.pairs.map((pair) => ({ ...pair, result: "SAME_USE" })),
        },
      }).checks.distinctUseUnlinkability.status
    ).toBe("FAIL");
    expect(
      calculateInvariants({
        ...evidence,
        linkability: { ...linkability, distinctUseRefs: ["other-1", "other-2", "other-3"] },
      }).checks.distinctUseUnlinkability.status
    ).toBe("FAIL");
  });
  it("requires real same-use retry recognition and rejects swapped references", () => {
    const evidence = complete();
    const linkability = evidence.linkability;
    if (!linkability) throw new Error("Fixture missing audit");
    expect(
      calculateInvariants({
        ...evidence,
        linkability: {
          ...linkability,
          pairs: linkability.pairs.filter((pair) => pair.expected === "UNLINKABLE"),
        },
      }).checks.retryRecognition.status
    ).toBe("NOT_RUN");
    expect(
      calculateInvariants({
        ...evidence,
        linkability: {
          ...linkability,
          pairs: linkability.pairs.map((pair) =>
            pair.expected === "SAME_USE" ? { ...pair, rightUseRef: "use-1" } : pair
          ),
        },
      }).checks.retryRecognition.status
    ).toBe("FAIL");
  });
  it("compares recovered receipts with ledger originals and measures every receipt separately", () => {
    const evidence = complete();
    expect(
      calculateInvariants({
        ...evidence,
        receiptRecoveries: evidence.receiptRecoveries?.slice(0, 1) ?? null,
      }).checks.allReceiptsStable.status
    ).toBe("NOT_RUN");
    const changed =
      evidence.receiptRecoveries?.map((item) => ({
        ...item,
        recovered: { ...item.recovered, receiptId: "changed" },
      })) ?? null;
    expect(
      calculateInvariants({ ...evidence, receiptRecoveries: changed }).checks.recoverability.status
    ).toBe("FAIL");
    expect(
      calculateInvariants({ ...evidence, receiptRecoveries: changed }).checks.allReceiptsStable
        .status
    ).toBe("FAIL");
  });
  it("rejects receipts owned by another use and duplicate receipt identifiers", () => {
    const evidence = complete();
    const wrongUse = evidence.uses?.map((use, index) =>
      index === 0 && use.status === "SUCCEEDED"
        ? { ...use, receipt: { ...use.receipt, useId: "wrong-use" } }
        : use
    );
    const wrongRecovery = evidence.receiptRecoveries?.map((item, index) =>
      index === 0
        ? {
            ...item,
            original: { ...item.original, useId: "wrong-use" },
            recovered: { ...item.recovered, useId: "wrong-use" },
          }
        : item
    );
    const wrongUseReport = calculateInvariants({
      ...evidence,
      uses: wrongUse ?? null,
      receiptRecoveries: wrongRecovery ?? null,
    });
    expect(wrongUseReport.checks.recoverability.status).toBe("FAIL");
    expect(wrongUseReport.checks.allReceiptsStable.status).toBe("FAIL");

    const duplicateReceiptId = "receipt-duplicate";
    const duplicateUses = evidence.uses?.map((use, index) =>
      index < 2 && use.status === "SUCCEEDED"
        ? { ...use, receipt: { ...use.receipt, receiptId: duplicateReceiptId } }
        : use
    );
    const duplicateRecoveries = evidence.receiptRecoveries?.map((item, index) =>
      index < 2
        ? {
            ...item,
            original: { ...item.original, receiptId: duplicateReceiptId },
            recovered: { ...item.recovered, receiptId: duplicateReceiptId },
          }
        : item
    );
    const duplicateReport = calculateInvariants({
      ...evidence,
      uses: duplicateUses ?? null,
      receiptRecoveries: duplicateRecoveries ?? null,
    });
    expect(duplicateReport.checks.recoverability.status).toBe("FAIL");
    expect(duplicateReport.checks.allReceiptsStable.status).toBe("FAIL");
  });
  it("propagates known failure above missing observations and rejects invalid numeric evidence", () => {
    expect(
      calculateInvariants({
        ...unmeasured,
        privacy: { storedHolderIdentities: 1, credentialWideIdentifiersStored: 0 },
      }).overall
    ).toBe("FAIL");
    for (const declaredLimit of [0, -1, Number.NaN, Infinity, 1.5])
      expect(() => calculateInvariants({ ...unmeasured, declaredLimit })).toThrow(
        "INVALID_EVIDENCE"
      );
    expect(() =>
      calculateInvariants({
        ...unmeasured,
        privacy: { storedHolderIdentities: -1, credentialWideIdentifiersStored: 0 },
      })
    ).toThrow("INVALID_EVIDENCE");
  });
});
