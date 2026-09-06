import { createHash, randomUUID } from "node:crypto";
import {
  challengeResponseSchema,
  demoLinkabilityRequestSchema,
  evidenceReportSchema,
  insightsReportSchema,
  aiNarrationSchema,
  linkabilityReportSchema,
  protocolVersionSchema,
  type EvidenceReport,
  type InsightsReport,
  type LinkabilityReport,
  type Policy,
  type Presentation,
} from "@anonlimit/contracts";
import {
  calculateInvariants,
  canonicalJson,
  computeScopeHash,
  type EvidenceObservations,
  type LinkabilityPair as DomainLinkabilityPair,
} from "@anonlimit/domain";
import type { AuditAdapter } from "@anonlimit/crypto/audit";
import type { ProtocolEventInput, VerifierEvidenceSnapshot } from "@anonlimit/db/verifier";
import { ProtocolPublicError } from "../protocol/protocol-service.js";
import type { ActionSimulatorEvidenceClient } from "../internal/action-simulator-client.js";
import { analyzeInsights } from "../insights/analyze.js";
import type { AiNarrator } from "../insights/ai-narrator.js";

const MASKED_REF_LENGTH = 12;

export interface EvidenceRepository {
  getEvidenceSnapshot(): Promise<VerifierEvidenceSnapshot | null>;
  getChallenge(challengeId: string): Promise<VerifierEvidenceChallenge | null>;
  findAcceptedUses(input: {
    readonly demoRunId: string;
    readonly scopeHash: string;
    readonly nullifierKey: string;
    readonly operationId: string;
  }): Promise<{
    readonly byNullifier: EvidenceAcceptedUse | null;
    readonly byOperation: EvidenceAcceptedUse | null;
  }>;
  appendProtocolEvent?(input: ProtocolEventInput): Promise<void>;
}

interface EvidenceAcceptedUse {
  readonly useId: string;
  readonly demoRunId: string;
  readonly scopeHash: string;
  readonly nullifierKey: string;
  readonly operationId: string;
  readonly intentDigest: string;
  readonly status: "ACCEPTED_PENDING_ACTION" | "SUCCEEDED" | "FAILED_FINAL";
  readonly receipt?: {
    readonly receiptId: string;
    readonly useId: string;
    readonly actionKey: string;
    readonly status: "COMMITTED";
    readonly committedAt: string;
  };
}

interface VerifierEvidenceChallenge {
  readonly challengeId: string;
  readonly demoRunId: string;
  readonly nonceHash: string;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly operationId: string;
  readonly intentDigest: string;
  readonly scopeHash: string;
  readonly policyDigest: string;
  readonly expiresAt: string;
}

interface AuditInput {
  readonly presentation: Presentation;
  readonly use: EvidenceAcceptedUse;
  readonly verification: Parameters<AuditAdapter["testLinkability"]>[0];
}

interface StoredAudit {
  readonly demoRunId: string;
  readonly distinctUseRefs: readonly string[];
  readonly pairs: readonly DomainLinkabilityPair[];
  readonly status: "PASS" | "FAIL" | "INCOMPLETE";
}

export interface EvidenceController {
  getEvidence(): Promise<EvidenceReport>;
  getInsights(): Promise<InsightsReport>;
  runLinkability(input: unknown, traceId: string): Promise<LinkabilityReport>;
}

export interface EvidenceControllerOptions {
  readonly aiNarrator?: AiNarrator;
  readonly repository: EvidenceRepository;
  readonly actionClient: ActionSimulatorEvidenceClient;
  readonly auditAdapter?: AuditAdapter;
  readonly issuerPublicParameters: Parameters<
    AuditAdapter["testLinkability"]
  >[0]["issuerPublicParameters"];
  readonly lookupProtection: {
    protectNullifier(input: {
      readonly scopeHash: string;
      readonly rawNullifier: string;
    }): Promise<string>;
  };
  readonly sha256Hex: (value: string) => Promise<string>;
  readonly now?: () => number;
  readonly randomUuid?: () => string;
}

