/**
 * Backend counts used by the reusable P0 scenario. Implementations must read these values from
 * verifier and Action Simulator state; browser counters are not authoritative.
 */
export interface GoldenBackendSnapshot {
  readonly demoRunId: string;
  readonly acceptedUses: number;
  readonly outboxEvents: number;
  readonly committedActions: number;
  readonly distinctReceipts: number;
  readonly consumedChallenges: number;
  readonly receipts: readonly GoldenReceiptReference[];
}

export interface GoldenReceiptReference {
  readonly useId: string;
  readonly receiptId: string;
}

export interface GoldenPolicyReference {
  readonly id: string;
  readonly version: number;
  readonly maxUses: number;
}

export interface GoldenResetResult {
  readonly demoRunId: string;
  readonly policy: GoldenPolicyReference;
}

export interface GoldenPreparedPresentation<TPresentation> {
  readonly operationId: string;
  readonly value: TPresentation;
}

export interface GoldenCompletedUse {
  readonly useId: string;
  readonly receiptId: string;
}

export interface GoldenRetryResult extends GoldenCompletedUse {
  readonly code: "RETRY_RESOLVED";
  readonly replayed: true;
  readonly usageDelta: 0;
  readonly actionDelta: 0;
}

export interface GoldenRejection {
  readonly code: "PRESENTATION_REJECTED";
  readonly usageDelta: 0;
  readonly actionDelta: 0;
}

export type GoldenCheckpointName =
  | "RESET"
  | "POLICY_LOADED"
  | "CREDENTIAL_ISSUED"
  | "SLOT_0_SUCCEEDED"
  | "DROP_ACK_ARMED"
  | "SLOT_1_ACCEPTED"
  | "SLOT_1_OUTCOME_UNKNOWN"
  | "SLOT_1_RETRY_RESOLVED"
  | "SLOT_2_SUCCEEDED"
  | "SLOT_3_REJECTED";

export interface GoldenCheckpoint {
  readonly name: GoldenCheckpointName;
  readonly snapshot: GoldenBackendSnapshot;
}

/**
 * Transport/runtime adapter for the scenario. A live adapter may poll the worker while an
 * integration adapter may drive one outbox delivery directly.
 */
export interface GoldenScenarioDriver<TCredential, TPresentation> {
  reset(): Promise<GoldenResetResult>;
  loadPolicy(policy: GoldenPolicyReference): Promise<GoldenPolicyReference>;
  issue(policy: GoldenPolicyReference): Promise<TCredential>;
  prepareAllowedUse(input: {
    readonly credential: TCredential;
    readonly policy: GoldenPolicyReference;
    readonly hiddenSlot: 0 | 1 | 2;
  }): Promise<GoldenPreparedPresentation<TPresentation>>;
  prepareOutOfRangeUse(input: {
    readonly policy: GoldenPolicyReference;
    readonly hiddenSlot: 3;
  }): Promise<GoldenPreparedPresentation<TPresentation>>;
  submitAndComplete(
    presentation: GoldenPreparedPresentation<TPresentation>
  ): Promise<GoldenCompletedUse>;
  armDropNextAcknowledgement(operationId: string): Promise<void>;
  /**
   * Submit a presentation whose acknowledgement will be dropped after durable completion.
   * The callback runs after acceptance is durable and before the external action is delivered.
   */
  submitWithLostAcknowledgement(
    presentation: GoldenPreparedPresentation<TPresentation>,
    onAccepted: () => Promise<void>
  ): Promise<"OUTCOME_UNKNOWN">;
  retryExact(presentation: GoldenPreparedPresentation<TPresentation>): Promise<GoldenRetryResult>;
  submitOutOfRange(
    presentation: GoldenPreparedPresentation<TPresentation>
  ): Promise<GoldenRejection>;
  snapshot(): Promise<GoldenBackendSnapshot>;
}

export interface GoldenInvariantReport {
  readonly declaredLimit: 3;
  readonly acceptedDistinctUses: 3;
  readonly committedExternalActions: 3;
  readonly extraUsesFromRetry: 0;
  readonly extraActionsFromRetry: 0;
  readonly overLimitMutations: 0;
  readonly allReceiptsStable: true;
}

export interface GoldenScenarioReport {
  readonly demoRunId: string;
  readonly policy: GoldenPolicyReference & { readonly maxUses: 3 };
  readonly uses: readonly [GoldenCompletedUse, GoldenRetryResult, GoldenCompletedUse];
  readonly checkpoints: readonly GoldenCheckpoint[];
  readonly invariants: GoldenInvariantReport;
}

export class GoldenScenarioAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoldenScenarioAssertionError";
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new GoldenScenarioAssertionError(message);
}

function receiptMap(snapshot: GoldenBackendSnapshot): ReadonlyMap<string, string> {
  const output = new Map<string, string>();
  for (const receipt of snapshot.receipts) {
    assert(!output.has(receipt.useId), `duplicate receipt evidence for use ${receipt.useId}`);
    output.set(receipt.useId, receipt.receiptId);
  }
  assert(
    output.size === snapshot.distinctReceipts,
    `receipt evidence count ${output.size} does not match distinctReceipts ${snapshot.distinctReceipts}`
  );
  return output;
}

