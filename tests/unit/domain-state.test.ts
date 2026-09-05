import { describe, expect, it } from "vitest";
import {
  USE_STATES,
  canTransitionUse,
  assertUseTransition,
  classifyRetry,
  settleUse,
  type AcceptedUse,
  type Receipt,
  type TransitionCause,
} from "@anonlimit/domain";
const identity = {
  demoRunId: "run",
  scopeHash: "scope",
  nullifierKey: "nf",
  operationId: "op",
  intentDigest: "intent",
};
const pending: AcceptedUse = { ...identity, useId: "use-1", status: "ACCEPTED_PENDING_ACTION" };
const receipt: Receipt = {
  receiptId: "receipt-1",
  useId: "use-1",
  actionKey: "action-1",
  status: "COMMITTED",
  committedAt: "2026-09-05T00:00:00.000Z",
};
const succeeded: AcceptedUse = { ...pending, status: "SUCCEEDED", receipt };
const failed: AcceptedUse = {
  ...pending,
  status: "FAILED_FINAL",
  failureCode: "ACTION_FAILED_FINAL",
};
describe("exhaustive use transitions", () => {
  const allowed = new Set([
    "UNSEEN/REJECTED/REJECT",
    "UNSEEN/ACCEPTED_PENDING_ACTION/ACCEPT",
    "ACCEPTED_PENDING_ACTION/ACCEPTED_PENDING_ACTION/EXACT_RETRY",
    "ACCEPTED_PENDING_ACTION/ACCEPTED_PENDING_ACTION/RECOVER",
    "ACCEPTED_PENDING_ACTION/SUCCEEDED/ACTION_SUCCEEDED",
    "ACCEPTED_PENDING_ACTION/FAILED_FINAL/ACTION_FAILED",
    "SUCCEEDED/SUCCEEDED/EXACT_RETRY",
    "FAILED_FINAL/FAILED_FINAL/EXACT_RETRY",
  ]);
  const causes: readonly TransitionCause[] = [
    "ACCEPT",
    "REJECT",
    "EXACT_RETRY",
    "RECOVER",
    "ACTION_SUCCEEDED",
    "ACTION_FAILED",
  ];
  for (const from of USE_STATES)
    for (const to of USE_STATES)
      for (const cause of causes)
        it(`${from} -> ${to} on ${cause}`, () => {
          const expected = allowed.has(`${from}/${to}/${cause}`);
          expect(canTransitionUse(from, to, cause)).toBe(expected);
          if (expected) expect(() => assertUseTransition(from, to, cause)).not.toThrow();
          else
            expect(() => assertUseTransition(from, to, cause)).toThrow("INVALID_STATE_TRANSITION");
        });
});
describe("accepted intent and exact retries", () => {
  it("classifies unseen work without claiming it is already accepted", () => {
    expect(classifyRetry(identity, { byNullifier: null, byOperation: null })).toEqual({
      kind: "NEW",
      usageDelta: 0,
      actionDelta: 0,
    });
  });
  it.each([pending, succeeded, failed])(
    "recovers $status through either lookup or both without consumption",
    (record) => {
      for (const existing of [
        { byNullifier: record, byOperation: null },
        { byNullifier: null, byOperation: record },
        { byNullifier: record, byOperation: { ...record } },
      ]) {
        const decision = classifyRetry(identity, existing);
        expect(decision).toMatchObject({
          kind: "RETRY",
          useId: record.useId,
          status: record.status,
          usageDelta: 0,
          actionDelta: 0,
          replayed: true,
        });
        if (record.status === "SUCCEEDED") expect(decision).toHaveProperty("receipt", receipt);
        if (record.status === "FAILED_FINAL")
          expect(decision).toHaveProperty("failureCode", "ACTION_FAILED_FINAL");
      }
    }
  );
  it.each(["intentDigest", "operationId"] as const)(
    "rejects nullifier reuse after changing %s",
    (key) => {
      expect(
        classifyRetry(
          { ...identity, [key]: "changed" },
          { byNullifier: succeeded, byOperation: null }
        )
      ).toMatchObject({
        kind: "CONFLICT",
        code: "NULLIFIER_REUSE_CONFLICT",
        usageDelta: 0,
        actionDelta: 0,
      });
      expect(succeeded.receipt).toEqual(receipt);
    }
  );
  it.each(["intentDigest", "nullifierKey"] as const)(
    "rejects idempotency reuse after changing %s",
    (key) => {
      expect(
        classifyRetry({ ...identity, [key]: "changed" }, { byNullifier: null, byOperation: failed })
      ).toMatchObject({
        kind: "CONFLICT",
        code: "IDEMPOTENCY_CONFLICT",
        usageDelta: 0,
        actionDelta: 0,
      });
    }
  );
  it("rejects incorrect lookup scope/run and inconsistent winners", () => {
    for (const key of ["demoRunId", "scopeHash"] as const)
      expect(() =>
        classifyRetry(identity, { byNullifier: { ...pending, [key]: "other" }, byOperation: null })
      ).toThrow("LEDGER_INCONSISTENT");
    expect(() =>
      classifyRetry(identity, {
        byNullifier: { ...pending, nullifierKey: "other" },
        byOperation: null,
      })
    ).toThrow("LEDGER_INCONSISTENT");
    expect(() =>
      classifyRetry(identity, {
        byNullifier: pending,
        byOperation: { ...pending, useId: "different-row" },
      })
    ).toThrow("LEDGER_INCONSISTENT");
    expect(() => classifyRetry(identity, { byNullifier: succeeded, byOperation: pending })).toThrow(
      "LEDGER_INCONSISTENT"
    );
  });
  it("preserves terminal results and freezes returned receipt copies", () => {
    const settled = settleUse(pending, { status: "SUCCEEDED", receipt });
    expect(settled).toEqual(succeeded);
    expect(settleUse(settled, { status: "SUCCEEDED", receipt: { ...receipt } })).toEqual(succeeded);
    expect(Object.isFrozen(settled)).toBe(true);
    if (settled.status === "SUCCEEDED") expect(Object.isFrozen(settled.receipt)).toBe(true);
    expect(() =>
      settleUse(succeeded, { status: "SUCCEEDED", receipt: { ...receipt, receiptId: "changed" } })
    ).toThrow("INVALID_STATE_TRANSITION");
    expect(() =>
      settleUse(succeeded, { status: "FAILED_FINAL", failureCode: "ACTION_FAILED_FINAL" })
    ).toThrow("INVALID_STATE_TRANSITION");
    expect(() => settleUse(failed, { status: "SUCCEEDED", receipt })).toThrow(
      "INVALID_STATE_TRANSITION"
    );
    expect(() =>
      settleUse(pending, { status: "SUCCEEDED", receipt: { ...receipt, useId: "different" } })
    ).toThrow("LEDGER_INCONSISTENT");
  });
});