function maskedUseRef(useId: string): string {
  return `use_${createHash("sha256").update(useId, "utf8").digest("hex").slice(0, MASKED_REF_LENGTH)}`;
}

function isoNow(now: () => number): string {
  const value = now();
  if (!Number.isFinite(value)) throw new Error("CLOCK_INVALID");
  return new Date(value).toISOString();
}

function publicLinkability(stored: StoredAudit): LinkabilityReport {
  return linkabilityReportSchema.parse({
    status: stored.status,
    pairs: stored.pairs.map((pair) => ({
      leftUseRef: maskedUseRef(pair.leftUseRef),
      rightUseRef: maskedUseRef(pair.rightUseRef),
      expected: pair.expected,
      result: pair.result,
    })),
  });
}

function publicEvidenceUse(record: VerifierEvidenceSnapshot["uses"][number]) {
  const use = record.acceptedUse;
  return {
    maskedUseRef: record.maskedUseRef,
    intentDigest: use.intentDigest,
    status: use.status,
    receiptId: use.status === "SUCCEEDED" ? use.receipt.receiptId : null,
    actionKey: record.actionKey,
  };
}

/** Transactional events measure effects by request trace; ledgers prove event coverage. */
function mutationEvidence(snapshot: VerifierEvidenceSnapshot, actionUseIds: readonly string[]) {
  const accepted = snapshot.events.filter((event) => event.event === "USE_ACCEPTED");
  const completed = snapshot.events.filter((event) => event.event === "EXTERNAL_ACTION_COMMITTED");
  const refs = new Set(snapshot.uses.map((record) => record.maskedUseRef));
  const actionRefs = new Set(actionUseIds.map(maskedUseRef));
  const oneEach = (values: readonly (string | undefined)[], expected: ReadonlySet<string>) =>
    values.length === expected.size &&
    new Set(values).size === values.length &&
    values.every((value) => value !== undefined && expected.has(value));
  const ledgerComplete =
    oneEach(
      accepted.map((event) => event.maskedUseRef),
      refs
    ) &&
    oneEach(
      completed.map((event) => event.maskedUseRef),
      actionRefs
    ) &&
    oneEach(
      snapshot.outboxUseIds,
      new Set(snapshot.uses.map((record) => record.acceptedUse.useId))
    ) &&
    snapshot.events.reduce((total, event) => total + event.usageDelta, 0) ===
      snapshot.uses.length &&
    snapshot.events.reduce((total, event) => total + event.actionDelta, 0) === actionUseIds.length;
  const deltaForTrace = (traceId: string) => {
    const events = snapshot.events.filter((event) => event.traceId === traceId);
    return {
      uses: events.reduce((total, event) => total + event.usageDelta, 0),
      outboxEvents: events.filter((event) => event.event === "USE_ACCEPTED").length,
      externalActions: events.reduce((total, event) => total + event.actionDelta, 0),
      receipts: events.filter((event) => event.event === "EXTERNAL_ACTION_COMMITTED").length,
    };
  };
  const retryEvents = snapshot.events.filter((event) => event.event === "RETRY_MATCHED");
  const retryComplete = retryEvents.every(
    (event) =>
      accepted.some(
        (original) =>
          original.maskedUseRef === event.maskedUseRef && original.sequence < event.sequence
      ) &&
      snapshot.events.some(
        (result) =>
          result.traceId === event.traceId &&
          result.maskedUseRef === event.maskedUseRef &&
          ["RETRY_RESOLVED", "RETRY_IN_PROGRESS", "USE_FAILED_FINAL"].includes(result.event)
      )
  );
  return {
    unavailable: !ledgerComplete || !retryComplete,
    retries:
      ledgerComplete && retryComplete
        ? retryEvents.map((event) => ({ delta: deltaForTrace(event.traceId) }))
        : null,
    rejectedAttempts: ledgerComplete
      ? snapshot.events
          .filter((event) =>
            ["OVER_LIMIT_REJECTED", "PRESENTATION_REJECTED", "NULLIFIER_CONFLICT"].includes(
              event.event
            )
          )
          .map((event) => ({
            kind:
              event.event === "OVER_LIMIT_REJECTED"
                ? ("OVER_LIMIT" as const)
                : ("INVALID" as const),
            rejected: true,
            delta: deltaForTrace(event.traceId),
          }))
      : null,
  };
}