function assertSameReceipts(
  actual: GoldenBackendSnapshot,
  expected: GoldenBackendSnapshot,
  checkpoint: GoldenCheckpointName
): void {
  const actualReceipts = receiptMap(actual);
  const expectedReceipts = receiptMap(expected);
  assert(
    actualReceipts.size === expectedReceipts.size,
    `${checkpoint}: receipt evidence size changed`
  );
  for (const [useId, receiptId] of expectedReceipts) {
    assert(
      actualReceipts.get(useId) === receiptId,
      `${checkpoint}: receipt changed for use ${useId}`
    );
  }
}

function assertReceiptsPreserved(
  actual: GoldenBackendSnapshot,
  previous: GoldenBackendSnapshot,
  checkpoint: GoldenCheckpointName
): void {
  const actualReceipts = receiptMap(actual);
  for (const [useId, receiptId] of receiptMap(previous)) {
    assert(
      actualReceipts.get(useId) === receiptId,
      `${checkpoint}: prior receipt changed for use ${useId}`
    );
  }
}

function assertSnapshot(
  snapshot: GoldenBackendSnapshot,
  expected: {
    readonly demoRunId: string;
    readonly acceptedUses: number;
    readonly outboxEvents: number;
    readonly committedActions: number;
    readonly distinctReceipts: number;
    readonly consumedChallenges: number;
  },
  checkpoint: GoldenCheckpointName
): void {
  for (const key of [
    "acceptedUses",
    "outboxEvents",
    "committedActions",
    "distinctReceipts",
    "consumedChallenges",
  ] as const) {
    assert(
      snapshot[key] === expected[key],
      `${checkpoint}: expected ${key}=${expected[key]}, received ${snapshot[key]}`
    );
  }
  assert(
    snapshot.demoRunId === expected.demoRunId,
    `${checkpoint}: backend evidence belongs to a different demo run`
  );
  receiptMap(snapshot);
}

function mutationDistance(before: GoldenBackendSnapshot, after: GoldenBackendSnapshot): number {
  return (
    Math.abs(after.acceptedUses - before.acceptedUses) +
    Math.abs(after.outboxEvents - before.outboxEvents) +
    Math.abs(after.committedActions - before.committedActions) +
    Math.abs(after.distinctReceipts - before.distinctReceipts) +
    Math.abs(after.consumedChallenges - before.consumedChallenges)
  );
}

