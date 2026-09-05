import {
  challengeResponseSchema,
  issuanceResponseSchema,
  policySchema,
  useResultSchema,
  uuidSchema,
  type Action,
  type ChallengeRequest,
  type ChallengeResponse,
  type IssuanceRequest,
  type IssuanceResponse,
  type Policy,
  type PolicyPath,
  type Presentation,
  type PublicErrorCode,
  type UseResult,
  type UseStatusResponse,
} from "@anonlimit/contracts";
import {
  DomainError,
  PROTOCOL_VERSION,
  assertChallengeFresh,
  assertPolicyBinding,
  assertPolicyFresh,
  canonicalAction,
  classifyRetry,
  computeIntentDigest,
  computePolicyDigest,
  computeScopeHash,
  type AcceptedUse,
} from "@anonlimit/domain";

const PRESENTATION_RESOURCE = "/v1/verifier/presentations";
const DEFAULT_CHALLENGE_TTL_MS = 120_000;

export interface ActiveDemoRun {
  readonly demoRunId: string;
}

/** The raw nonce is returned to the wallet and never enters this persistence shape. */
export interface StoredChallenge {
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
  readonly state: "ISSUED" | "CONSUMED" | "EXPIRED";
  readonly useId: string | null;
  readonly createdAt: string;
}

export type NewChallenge = Omit<StoredChallenge, "state" | "useId" | "createdAt">;

export interface AcceptanceInput {
  readonly useId: string;
  readonly outboxEventId: string;
  readonly protocolEventId: string;
  readonly traceId: string;
  readonly demoRunId: string;
  readonly policy: Policy;
  readonly policyDigest: string;
  readonly challenge: StoredChallenge;
  readonly nullifierKey: string;
  readonly actionKey: string;
  readonly payloadDigest: string;
  readonly action: Action;
  readonly maskedUseRef: string;
}

/**
 * This port keeps all database behavior behind one narrow boundary. The acceptance method must
 * perform its policy/challenge recheck and all four writes in one PostgreSQL transaction.
 */
export interface ProtocolRepository {
  getPolicy(policyId: string, policyVersion: number): Promise<Policy | null>;
  getActiveDemoRun(): Promise<ActiveDemoRun | null>;
  insertChallenge(challenge: NewChallenge): Promise<unknown>;
  getChallenge(challengeId: string): Promise<StoredChallenge | null>;
  findAcceptedUses(input: {
    readonly demoRunId: string;
    readonly scopeHash: string;
    readonly nullifierKey: string;
    readonly operationId: string;
  }): Promise<{
    readonly byNullifier: AcceptedUse | null;
    readonly byOperation: AcceptedUse | null;
  }>;
  acceptPresentation(input: AcceptanceInput): Promise<AcceptedUse>;
  getUseStatus(useId: string): Promise<UseStatusResponse | null>;
  recordRetry(input: {
    readonly eventIds: readonly string[];
    readonly traceId: string;
    readonly useId: string;
    readonly maskedUseRef: string;
    readonly result: UseResult;
  }): Promise<void>;
}

export interface IssuerPort {
  readonly publicParameters: {
    readonly provider: "SIMULATED_CAPABILITIES_V1";
    readonly issuerKeyId: string;
  };
  issueAnonymousCredential(input: {
    readonly policy: Policy;
    readonly demoRunId: string;
    readonly blindedHolderRequest?: string;
  }): Promise<IssuanceResponse>;
}

export interface VerifierPort {
  verifyPresentation(input: {
    readonly policy: Policy;
    readonly demoRunId: string;
    readonly issuerPublicParameters: IssuerPort["publicParameters"];
    readonly challenge: ChallengeResponse;
    readonly expectedOperationId: string;
    readonly expectedIntentDigest: string;
    readonly presentation: Presentation;
  }): Promise<
    | { readonly valid: true; readonly diagnosticCode: "VERIFIED" }
    | {
        readonly valid: false;
        readonly diagnosticCode: "PRESENTATION_REJECTED" | "BOUND_EXCEEDED";
      }
  >;
}

export interface LookupProtectionPort {
  protectNullifier(input: {
    readonly scopeHash: string;
    readonly rawNullifier: string;
  }): Promise<string>;
  deriveActionKey(input: {
    readonly useId: string;
    readonly intentDigest: string;
  }): Promise<string>;
}