export function createEvidenceController(options: EvidenceControllerOptions): EvidenceController {
  const now = options.now ?? Date.now;
  const randomUuid = options.randomUuid ?? randomUUID;
  let audit: StoredAudit | undefined;

  async function snapshotOrDisabled(): Promise<VerifierEvidenceSnapshot> {
    const snapshot = await options.repository.getEvidenceSnapshot();
    if (!snapshot) throw new ProtocolPublicError("DEMO_DISABLED");
    return snapshot;
  }

  async function prepareAuditInput(
    snapshot: VerifierEvidenceSnapshot,
    presentation: Presentation
  ): Promise<AuditInput> {
    const policy: Policy = snapshot.policy;
    if (
      presentation.policyId !== policy.id ||
      presentation.policyVersion !== policy.version ||
      presentation.audience !== policy.audience
    )
      throw new Error("AUDIT_PRESENTATION_REJECTED");
    const stored = await options.repository.getChallenge(presentation.challengeId);
    if (
      !stored ||
      stored.demoRunId !== snapshot.demoRunId ||
      stored.policyId !== policy.id ||
      stored.policyVersion !== policy.version ||
      stored.operationId !== presentation.operationId
    )
      throw new Error("AUDIT_PRESENTATION_REJECTED");
    const nonceDigest = await options.sha256Hex(presentation.nonce);
    if (`sha256:${nonceDigest}` !== stored.nonceHash)
      throw new Error("AUDIT_PRESENTATION_REJECTED");
    const scopeHash = await computeScopeHash(policy, options.sha256Hex);
    if (scopeHash !== stored.scopeHash) throw new Error("AUDIT_PRESENTATION_REJECTED");
    const nullifierKey = await options.lookupProtection.protectNullifier({
      scopeHash,
      rawNullifier: presentation.nullifier,
    });
    const existing = await options.repository.findAcceptedUses({
      demoRunId: snapshot.demoRunId,
      scopeHash,
      nullifierKey,
      operationId: presentation.operationId,
    });
    const use = existing.byNullifier;
    if (
      !use ||
      use.demoRunId !== snapshot.demoRunId ||
      use.scopeHash !== scopeHash ||
      use.operationId !== presentation.operationId ||
      use.intentDigest !== stored.intentDigest
    )
      throw new Error("AUDIT_PRESENTATION_REJECTED");
    const challenge = challengeResponseSchema.parse({
      challengeId: stored.challengeId,
      nonce: presentation.nonce,
      policyDigest: stored.policyDigest,
      expiresAt: stored.expiresAt,
    });
    return {
      presentation,
      use,
      verification: {
        policy,
        demoRunId: snapshot.demoRunId,
        issuerPublicParameters: options.issuerPublicParameters,
        challenge,
        expectedOperationId: stored.operationId,
        expectedIntentDigest: stored.intentDigest,
        presentation,
      },
    };
  }

  async function runLinkability(rawInput: unknown, traceId: string): Promise<LinkabilityReport> {
    const input = demoLinkabilityRequestSchema.parse(rawInput);
    const snapshot = await snapshotOrDisabled();
    if (!options.auditAdapter) {
      audit = {
        demoRunId: snapshot.demoRunId,
        distinctUseRefs: [],
        pairs: [],
        status: "INCOMPLETE",
      };
      return publicLinkability(audit);
    }
    let prepared: readonly AuditInput[];
    try {
      prepared = await Promise.all(
        input.presentations.map((presentation) => prepareAuditInput(snapshot, presentation))
      );
    } catch {
      audit = {
        demoRunId: snapshot.demoRunId,
        distinctUseRefs: [],
        pairs: [],
        status: "INCOMPLETE",
      };
      return publicLinkability(audit);
    }
    const expectedUses = new Set(snapshot.uses.map((record) => record.acceptedUse.useId));
    const actualUses = new Set(prepared.map((record) => record.use.useId));
    if (
      actualUses.size !== expectedUses.size ||
      [...expectedUses].some((useId) => !actualUses.has(useId))
    ) {
      audit = {
        demoRunId: snapshot.demoRunId,
        distinctUseRefs: [],
        pairs: [],
        status: "INCOMPLETE",
      };
      return publicLinkability(audit);
    }
    const representatives = [
      ...new Map(prepared.map((record) => [record.use.useId, record])).values(),
    ];
    const exactRetries = representatives.flatMap((representative) => {
      const retry = prepared.find(
        (candidate) =>
          candidate !== representative &&
          canonicalJson(candidate.presentation) === canonicalJson(representative.presentation)
      );
      return retry &&
        snapshot.events.some(
          (event) =>
            event.event === "RETRY_MATCHED" &&
            event.maskedUseRef === maskedUseRef(representative.use.useId)
        )
        ? [{ representative, retry }]
        : [];
    });
    if (actualUses.size < 2 || exactRetries.length === 0) {
      audit = {
        demoRunId: snapshot.demoRunId,
        distinctUseRefs: [],
        pairs: [],
        status: "INCOMPLETE",
      };
      return publicLinkability(audit);
    }
    const pairs: DomainLinkabilityPair[] = [];
    let failed = false;
    let unavailable = false;
    const compare = async (
      left: AuditInput,
      right: AuditInput,
      expected: DomainLinkabilityPair["expected"]
    ) => {
      try {
        const result = await options.auditAdapter?.testLinkability(
          left.verification,
          right.verification
        );
        if (!result?.ok) {
          unavailable = true;
          return;
        }
        if (result.result !== expected) failed = true;
        pairs.push({
          leftUseRef: left.use.useId,
          rightUseRef: right.use.useId,
          expected,
          result: result.result,
        });
      } catch {
        unavailable = true;
      }
    };
    for (let left = 0; left < representatives.length; left += 1)
      for (let right = left + 1; right < representatives.length; right += 1) {
        const leftInput = representatives[left];
        const rightInput = representatives[right];
        if (leftInput && rightInput) await compare(leftInput, rightInput, "UNLINKABLE");
      }
    for (const { representative, retry } of exactRetries)
      await compare(representative, retry, "SAME_USE");
    if (unavailable) {
      audit = {
        demoRunId: snapshot.demoRunId,
        distinctUseRefs: [],
        pairs: [],
        status: "INCOMPLETE",
      };
      return publicLinkability(audit);
    }
    const status = failed ? "FAIL" : "PASS";
    audit = {
      demoRunId: snapshot.demoRunId,
      distinctUseRefs: representatives.map((record) => record.use.useId),
      pairs,
      status,
    };
    if (options.repository.appendProtocolEvent) {
      const event: ProtocolEventInput = {
        eventId: uuidSchemaParse(randomUuid),
        occurredAt: isoNow(now),
        event: "PRIVACY_AUDIT_COMPLETED",
        traceId,
        demoRunId: snapshot.demoRunId,
        policyId: snapshot.policy.id,
        policyVersion: snapshot.policy.version,
        fromState: "UNSEEN",
        toState: "UNSEEN",
        decisionCode: status === "PASS" ? "SUCCEEDED" : "PRESENTATION_REJECTED",
        usageDelta: 0,
        actionDelta: 0,
      };
      await options.repository.appendProtocolEvent(event);
    }
    return publicLinkability(audit);
  }

  async function evidenceFromSnapshot(snapshot: VerifierEvidenceSnapshot): Promise<EvidenceReport> {
    const actionEvidence = await options.actionClient.getEvidence(snapshot.demoRunId);
    const mutations = mutationEvidence(
      snapshot,
      actionEvidence.receipts.map((receipt) => receipt.useId)
    );
    const actionByUse = new Map(actionEvidence.receipts.map((receipt) => [receipt.useId, receipt]));
    const receiptRecoveries = snapshot.uses.flatMap((record) => {
      if (record.acceptedUse.status !== "SUCCEEDED") return [];
      const recovered = actionByUse.get(record.acceptedUse.useId);
      if (!recovered) return [];
      return [{ useId: record.acceptedUse.useId, original: record.acceptedUse.receipt, recovered }];
    });
    const storedAudit = audit?.demoRunId === snapshot.demoRunId ? audit : undefined;
    const observations: EvidenceObservations = {
      declaredLimit: snapshot.policy.maxUses,
      credentialIssuances: snapshot.credentialIssuances,
      uses: snapshot.uses.map((record) => record.acceptedUse),
      outboxUseIds: snapshot.outboxUseIds,
      actions: actionEvidence.receipts.map((receipt) => ({
        useId: receipt.useId,
        actionKey: receipt.actionKey,
      })),
      retries: mutations.retries,
      rejectedAttempts: mutations.rejectedAttempts,
      mutationEvidenceUnavailable:
        mutations.unavailable || actionEvidence.externalActions !== actionEvidence.receipts.length,
      privacy: snapshot.privacy,
      receiptRecoveries,
      linkability: storedAudit
        ? { distinctUseRefs: storedAudit.distinctUseRefs, pairs: storedAudit.pairs }
        : null,
      linkabilityUnavailable: storedAudit?.status === "INCOMPLETE" || storedAudit === undefined,
    };
    const measured = calculateInvariants(observations);
    const publicLink = storedAudit
      ? publicLinkability(storedAudit)
      : linkabilityReportSchema.parse({ status: "INCOMPLETE", pairs: [] });
    return evidenceReportSchema.parse({
      protocolVersion: protocolVersionSchema.parse("AnonLimit/v1"),
      demoRunId: snapshot.demoRunId,
      generatedAt: isoNow(now),
      declaredLimit: snapshot.policy.maxUses,
      counts: measured.counts,
      checks: measured.checks,
      overall: measured.overall,
      uses: snapshot.uses.map(publicEvidenceUse),
      linkability: publicLink,
    });
  }

  async function getEvidence(): Promise<EvidenceReport> {
    return evidenceFromSnapshot(await snapshotOrDisabled());
  }

  async function getInsights(): Promise<InsightsReport> {
    // Both the evidence and event analysis use the same repeatable-read verifier snapshot.
    const snapshot = await snapshotOrDisabled();
    const evidence = await evidenceFromSnapshot(snapshot);
    const analysis = analyzeInsights(evidence, snapshot.events);
    const report = {
      protocolVersion: evidence.protocolVersion,
      demoRunId: evidence.demoRunId,
      generatedAt: evidence.generatedAt,
      analysisVersion: "rules-v1" as const,
      scope: "ACTIVE_DEMO_RUN" as const,
      advisoryOnly: true as const,
      summary: analysis.summary,
      abuse: analysis.abuse,
    };
    let ai: InsightsReport["ai"] = { status: "DISABLED", commentary: null };
    if (options.aiNarrator) {
      try {
        ai = aiNarrationSchema.parse(await options.aiNarrator.explain(report));
      } catch {
        ai = { status: "UNAVAILABLE", commentary: null };
      }
    }
    return insightsReportSchema.parse({ ...report, ai });
  }

  return Object.freeze({ getEvidence, getInsights, runLinkability });
}

function uuidSchemaParse(randomUuid: () => string): string {
  const value = randomUuid();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value))
    throw new Error("RANDOMNESS_INVALID");
  return value;
}
