import { canonicalJson } from "./canonical-json.js";
import { DomainError } from "./errors.js";
import { assertUseTransition } from "./use-state.js";
export interface UseIdentity {
  readonly demoRunId: string;
  readonly scopeHash: string;
  readonly nullifierKey: string;
  readonly operationId: string;
  readonly intentDigest: string;
}
export interface Receipt {
  readonly receiptId: string;
  readonly useId: string;
  readonly actionKey: string;
  readonly status: "COMMITTED";
  readonly committedAt: string;
}
export type ActionFailureCode = "ACTION_FAILED_FINAL" | "ACTION_INTEGRITY_CONFLICT";
export type TerminalResult =
  | { readonly status: "SUCCEEDED"; readonly receipt: Receipt }
  | { readonly status: "FAILED_FINAL"; readonly failureCode: ActionFailureCode };
export type AcceptedUse = UseIdentity & { readonly useId: string } & (
    { readonly status: "ACCEPTED_PENDING_ACTION" } | TerminalResult
  );
export type RetryDecision =
  | { readonly kind: "NEW"; readonly usageDelta: 0; readonly actionDelta: 0 }
  | {
      readonly kind: "CONFLICT";
      readonly code: "NULLIFIER_REUSE_CONFLICT" | "IDEMPOTENCY_CONFLICT";
      readonly usageDelta: 0;
      readonly actionDelta: 0;
    }
  | ({
      readonly kind: "RETRY";
      readonly replayed: true;
      readonly useId: string;
      readonly usageDelta: 0;
      readonly actionDelta: 0;
    } & (
      | { readonly status: "ACCEPTED_PENDING_ACTION"; readonly code: "RETRY_IN_PROGRESS" }
      | { readonly status: "SUCCEEDED"; readonly code: "RETRY_RESOLVED"; readonly receipt: Receipt }
      | {
          readonly status: "FAILED_FINAL";
          readonly code: "RETRY_RESOLVED";
          readonly failureCode: ActionFailureCode;
        }
    ));
function sameIdentity(left: UseIdentity, right: UseIdentity): boolean {
  return (
    left.demoRunId === right.demoRunId &&
    left.scopeHash === right.scopeHash &&
    left.nullifierKey === right.nullifierKey &&
    left.operationId === right.operationId &&
    left.intentDigest === right.intentDigest
  );
}
/** Called before new-acceptance freshness checks. Lookups must use the server's active run and scope. */
export function classifyRetry(
  incoming: UseIdentity,
  existing: { readonly byNullifier: AcceptedUse | null; readonly byOperation: AcceptedUse | null }
): RetryDecision {
  const { byNullifier, byOperation } = existing;
  for (const record of [byNullifier, byOperation]) {
    if (
      record &&
      (record.demoRunId !== incoming.demoRunId || record.scopeHash !== incoming.scopeHash)
    )
      throw new DomainError("LEDGER_INCONSISTENT");
  }
  if (
    (byNullifier && byNullifier.nullifierKey !== incoming.nullifierKey) ||
    (byOperation && byOperation.operationId !== incoming.operationId)
  )
    throw new DomainError("LEDGER_INCONSISTENT");
  if (byNullifier && !sameIdentity(byNullifier, incoming))
    return { kind: "CONFLICT", code: "NULLIFIER_REUSE_CONFLICT", usageDelta: 0, actionDelta: 0 };
  if (byOperation && !sameIdentity(byOperation, incoming))
    return { kind: "CONFLICT", code: "IDEMPOTENCY_CONFLICT", usageDelta: 0, actionDelta: 0 };
  if (byNullifier && byOperation && canonicalJson(byNullifier) !== canonicalJson(byOperation))
    throw new DomainError("LEDGER_INCONSISTENT");
  const record = byNullifier ?? byOperation;
  if (!record) return { kind: "NEW", usageDelta: 0, actionDelta: 0 };
  const base = {
    kind: "RETRY",
    useId: record.useId,
    replayed: true,
    usageDelta: 0,
    actionDelta: 0,
  } as const;
  switch (record.status) {
    case "ACCEPTED_PENDING_ACTION":
      return { ...base, status: record.status, code: "RETRY_IN_PROGRESS" };
    case "SUCCEEDED":
      if (record.receipt.useId !== record.useId) throw new DomainError("LEDGER_INCONSISTENT");
      return {
        ...base,
        status: record.status,
        code: "RETRY_RESOLVED",
        receipt: Object.freeze({ ...record.receipt }),
      };
    case "FAILED_FINAL":
      return {
        ...base,
        status: record.status,
        code: "RETRY_RESOLVED",
        failureCode: record.failureCode,
      };
  }
  throw new DomainError("LEDGER_INCONSISTENT");
}
/** Terminal data can be replayed exactly but can never be replaced. */
export function settleUse(record: AcceptedUse, result: TerminalResult): AcceptedUse {
  if (result.status === "SUCCEEDED" && result.receipt.useId !== record.useId)
    throw new DomainError("LEDGER_INCONSISTENT");
  if (record.status !== "ACCEPTED_PENDING_ACTION") {
    const prior: TerminalResult =
      record.status === "SUCCEEDED"
        ? { status: record.status, receipt: record.receipt }
        : { status: record.status, failureCode: record.failureCode };
    if (canonicalJson(prior) !== canonicalJson(result))
      throw new DomainError("INVALID_STATE_TRANSITION");
    assertUseTransition(record.status, result.status, "EXACT_RETRY");
  } else {
    assertUseTransition(
      record.status,
      result.status,
      result.status === "SUCCEEDED" ? "ACTION_SUCCEEDED" : "ACTION_FAILED"
    );
  }
  return Object.freeze(
    result.status === "SUCCEEDED"
      ? { ...record, ...result, receipt: Object.freeze({ ...result.receipt }) }
      : { ...record, ...result }
  );
}