export interface ProtocolServiceDependencies {
  readonly repository: ProtocolRepository;
  readonly issuer: IssuerPort;
  readonly verifier: VerifierPort;
  readonly lookupProtection: LookupProtectionPort;
  readonly sha256Hex: (value: string) => Promise<string>;
  readonly now?: () => number;
  readonly randomUuid?: () => string;
  readonly randomBytes?: (length: number) => Uint8Array;
  readonly challengeTtlMs?: number;
}

export interface ProtocolResponse<T> {
  readonly statusCode: number;
  readonly body: T;
}

const ERROR_STATUS: Readonly<Record<PublicErrorCode, number>> = Object.freeze({
  BAD_REQUEST: 400,
  PRESENTATION_REJECTED: 422,
  CHALLENGE_EXPIRED: 410,
  POLICY_REJECTED: 422,
  NULLIFIER_REUSE_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  ACTION_INTEGRITY_CONFLICT: 409,
  ACTION_FAILED_FINAL: 422,
  NOT_FOUND: 404,
  DEMO_DISABLED: 503,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
});

/** Contains a constant public code only; request/proof material is deliberately never attached. */
export class ProtocolPublicError extends Error {
  readonly code: PublicErrorCode;
  readonly statusCode: number;

  constructor(code: PublicErrorCode) {
    super(code);
    this.name = "ProtocolPublicError";
    this.code = code;
    this.statusCode = ERROR_STATUS[code];
  }
}

function fail(code: PublicErrorCode): never {
  throw new ProtocolPublicError(code);
}

function checkedNow(now: () => number): number {
  const value = now();
  if (!Number.isFinite(value)) throw new Error("CLOCK_INVALID");
  return value;
}

function checkedUuid(randomUuid: () => string): string {
  const parsed = uuidSchema.safeParse(randomUuid());
  if (!parsed.success) throw new Error("RANDOMNESS_INVALID");
  return parsed.data;
}

function hex(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += byte.toString(16).padStart(2, "0");
  return value;
}

function challengeNonce(randomBytes: (length: number) => Uint8Array): string {
  const value = randomBytes(32);
  if (!(value instanceof Uint8Array) || value.length !== 32) throw new Error("RANDOMNESS_INVALID");
  return hex(value);
}

async function digest(value: string, sha256Hex: (input: string) => Promise<string>) {
  const output = await sha256Hex(value);
  if (!/^[a-f0-9]{64}$/u.test(output)) throw new Error("HASH_INVALID");
  return `sha256:${output}`;
}

function mapDomainError(error: unknown): never {
  if (!(error instanceof DomainError)) throw error;
  switch (error.code) {
    case "POLICY_REJECTED":
      return fail("POLICY_REJECTED");
    case "CHALLENGE_EXPIRED":
      return fail("CHALLENGE_EXPIRED");
    case "CHALLENGE_REJECTED":
      return fail("PRESENTATION_REJECTED");
    case "NULLIFIER_REUSE_CONFLICT":
      return fail("NULLIFIER_REUSE_CONFLICT");
    case "IDEMPOTENCY_CONFLICT":
      return fail("IDEMPOTENCY_CONFLICT");
    default:
      throw error;
  }
}

function ownString(value: unknown, property: string): string | null {
  if (!value || typeof value !== "object") return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, property);
  return descriptor && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

function acceptanceFailure(error: unknown):
  | { readonly kind: "RACE_LOST" }
  | {
      readonly kind: "REJECTED";
      readonly code: "POLICY_REJECTED" | "CHALLENGE_REJECTED" | "CHALLENGE_EXPIRED";
    }
  | null {
  const name = ownString(error, "name");
  if (
    name === "AcceptanceUniquenessError" &&
    [
      "uq_use_records_challenge",
      "uq_use_records_run_scope_nullifier",
      "uq_use_records_run_scope_operation",
      "uq_use_records_action_key",
      "uq_outbox_events_use_type",
    ].includes(ownString(error, "constraint") ?? "")
  )
    return { kind: "RACE_LOST" };
  if (name === "AcceptanceRaceLostError") return { kind: "RACE_LOST" };
  const code = ownString(error, "code");
  if (
    name === "AcceptancePreconditionError" &&
    (code === "POLICY_REJECTED" || code === "CHALLENGE_REJECTED" || code === "CHALLENGE_EXPIRED")
  )
    return { kind: "REJECTED", code };
  return null;
}

