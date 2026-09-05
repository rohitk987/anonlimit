import { canonicalJson } from "./canonical-json.js";
import { DomainError } from "./errors.js";
import { type AcceptedUse, type Receipt } from "./retry-classifier.js";

export type CheckStatus = "PASS" | "FAIL" | "NOT_RUN" | "INCOMPLETE";
export interface CheckResult {
  readonly status: CheckStatus;
}
export interface MutationSnapshot {
  readonly uses: number;
  readonly outboxEvents: number;
  readonly externalActions: number;
  readonly receipts: number;
}
export type MutationObservation =
  | { readonly before: MutationSnapshot; readonly after: MutationSnapshot }
  /** Deltas from a request trace, reconciled against the durable ledgers by its adapter. */
  | { readonly delta: MutationSnapshot };
export interface LinkabilityPair {
  readonly leftUseRef: string;
  readonly rightUseRef: string;
  readonly expected: "UNLINKABLE" | "SAME_USE";
  readonly result: "UNLINKABLE" | "SAME_USE";
}
/** Internal observations must come from authoritative adapters, never wallet/UI counters. */
export interface EvidenceObservations {
  readonly declaredLimit: number;
  /** Exactly one issued credential is required for the bounded demo's aggregate check. */
  readonly credentialIssuances: number | null;
  readonly uses: readonly AcceptedUse[] | null;
  readonly outboxUseIds: readonly string[] | null;
  readonly actions: readonly { readonly useId: string; readonly actionKey: string }[] | null;
  readonly retries: readonly MutationObservation[] | null;
  readonly rejectedAttempts:
    | readonly (MutationObservation & {
        readonly kind: "INVALID" | "OVER_LIMIT";
        readonly rejected: boolean;
      })[]
    | null;
  readonly privacy: {
    readonly storedHolderIdentities: number;
    readonly credentialWideIdentifiersStored: number;
  } | null;
  readonly receiptRecoveries:
    | readonly { readonly useId: string; readonly original: Receipt; readonly recovered: Receipt }[]
    | null;
  /** Pairwise output comes from the opaque audit adapter; nullifier inequality is not evidence. */
  /** References here are authoritative use IDs; a transport adapter masks them for display. */
  readonly linkability: {
    readonly distinctUseRefs: readonly string[];
    readonly pairs: readonly LinkabilityPair[];
  } | null;
  /** Set when the opaque audit adapter is unavailable; this is never treated as a pass. */
  readonly linkabilityUnavailable?: boolean;
  /** Missing event/ledger coverage cannot establish that an attempt had zero effects. */
  readonly mutationEvidenceUnavailable?: boolean;
}
function check(value: boolean | null): CheckResult {
  return { status: value === null ? "NOT_RUN" : value ? "PASS" : "FAIL" };
}
function count(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new DomainError("INVALID_EVIDENCE");
}
function snapshots(observations: readonly MutationObservation[] | null): void {
  for (const observation of observations ?? [])
    for (const snapshot of "delta" in observation
      ? [observation.delta]
      : [observation.before, observation.after])
      for (const value of Object.values(snapshot)) count(value);
}
function unchanged(observation: MutationObservation): boolean {
  return "delta" in observation
    ? Object.values(observation.delta).every((value) => value === 0)
    : canonicalJson(observation.before) === canonicalJson(observation.after);
}
function extra(
  observations: readonly MutationObservation[] | null,
  key: keyof MutationSnapshot
): number | null {
  return observations?.length
    ? observations.reduce(
        (total, observation) =>
          total +
          ("delta" in observation
            ? observation.delta[key]
            : Math.max(0, observation.after[key] - observation.before[key])),
        0
      )
    : null;
}
function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}
function allPairs(linkability: NonNullable<EvidenceObservations["linkability"]>): boolean | null {
  const refs = linkability.distinctUseRefs;
  if (refs.length < 2) return null;
  if (!unique(refs)) return false;
  const expectedPairs = new Set<string>();
  for (let left = 0; left < refs.length; left++)
    for (let right = left + 1; right < refs.length; right++) {
      expectedPairs.add(canonicalJson([refs[left], refs[right]].sort()));
    }
  const observed = new Set<string>();
  for (const pair of linkability.pairs.filter((pair) => pair.expected === "UNLINKABLE")) {
    const pairKey = canonicalJson([pair.leftUseRef, pair.rightUseRef].sort());
    if (!expectedPairs.has(pairKey) || observed.has(pairKey) || pair.result !== "UNLINKABLE")
      return false;
    observed.add(pairKey);
  }
  return observed.size === expectedPairs.size ? true : null;
}

