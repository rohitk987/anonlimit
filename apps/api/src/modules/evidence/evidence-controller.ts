import { createHash, randomUUID } from "node:crypto";
import {
  challengeResponseSchema,
  demoLinkabilityRequestSchema,
  evidenceReportSchema,
  linkabilityReportSchema,
  protocolVersionSchema,
  type EvidenceReport,
  type LinkabilityReport,
  type Policy,
  type Presentation,
} from "@anonlimit/contracts";
import {
  calculateInvariants,
  computeScopeHash,
  type EvidenceObservations,
  type LinkabilityPair as DomainLinkabilityPair,
} from "@anonlimit/domain";
import type { AuditAdapter, LinkabilityResult } from "@anonlimit/crypto/audit";
import type { ProtocolEventInput, VerifierEvidenceSnapshot } from "@anonlimit/db/verifier";
import { ProtocolPublicError } from "../protocol/protocol-service.js";
import type { ActionSimulatorEvidenceClient } from "../internal/action-simulator-client.js";

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
  runLinkability(input: unknown, traceId: string): Promise<LinkabilityReport>;
}

export interface EvidenceControllerOptions {
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

function opposite(result: "SAME_USE" | "UNLINKABLE"): "SAME_USE" | "UNLINKABLE" {
  return result === "SAME_USE" ? "UNLINKABLE" : "SAME_USE";
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

function countsSnapshot(
  snapshot: VerifierEvidenceSnapshot,
  externalActions: number,
  receipts: number
) {
  return {
    uses: snapshot.uses.length,
    outboxEvents: snapshot.outboxUseIds.length,
    externalActions,
    receipts,
  } as const;
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
    const pairs: DomainLinkabilityPair[] = [];
    let failed = false;
    const compare = async (
      left: AuditInput,
      right: AuditInput,
      expected: DomainLinkabilityPair["expected"]
    ) => {
      let result: LinkabilityResult;
      try {
        result = (await options.auditAdapter?.testLinkability(
          left.verification,
          right.verification
        )) ?? {
          ok: false,
          code: "PRESENTATION_REJECTED",
        };
      } catch {
        result = { ok: false, code: "PRESENTATION_REJECTED" };
      }
      const observed = result.ok ? result.result : opposite(expected);
      if (observed !== expected) failed = true;
      pairs.push({
        leftUseRef: left.use.useId,
        rightUseRef: right.use.useId,
        expected,
        result: observed,
      });
    };
    for (let left = 0; left < representatives.length; left += 1)
      for (let right = left + 1; right < representatives.length; right += 1) {
        const leftInput = representatives[left];
        const rightInput = representatives[right];
        if (leftInput && rightInput) await compare(leftInput, rightInput, "UNLINKABLE");
      }
    for (const representative of representatives) {
      const retry = prepared.find(
        (candidate) =>
          candidate.use.useId === representative?.use.useId && candidate !== representative
      );
      if (retry && representative) await compare(representative, retry, "SAME_USE");
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

  async function getEvidence(): Promise<EvidenceReport> {
    const snapshot = await snapshotOrDisabled();
    const actionEvidence = await options.actionClient.getEvidence(snapshot.demoRunId);
    const counts = countsSnapshot(
      snapshot,
      actionEvidence.externalActions,
      actionEvidence.receipts.length
    );
    const retries = snapshot.events
      .filter((event) => event.event === "RETRY_MATCHED")
      .map(() => ({ before: counts, after: counts }));
    const rejectedAttempts = snapshot.events
      .filter((event) => ["OVER_LIMIT_REJECTED", "PRESENTATION_REJECTED"].includes(event.event))
      .map((event) => ({
        kind:
          event.event === "OVER_LIMIT_REJECTED" ? ("OVER_LIMIT" as const) : ("INVALID" as const),
        rejected: true,
        before: counts,
        after: counts,
      }));
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
      retries,
      rejectedAttempts,
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

  return Object.freeze({ getEvidence, runLinkability });
}

function uuidSchemaParse(randomUuid: () => string): string {
  const value = randomUuid();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value))
    throw new Error("RANDOMNESS_INVALID");
  return value;
}