function assertBoundAndFreshPolicy(
  policy: Policy,
  reference: {
    readonly policyId: string;
    readonly policyVersion: number;
    readonly audience: string;
  },
  now: number
): void {
  try {
    assertPolicyBinding(policy, {
      ...reference,
      issuerKeyId: policy.issuerKeyId,
      quotaWindowId: policy.quotaWindowId,
    });
    assertPolicyFresh(policy, now);
  } catch (error) {
    mapDomainError(error);
  }
}

function retryResponse(decision: Exclude<ReturnType<typeof classifyRetry>, { kind: "NEW" }>) {
  if (decision.kind === "CONFLICT") fail(decision.code);
  const common = {
    useId: decision.useId,
    status: decision.status,
    code: decision.code,
    replayed: decision.replayed,
    usageDelta: decision.usageDelta,
    actionDelta: decision.actionDelta,
  } as const;
  const result = useResultSchema.parse(
    decision.status === "SUCCEEDED"
      ? { ...common, receipt: decision.receipt }
      : decision.status === "FAILED_FINAL"
        ? { ...common, failureCode: decision.failureCode }
        : common
  );
  return {
    statusCode: decision.status === "ACCEPTED_PENDING_ACTION" ? 202 : 200,
    body: result,
  } satisfies ProtocolResponse<UseResult>;
}

export interface ProtocolService {
  getPolicy(path: PolicyPath): Promise<ProtocolResponse<Policy>>;
  issueCredential(request: IssuanceRequest): Promise<ProtocolResponse<IssuanceResponse>>;
  createChallenge(request: ChallengeRequest): Promise<ProtocolResponse<ChallengeResponse>>;
  present(presentation: Presentation, traceId: string): Promise<ProtocolResponse<UseResult>>;
  getUseStatus(useId: string): Promise<ProtocolResponse<UseStatusResponse>>;
}