/** This calculates measured demo invariants; it does not certify cryptographic anonymity. */
export function calculateInvariants(observations: EvidenceObservations) {
  count(observations.declaredLimit);
  if (observations.declaredLimit < 1) throw new DomainError("INVALID_EVIDENCE");
  if (observations.credentialIssuances !== null) count(observations.credentialIssuances);
  if (observations.privacy) for (const value of Object.values(observations.privacy)) count(value);
  snapshots(observations.retries);
  snapshots(observations.rejectedAttempts);
  const {
    uses,
    actions,
    outboxUseIds,
    retries,
    rejectedAttempts,
    privacy,
    receiptRecoveries,
    linkability,
  } = observations;
  const oneScope = uses
    ? new Set(uses.map((use) => canonicalJson([use.demoRunId, use.scopeHash]))).size === 1
    : false;
  const bounded =
    uses && oneScope && observations.credentialIssuances === 1
      ? uses.length > observations.declaredLimit
        ? false
        : uses.length === observations.declaredLimit
          ? true
          : null
      : null;
  const single = uses?.length
    ? unique(uses.map((use) => use.useId)) &&
      unique(uses.map((use) => canonicalJson([use.demoRunId, use.scopeHash, use.nullifierKey]))) &&
      unique(uses.map((use) => canonicalJson([use.demoRunId, use.scopeHash, use.operationId])))
    : null;
  const completeOutbox =
    uses?.length && outboxUseIds
      ? outboxUseIds.length === uses.length &&
        unique(outboxUseIds) &&
        outboxUseIds.every((id) => uses.some((use) => use.useId === id))
      : null;
  let external: boolean | null = null;
  if (uses?.length && actions) {
    if (
      !unique(actions.map((action) => action.actionKey)) ||
      !unique(actions.map((action) => action.useId)) ||
      actions.some((action) => !uses.some((use) => use.useId === action.useId))
    )
      external = false;
    else if (uses.every((use) => use.status !== "ACCEPTED_PENDING_ACTION"))
      external = uses.every((use) =>
        use.status === "SUCCEEDED"
          ? actions.some(
              (action) => action.useId === use.useId && action.actionKey === use.receipt.actionKey
            )
          : !actions.some((action) => action.useId === use.useId)
      );
  }
  const succeededUses = uses?.filter((use) => use.status === "SUCCEEDED") ?? null;
  const ledgerReceiptsValid = succeededUses
    ? succeededUses.every((use) => use.receipt.useId === use.useId) &&
      unique(succeededUses.map((use) => use.receipt.receiptId))
    : null;
  const recovery =
    uses?.length && receiptRecoveries?.length
      ? ledgerReceiptsValid === true &&
        unique(receiptRecoveries.map((item) => item.useId)) &&
        receiptRecoveries.every((item) => {
          const use = uses.find((entry) => entry.useId === item.useId);
          return (
            use?.status === "SUCCEEDED" &&
            item.original.useId === item.useId &&
            item.recovered.useId === item.useId &&
            canonicalJson(use.receipt) === canonicalJson(item.original) &&
            canonicalJson(item.original) === canonicalJson(item.recovered)
          );
        })
      : null;
  const allStable =
    recovery === false
      ? false
      : recovery === true && uses && receiptRecoveries
        ? uses.every(
            (use) =>
              use.status !== "SUCCEEDED" ||
              receiptRecoveries.some((item) => item.useId === use.useId)
          )
          ? true
          : null
        : null;
  const overLimit = rejectedAttempts?.filter((attempt) => attempt.kind === "OVER_LIMIT") ?? [];
  const repeatPairs = linkability?.pairs.filter((pair) => pair.expected === "SAME_USE") ?? [];
  const auditBound =
    uses && linkability
      ? unique(linkability.distinctUseRefs) &&
        linkability.distinctUseRefs.length === uses.length &&
        linkability.distinctUseRefs.every((ref) => uses.some((use) => use.useId === ref))
      : null;
  const checks = {
    boundedUse: check(bounded),
    singleAcceptance: check(
      single === false || completeOutbox === false
        ? false
        : single === true && completeOutbox === true
          ? true
          : null
    ),
    retryIdempotency: observations.mutationEvidenceUnavailable
      ? { status: "INCOMPLETE" }
      : check(retries?.length ? retries.every(unchanged) : null),
    noFailedVerificationConsumption: observations.mutationEvidenceUnavailable
      ? { status: "INCOMPLETE" }
      : check(
          rejectedAttempts?.length
            ? rejectedAttempts.every((attempt) => attempt.rejected && unchanged(attempt))
            : null
        ),
    singleExternalEffect: check(external),
    recoverability: check(recovery),
    noStableIdentity: check(
      privacy
        ? privacy.storedHolderIdentities === 0 && privacy.credentialWideIdentifiersStored === 0
        : null
    ),
    distinctUseUnlinkability: observations.linkabilityUnavailable
      ? { status: "INCOMPLETE" }
      : check(
          auditBound === false ? false : auditBound && linkability ? allPairs(linkability) : null
        ),
    retryRecognition: check(
      repeatPairs.length
        ? auditBound === null
          ? null
          : auditBound &&
            repeatPairs.every(
              (pair) =>
                pair.leftUseRef === pair.rightUseRef &&
                linkability?.distinctUseRefs.includes(pair.leftUseRef) &&
                pair.result === "SAME_USE"
            )
        : null
    ),
    overLimitRejected: observations.mutationEvidenceUnavailable
      ? { status: "INCOMPLETE" }
      : check(
          overLimit.length
            ? overLimit.every((attempt) => attempt.rejected && unchanged(attempt))
            : null
        ),
    allReceiptsStable: check(allStable),
  };
  const statuses = Object.values(checks).map((value) => value.status);
  const overall: CheckStatus = statuses.includes("FAIL")
    ? "FAIL"
    : statuses.includes("INCOMPLETE")
      ? "INCOMPLETE"
      : statuses.every((status) => status === "PASS")
        ? "PASS"
        : "NOT_RUN";
  return {
    declaredLimit: observations.declaredLimit,
    counts: {
      committedUses: uses?.length ?? null,
      outboxEvents: outboxUseIds?.length ?? null,
      externalActions: actions?.length ?? null,
      retryUsageDelta: extra(retries, "uses"),
      retryActionDelta: extra(retries, "externalActions"),
      failedAttemptUses: extra(rejectedAttempts, "uses"),
      credentialWideIdentifiersStored: privacy?.credentialWideIdentifiersStored ?? null,
      storedHolderIdentities: privacy?.storedHolderIdentities ?? null,
      linkedDistinctLegitimateUsePairs: linkability
        ? linkability.pairs.filter(
            (pair) => pair.expected === "UNLINKABLE" && pair.result === "SAME_USE"
          ).length
        : null,
    },
    checks,
    overall,
  };
}