/** Run the complete Phase 6 P0 flow and fail at the first backend invariant violation. */
export async function runGoldenScenario<TCredential, TPresentation>(
  driver: GoldenScenarioDriver<TCredential, TPresentation>
): Promise<GoldenScenarioReport> {
  const checkpoints: GoldenCheckpoint[] = [];
  const record = async (
    name: GoldenCheckpointName,
    expected: Omit<Parameters<typeof assertSnapshot>[1], "demoRunId">,
    demoRunId: string
  ): Promise<GoldenBackendSnapshot> => {
    const snapshot = await driver.snapshot();
    assertSnapshot(snapshot, { ...expected, demoRunId }, name);
    checkpoints.push({ name, snapshot });
    return snapshot;
  };

  const reset = await driver.reset();
  const demoRunId = reset.demoRunId;
  const zero = {
    acceptedUses: 0,
    outboxEvents: 0,
    committedActions: 0,
    distinctReceipts: 0,
    consumedChallenges: 0,
  } as const;
  await record("RESET", zero, demoRunId);

  const policy = await driver.loadPolicy(reset.policy);
  assert(policy.id === reset.policy.id, "POLICY_LOADED: reset and loaded policy IDs differ");
  assert(
    policy.version === reset.policy.version,
    "POLICY_LOADED: reset and loaded policy versions differ"
  );
  assert(policy.maxUses === 3, `POLICY_LOADED: expected maxUses=3, received ${policy.maxUses}`);
  await record("POLICY_LOADED", zero, demoRunId);

  const credential = await driver.issue(policy);
  await record("CREDENTIAL_ISSUED", zero, demoRunId);

  const slot0Presentation = await driver.prepareAllowedUse({
    credential,
    policy,
    hiddenSlot: 0,
  });
  const slot0 = await driver.submitAndComplete(slot0Presentation);
  const slot0Snapshot = await record(
    "SLOT_0_SUCCEEDED",
    {
      acceptedUses: 1,
      outboxEvents: 1,
      committedActions: 1,
      distinctReceipts: 1,
      consumedChallenges: 1,
    },
    demoRunId
  );
  assert(
    receiptMap(slot0Snapshot).get(slot0.useId) === slot0.receiptId,
    "SLOT_0_SUCCEEDED: returned receipt differs from backend evidence"
  );

  const slot1Presentation = await driver.prepareAllowedUse({
    credential,
    policy,
    hiddenSlot: 1,
  });
  await driver.armDropNextAcknowledgement(slot1Presentation.operationId);
  await record(
    "DROP_ACK_ARMED",
    {
      acceptedUses: 1,
      outboxEvents: 1,
      committedActions: 1,
      distinctReceipts: 1,
      consumedChallenges: 1,
    },
    demoRunId
  );

  const lostOutcome = await driver.submitWithLostAcknowledgement(slot1Presentation, async () => {
    await record(
      "SLOT_1_ACCEPTED",
      {
        acceptedUses: 2,
        outboxEvents: 2,
        committedActions: 1,
        distinctReceipts: 1,
        consumedChallenges: 2,
      },
      demoRunId
    );
  });
  assert(lostOutcome === "OUTCOME_UNKNOWN", "SLOT_1_OUTCOME_UNKNOWN: acknowledgement was not lost");
  const unknownSnapshot = await record(
    "SLOT_1_OUTCOME_UNKNOWN",
    {
      acceptedUses: 2,
      outboxEvents: 2,
      committedActions: 2,
      distinctReceipts: 2,
      consumedChallenges: 2,
    },
    demoRunId
  );
  assertReceiptsPreserved(unknownSnapshot, slot0Snapshot, "SLOT_1_OUTCOME_UNKNOWN");

  const retryBefore = unknownSnapshot;
  const slot1 = await driver.retryExact(slot1Presentation);
  assert(slot1.code === "RETRY_RESOLVED", "SLOT_1_RETRY_RESOLVED: retry did not resolve");
  assert(slot1.replayed, "SLOT_1_RETRY_RESOLVED: retry was not marked replayed");
  assert(slot1.usageDelta === 0, "SLOT_1_RETRY_RESOLVED: retry consumed another use");
  assert(slot1.actionDelta === 0, "SLOT_1_RETRY_RESOLVED: retry duplicated the action");
  const retryAfter = await record(
    "SLOT_1_RETRY_RESOLVED",
    {
      acceptedUses: 2,
      outboxEvents: 2,
      committedActions: 2,
      distinctReceipts: 2,
      consumedChallenges: 2,
    },
    demoRunId
  );
  assertSameReceipts(retryAfter, retryBefore, "SLOT_1_RETRY_RESOLVED");
  assert(
    receiptMap(retryAfter).get(slot1.useId) === slot1.receiptId,
    "SLOT_1_RETRY_RESOLVED: recovered receipt differs from backend evidence"
  );

  const slot2Presentation = await driver.prepareAllowedUse({
    credential,
    policy,
    hiddenSlot: 2,
  });
  const slot2 = await driver.submitAndComplete(slot2Presentation);
  const slot2Snapshot = await record(
    "SLOT_2_SUCCEEDED",
    {
      acceptedUses: 3,
      outboxEvents: 3,
      committedActions: 3,
      distinctReceipts: 3,
      consumedChallenges: 3,
    },
    demoRunId
  );
  assertReceiptsPreserved(slot2Snapshot, retryAfter, "SLOT_2_SUCCEEDED");
  assert(
    receiptMap(slot2Snapshot).get(slot2.useId) === slot2.receiptId,
    "SLOT_2_SUCCEEDED: returned receipt differs from backend evidence"
  );

  const slot3Presentation = await driver.prepareOutOfRangeUse({ policy, hiddenSlot: 3 });
  const beforeOverLimit = await driver.snapshot();
  const rejection = await driver.submitOutOfRange(slot3Presentation);
  assert(
    rejection.code === "PRESENTATION_REJECTED",
    "SLOT_3_REJECTED: public response exposed a different rejection code"
  );
  assert(rejection.usageDelta === 0, "SLOT_3_REJECTED: rejection consumed a use");
  assert(rejection.actionDelta === 0, "SLOT_3_REJECTED: rejection committed an action");
  const afterOverLimit = await record(
    "SLOT_3_REJECTED",
    {
      acceptedUses: 3,
      outboxEvents: 3,
      committedActions: 3,
      distinctReceipts: 3,
      consumedChallenges: 3,
    },
    demoRunId
  );
  assertSameReceipts(afterOverLimit, beforeOverLimit, "SLOT_3_REJECTED");

  const extraUsesFromRetry = retryAfter.acceptedUses - retryBefore.acceptedUses;
  const extraActionsFromRetry = retryAfter.committedActions - retryBefore.committedActions;
  const overLimitMutations = mutationDistance(beforeOverLimit, afterOverLimit);
  assert(extraUsesFromRetry === 0, "G6: extra_uses_from_retry must equal zero");
  assert(extraActionsFromRetry === 0, "G6: extra_actions_from_retry must equal zero");
  assert(overLimitMutations === 0, "G6: over_limit_mutations must equal zero");

  return {
    demoRunId,
    policy: { ...policy, maxUses: 3 },
    uses: [slot0, slot1, slot2],
    checkpoints,
    invariants: {
      declaredLimit: 3,
      acceptedDistinctUses: 3,
      committedExternalActions: 3,
      extraUsesFromRetry: 0,
      extraActionsFromRetry: 0,
      overLimitMutations: 0,
      allReceiptsStable: true,
    },
  };
}