export function createProtocolService(dependencies: ProtocolServiceDependencies): ProtocolService {
  const {
    repository,
    issuer,
    verifier,
    lookupProtection,
    sha256Hex,
    now = Date.now,
    randomUuid = () => crypto.randomUUID(),
    randomBytes = (length: number) => crypto.getRandomValues(new Uint8Array(length)),
    challengeTtlMs = DEFAULT_CHALLENGE_TTL_MS,
  } = dependencies;

  if (!Number.isSafeInteger(challengeTtlMs) || challengeTtlMs < 1_000 || challengeTtlMs > 600_000)
    throw new Error("CONFIGURATION_INVALID");

  async function loadPolicy(policyId: string, policyVersion: number): Promise<Policy | null> {
    const candidate = await repository.getPolicy(policyId, policyVersion);
    if (!candidate) return null;
    return policySchema.parse(candidate);
  }

  async function activeRun(): Promise<ActiveDemoRun> {
    const run = await repository.getActiveDemoRun();
    if (!run || !uuidSchema.safeParse(run.demoRunId).success) fail("DEMO_DISABLED");
    return run;
  }

  async function maskedUseReference(useId: string): Promise<string> {
    const maskedDigest = await sha256Hex(useId);
    if (!/^[a-f0-9]{64}$/u.test(maskedDigest)) throw new Error("HASH_INVALID");
    return `use_${maskedDigest.slice(0, 12)}`;
  }

  async function findPriorUse(
    input: {
      readonly demoRunId: string;
      readonly scopeHash: string;
      readonly nullifierKey: string;
      readonly operationId: string;
      readonly intentDigest: string;
    },
    traceId: string
  ): Promise<ProtocolResponse<UseResult> | null> {
    const existing = await repository.findAcceptedUses(input);
    let decision: ReturnType<typeof classifyRetry>;
    try {
      decision = classifyRetry(input, existing);
    } catch (error) {
      mapDomainError(error);
    }
    if (decision.kind === "NEW") return null;
    const response = retryResponse(decision);
    await repository.recordRetry({
      eventIds: Array.from({ length: response.body.status === "SUCCEEDED" ? 3 : 2 }, () =>
        checkedUuid(randomUuid)
      ),
      traceId,
      useId: response.body.useId,
      maskedUseRef: await maskedUseReference(response.body.useId),
      result: response.body,
    });
    return response;
  }

  const service: ProtocolService = {
    async getPolicy(path) {
      const policy = await loadPolicy(path.id, Number(path.version));
      if (!policy) fail("NOT_FOUND");
      return { statusCode: 200, body: policy };
    },

    async getUseStatus(useId) {
      const status = await repository.getUseStatus(useId);
      if (!status) fail("NOT_FOUND");
      return { statusCode: 200, body: status };
    },

    async issueCredential(request) {
      const policy = await loadPolicy(request.policyId, request.policyVersion);
      if (!policy) fail("POLICY_REJECTED");
      try {
        assertPolicyFresh(policy, checkedNow(now));
      } catch (error) {
        mapDomainError(error);
      }
      const run = await activeRun();
      try {
        const response = await issuer.issueAnonymousCredential({
          policy,
          demoRunId: run.demoRunId,
          ...(request.blindedHolderRequest === undefined
            ? {}
            : { blindedHolderRequest: request.blindedHolderRequest }),
        });
        return { statusCode: 200, body: issuanceResponseSchema.parse(response) };
      } catch (error) {
        if (error instanceof ProtocolPublicError) throw error;
        fail("SERVICE_UNAVAILABLE");
      }
    },

    async createChallenge(request) {
      const currentTime = checkedNow(now);
      const policy = await loadPolicy(request.policyId, request.policyVersion);
      if (!policy) fail("POLICY_REJECTED");
      assertBoundAndFreshPolicy(policy, request, currentTime);
      const run = await activeRun();
      const [policyDigest, scopeHash, intentDigest] = await Promise.all([
        computePolicyDigest(policy, sha256Hex),
        computeScopeHash(policy, sha256Hex),
        computeIntentDigest(
          {
            protocolVersion: PROTOCOL_VERSION,
            operationId: request.operationId,
            method: "POST",
            resource: PRESENTATION_RESOURCE,
            action: request.action,
          },
          sha256Hex
        ),
      ]);
      const nonce = challengeNonce(randomBytes);
      const challengeId = checkedUuid(randomUuid);
      const expiresAt = new Date(currentTime + challengeTtlMs).toISOString();
      const nonceHash = await digest(nonce, sha256Hex);
      await repository.insertChallenge({
        challengeId,
        demoRunId: run.demoRunId,
        nonceHash,
        policyId: policy.id,
        policyVersion: policy.version,
        operationId: request.operationId,
        intentDigest,
        scopeHash,
        policyDigest,
        expiresAt,
      });
      const response = challengeResponseSchema.parse({
        challengeId,
        nonce,
        policyDigest,
        expiresAt,
      });
      return { statusCode: 201, body: response };
    },

    async present(presentation, traceId) {
      const policy = await loadPolicy(presentation.policyId, presentation.policyVersion);
      if (!policy) fail("POLICY_REJECTED");
      const run = await activeRun();
      const [policyDigest, scopeHash, intentDigest] = await Promise.all([
        computePolicyDigest(policy, sha256Hex),
        computeScopeHash(policy, sha256Hex),
        computeIntentDigest(
          {
            protocolVersion: PROTOCOL_VERSION,
            operationId: presentation.operationId,
            method: "POST",
            resource: PRESENTATION_RESOURCE,
            action: presentation.action,
          },
          sha256Hex
        ),
      ]);
      const nullifierKey = await lookupProtection.protectNullifier({
        scopeHash,
        rawNullifier: presentation.nullifier,
      });
      const identity = {
        demoRunId: run.demoRunId,
        scopeHash,
        nullifierKey,
        operationId: presentation.operationId,
        intentDigest,
      } as const;

      // A committed historical decision wins even when its original policy/challenge is now stale.
      const prior = await findPriorUse(identity, traceId);
      if (prior) return prior;

      const currentTime = checkedNow(now);
      try {
        assertBoundAndFreshPolicy(policy, presentation, currentTime);
      } catch (error) {
        const winner = await findPriorUse(identity, traceId);
        if (winner) return winner;
        throw error;
      }
      const storedChallenge = await repository.getChallenge(presentation.challengeId);
      if (!storedChallenge) fail("PRESENTATION_REJECTED");
      const nonceHash = await digest(presentation.nonce, sha256Hex);
      if (
        storedChallenge.nonceHash !== nonceHash ||
        storedChallenge.policyId !== policy.id ||
        storedChallenge.policyVersion !== policy.version ||
        storedChallenge.policyDigest !== policyDigest ||
        storedChallenge.demoRunId !== run.demoRunId ||
        storedChallenge.scopeHash !== scopeHash ||
        storedChallenge.operationId !== presentation.operationId ||
        storedChallenge.intentDigest !== intentDigest
      )
        fail("PRESENTATION_REJECTED");
      if (storedChallenge.state === "CONSUMED") {
        const winner = await findPriorUse(identity, traceId);
        if (winner) return winner;
        throw new Error("LEDGER_INCONSISTENT");
      }
      if (storedChallenge.state === "EXPIRED") fail("CHALLENGE_EXPIRED");
      try {
        assertChallengeFresh(
          {
            challengeId: storedChallenge.challengeId,
            nonce: presentation.nonce,
            expiresAt: storedChallenge.expiresAt,
            policyDigest: storedChallenge.policyDigest,
            demoRunId: storedChallenge.demoRunId,
            scopeHash: storedChallenge.scopeHash,
            operationId: storedChallenge.operationId,
            intentDigest: storedChallenge.intentDigest,
            state: storedChallenge.state,
          },
          {
            challengeId: presentation.challengeId,
            nonce: presentation.nonce,
            expiresAt: storedChallenge.expiresAt,
            policyDigest,
            demoRunId: run.demoRunId,
            scopeHash,
            operationId: presentation.operationId,
            intentDigest,
          },
          currentTime
        );
      } catch (error) {
        const winner = await findPriorUse(identity, traceId);
        if (winner) return winner;
        mapDomainError(error);
      }
      const challenge = challengeResponseSchema.parse({
        challengeId: storedChallenge.challengeId,
        nonce: presentation.nonce,
        policyDigest: storedChallenge.policyDigest,
        expiresAt: storedChallenge.expiresAt,
      });
      let verification: Awaited<ReturnType<VerifierPort["verifyPresentation"]>>;
      try {
        verification = await verifier.verifyPresentation({
          policy,
          demoRunId: run.demoRunId,
          issuerPublicParameters: issuer.publicParameters,
          challenge,
          expectedOperationId: storedChallenge.operationId,
          expectedIntentDigest: storedChallenge.intentDigest,
          presentation,
        });
      } catch {
        fail("SERVICE_UNAVAILABLE");
      }
      if (!verification.valid) fail("PRESENTATION_REJECTED");

      const useId = checkedUuid(randomUuid);
      const outboxEventId = checkedUuid(randomUuid);
      const protocolEventId = checkedUuid(randomUuid);
      const [actionKey, payloadDigest, maskedUseRef] = await Promise.all([
        lookupProtection.deriveActionKey({ useId, intentDigest }),
        digest(canonicalAction(presentation.action), sha256Hex),
        maskedUseReference(useId),
      ]);
      let acceptanceFailed = false;
      let acceptanceError: unknown;
      try {
        await repository.acceptPresentation({
          useId,
          outboxEventId,
          protocolEventId,
          traceId,
          demoRunId: run.demoRunId,
          policy,
          policyDigest,
          challenge: storedChallenge,
          nullifierKey,
          actionKey,
          payloadDigest,
          action: presentation.action,
          maskedUseRef,
        });
      } catch (error) {
        acceptanceFailed = true;
        acceptanceError = error;
      }

      const outcome = acceptanceFailure(acceptanceError);
      if (outcome?.kind === "RACE_LOST") {
        const winner = await findPriorUse(identity, traceId);
        if (winner) return winner;
        throw new Error("LEDGER_INCONSISTENT");
      }
      if (outcome?.kind === "REJECTED") {
        switch (outcome.code) {
          case "CHALLENGE_EXPIRED":
            fail("CHALLENGE_EXPIRED");
          case "CHALLENGE_REJECTED":
            fail("PRESENTATION_REJECTED");
          case "POLICY_REJECTED":
            fail("POLICY_REJECTED");
        }
      }
      if (acceptanceFailed) throw acceptanceError ?? new Error("DATABASE_UNAVAILABLE");
      return {
        statusCode: 202,
        body: useResultSchema.parse({
          useId,
          status: "ACCEPTED_PENDING_ACTION",
          code: "ACCEPTED_PENDING_ACTION",
          replayed: false,
          usageDelta: 1,
          actionDelta: 0,
        }),
      };
    },
  };
  return Object.freeze(service);
}
