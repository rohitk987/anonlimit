import {
  type Action,
  type IssuanceResponse,
  type UseResult,
  type UseStatusResponse,
} from "@anonlimit/contracts";
import { createSimulatedHolder, sha256Hex } from "@anonlimit/crypto/holder";
import { canonicalJson, computeIntentDigest } from "@anonlimit/domain";
import { ApiResponseError, type ApiClient } from "../../lib/api-client.js";
import {
  clearWalletAfterDemoReset,
  clearPreparedOperation,
  completeAcceptedOperation,
  readCredential,
  readLatestOperation,
  saveCredential,
  saveCredentialIfAbsent,
  saveOperation,
  type PendingOperationRecord,
  type WalletCredentialRecord,
} from "./wallet-db.js";

const POLICY_ID = "anon-demo";
const POLICY_VERSION = 1;
const ACTION: Action = { type: "REDEEM_DEMO_BENEFIT", payload: { benefitCode: "HACKATHON" } };

export interface WalletSnapshot {
  readonly credential: WalletCredentialRecord | null;
  readonly operation: PendingOperationRecord | null;
}

export type WalletProgressListener = (snapshot: WalletSnapshot) => void;

export class WalletOutcomeUnknownError extends Error {
  constructor() {
    super("OUTCOME_UNKNOWN");
    this.name = "WalletOutcomeUnknownError";
  }
}

function isUnresolved(operation: PendingOperationRecord | null): boolean {
  return operation?.state === "PENDING" || operation?.state === "OUTCOME_UNKNOWN";
}

function operationMatchesCredential(
  operation: PendingOperationRecord,
  credential: WalletCredentialRecord
): boolean {
  return (
    operation.walletCredentialId === credential.walletCredentialId &&
    operation.demoRunId === credential.demoRunId
  );
}

function isAcceptedTerminal(operation: PendingOperationRecord): boolean {
  return (
    (operation.state === "SUCCEEDED" || operation.state === "FAILED") &&
    (operation.result?.status === "SUCCEEDED" || operation.result?.status === "FAILED_FINAL")
  );
}

export async function loadWallet(): Promise<WalletSnapshot> {
  let [credential, operation] = await Promise.all([readCredential(), readLatestOperation()]);
  if (!credential) return { credential: null, operation };

  // Phase 4 records had no local binding. An unresolved record can safely bind to the active
  // credential because the old wallet already prohibited issuance while it was unresolved.
  if (
    operation &&
    isUnresolved(operation) &&
    (!operation.walletCredentialId || !operation.demoRunId)
  ) {
    operation = {
      ...operation,
      walletCredentialId: credential.walletCredentialId,
      demoRunId: credential.demoRunId,
      updatedAt: new Date().toISOString(),
    };
    await saveOperation(operation);
  }

  // Do not expose or apply an operation left by a different local credential or demo run.
  if (operation && !operationMatchesCredential(operation, credential))
    return { credential, operation: null };

  // Reconcile the only possible crash gap. The terminal operation and slot cursor are committed
  // atomically, so repeating this step is harmless.
  if (
    operation &&
    isAcceptedTerminal(operation) &&
    (credential.nextSlot <= operation.hiddenSlot ||
      credential.preparedOperationId === operation.operationId)
  ) {
    await completeAcceptedOperation(operation);
    credential = await readCredential();
  }
  return { credential, operation };
}

export async function issueWalletCredential(client: ApiClient): Promise<WalletSnapshot> {
  if (await readCredential()) throw new Error("CREDENTIAL_ALREADY_ISSUED");
  if (isUnresolved(await readLatestOperation())) throw new Error("RETRY_REQUIRED");
  const response: IssuanceResponse = await client.issueCredential(POLICY_ID, POLICY_VERSION);
  const record: WalletCredentialRecord = {
    id: "active",
    walletCredentialId: operationId(),
    credential: response.credential,
    demoRunId: response.demoRunId,
    policy: response.policy,
    nextSlot: 0,
    updatedAt: new Date().toISOString(),
  };
  if (!(await saveCredentialIfAbsent(record))) throw new Error("CREDENTIAL_ALREADY_ISSUED");
  return loadWallet();
}

/**
 * The server selects and replaces its active demo run first. Only a strictly validated success
 * response allows the browser to clear its credential and persisted operation.
 */
export async function resetWalletDemo(client: ApiClient): Promise<WalletSnapshot> {
  await client.resetDemo();
  await clearWalletAfterDemoReset();
  return { credential: null, operation: null };
}

function operationId(): string {
  return globalThis.crypto.randomUUID();
}

export async function armNextWalletDropAck(client: ApiClient): Promise<WalletSnapshot> {
  const credential = await readCredential();
  if (!credential) throw new Error("CREDENTIAL_REQUIRED");
  if (isUnresolved(await readLatestOperation())) throw new Error("RETRY_REQUIRED");
  if (credential.nextSlot >= credential.policy.maxUses) throw new Error("LIMIT_REACHED");
  const preparedOperationId = credential.preparedOperationId ?? operationId();
  const armed = await client.armDropNextAck(preparedOperationId);
  if (armed.operationId !== preparedOperationId || armed.demoRunId !== credential.demoRunId)
    throw new Error("FAULT_TARGET_MISMATCH");
  await saveCredential({
    ...credential,
    preparedOperationId,
    updatedAt: new Date().toISOString(),
  });
  return loadWallet();
}

async function waitForResult(client: ApiClient, useId: string): Promise<UseStatusResponse> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const status = await client.getUseStatus(useId);
    if (status.status !== "ACCEPTED_PENDING_ACTION") return status;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }
  throw new Error("RECEIPT_TIMEOUT");
}

function operationState(
  operation: PendingOperationRecord,
  result: UseResult | UseStatusResponse,
  now: string,
  retryResult?: UseResult
): PendingOperationRecord {
  const recovery = retryResult === undefined ? {} : { retryResult };
  if (result.status === "SUCCEEDED")
    return {
      ...operation,
      ...recovery,
      state: "SUCCEEDED",
      useId: result.useId,
      result,
      updatedAt: now,
    };
  if (result.status === "FAILED_FINAL")
    return {
      ...operation,
      ...recovery,
      state: "FAILED",
      useId: result.useId,
      result,
      updatedAt: now,
    };
  return {
    ...operation,
    ...recovery,
    state: "PENDING",
    useId: result.useId,
    updatedAt: now,
  };
}

async function markOutcomeUnknown(operation: PendingOperationRecord): Promise<void> {
  await saveOperation({
    ...operation,
    state: "OUTCOME_UNKNOWN",
    updatedAt: new Date().toISOString(),
  });
}

async function markDefinitiveFailure(
  operation: PendingOperationRecord,
  failureCode: string
): Promise<void> {
  await saveOperation({
    ...operation,
    state: "FAILED",
    failureCode,
    updatedAt: new Date().toISOString(),
  });
  if (operation.walletCredentialId)
    await clearPreparedOperation(operation.walletCredentialId, operation.operationId);
}

async function saveAcceptedState(
  operation: PendingOperationRecord,
  result: UseResult | UseStatusResponse,
  retryResult?: UseResult
): Promise<PendingOperationRecord> {
  const next = operationState(operation, result, new Date().toISOString(), retryResult);
  if (next.state === "SUCCEEDED" || next.state === "FAILED") await completeAcceptedOperation(next);
  else await saveOperation(next);
  return next;
}

async function refreshExpiredPresentation(
  client: ApiClient,
  operation: PendingOperationRecord
): Promise<PendingOperationRecord> {
  const credential = await readCredential();
  if (!credential || !operationMatchesCredential(operation, credential))
    throw new Error("WALLET_CREDENTIAL_MISMATCH");
  let challenge;
  try {
    challenge = await client.createChallenge({
      policyId: credential.policy.id,
      policyVersion: credential.policy.version,
      audience: credential.policy.audience,
      operationId: operation.operationId,
      action: operation.action,
    });
  } catch (error) {
    if (error instanceof ApiResponseError && error.status < 500) {
      await markDefinitiveFailure(operation, error.code);
      throw error;
    }
    await markOutcomeUnknown(operation);
    throw new WalletOutcomeUnknownError();
  }
  const intentDigest = await computeIntentDigest(
    {
      protocolVersion: "AnonLimit/v1",
      operationId: operation.operationId,
      method: "POST",
      resource: "/v1/verifier/presentations",
      action: operation.action,
    },
    sha256Hex
  );
  const envelope = await createSimulatedHolder().createPresentation({
    credential: credential.credential,
    hiddenSlot: operation.hiddenSlot,
    operationId: operation.operationId,
    action: operation.action,
    challenge,
  });
  if (intentDigest !== operation.intentDigest || envelope.nullifier !== operation.nullifier)
    throw new Error("RECOVERY_BINDING_MISMATCH");
  const refreshed: PendingOperationRecord = {
    ...operation,
    challenge,
    envelope,
    serializedEnvelope: JSON.stringify(envelope),
    state: "PENDING",
    updatedAt: new Date().toISOString(),
  };
  await saveOperation(refreshed);
  return refreshed;
}

function assertSubmissionSemantics(result: UseResult): void {
  if (result.replayed) {
    if (result.usageDelta !== 0 || result.actionDelta !== 0)
      throw new Error("RETRY_PROTOCOL_INVALID");
    return;
  }
  // A resend can be the first request that reaches the verifier. The strict response schema has
  // already checked the status-specific action delta; this guards the one reserved use delta.
  if (result.usageDelta !== 1) throw new Error("RETRY_PROTOCOL_INVALID");
}

async function submitStoredOperation(
  client: ApiClient,
  initial: PendingOperationRecord
): Promise<{ readonly operation: PendingOperationRecord; readonly result: UseResult }> {
  let operation = initial;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const serializedEnvelope =
      typeof operation.serializedEnvelope === "string"
        ? operation.serializedEnvelope
        : JSON.stringify(operation.envelope);
    try {
      const result = await client.submitSerializedPresentation(
        serializedEnvelope,
        operation.operationId
      );
      assertSubmissionSemantics(result);
      return { operation, result };
    } catch (error) {
      if (error instanceof ApiResponseError && error.status < 500) {
        if (error.code === "CHALLENGE_EXPIRED" && attempt === 0) {
          operation = await refreshExpiredPresentation(client, operation);
          continue;
        }
        await markDefinitiveFailure(operation, error.code);
        throw error;
      }
      if (error instanceof WalletOutcomeUnknownError) throw error;
      await markOutcomeUnknown(operation);
      throw new WalletOutcomeUnknownError();
    }
  }
  throw new Error("RETRY_PROTOCOL_INVALID");
}

export async function performWalletUse(client: ApiClient): Promise<WalletSnapshot> {
  const wallet = await loadWallet();
  const current = wallet.credential;
  if (!current) throw new Error("CREDENTIAL_REQUIRED");
  if (isUnresolved(wallet.operation)) throw new Error("RETRY_REQUIRED");
  if (current.nextSlot >= current.policy.maxUses) throw new Error("LIMIT_REACHED");
  const id = current.preparedOperationId ?? operationId();
  const challenge = await client.createChallenge({
    policyId: current.policy.id,
    policyVersion: current.policy.version,
    audience: current.policy.audience,
    operationId: id,
    action: ACTION,
  });
  const intentDigest = await computeIntentDigest(
    {
      protocolVersion: "AnonLimit/v1",
      operationId: id,
      method: "POST",
      resource: "/v1/verifier/presentations",
      action: ACTION,
    },
    sha256Hex
  );
  const envelope = await createSimulatedHolder().createPresentation({
    credential: current.credential,
    hiddenSlot: current.nextSlot,
    operationId: id,
    action: ACTION,
    challenge,
  });
  const serializedEnvelope = JSON.stringify(envelope);
  let pending: PendingOperationRecord = {
    operationId: id,
    walletCredentialId: current.walletCredentialId,
    demoRunId: current.demoRunId,
    dropAckArmed: current.preparedOperationId === id,
    hiddenSlot: current.nextSlot,
    action: ACTION,
    intentDigest,
    nullifier: envelope.nullifier,
    envelope,
    serializedEnvelope,
    challenge,
    state: "PENDING",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  // The exact wire body is durable before its first network send.
  await saveOperation(pending);
  let submitted: UseResult;
  try {
    submitted = await client.submitSerializedPresentation(serializedEnvelope, id);
  } catch (error) {
    if (error instanceof ApiResponseError && error.status < 500) {
      await saveOperation({
        ...pending,
        state: "FAILED",
        failureCode: error.code,
        updatedAt: new Date().toISOString(),
      });
      await clearPreparedOperation(current.walletCredentialId, id);
      throw error;
    }
    await markOutcomeUnknown(pending);
    throw new WalletOutcomeUnknownError();
  }
  pending = await saveAcceptedState(pending, submitted);
  if (submitted.status !== "ACCEPTED_PENDING_ACTION") return loadWallet();
  let final: UseStatusResponse | UseResult = submitted;
  try {
    if (submitted.status === "ACCEPTED_PENDING_ACTION")
      final = await waitForResult(client, submitted.useId);
  } catch {
    await markOutcomeUnknown(pending);
    throw new WalletOutcomeUnknownError();
  }
  await saveAcceptedState(pending, final);
  return loadWallet();
}

export async function retryLastWalletUse(
  client: ApiClient,
  onProgress?: WalletProgressListener
): Promise<WalletSnapshot> {
  let operation = (await loadWallet()).operation;
  if (!operation || !isUnresolved(operation)) throw new Error("NO_RETRY_AVAILABLE");
  const submitted = await submitStoredOperation(client, operation);
  const retry = submitted.result;
  operation = await saveAcceptedState(submitted.operation, retry, retry);
  if (onProgress) onProgress(await loadWallet());
  if (retry.status !== "ACCEPTED_PENDING_ACTION") return loadWallet();
  let final: UseResult | UseStatusResponse = retry;
  try {
    if (retry.status === "ACCEPTED_PENDING_ACTION")
      final = await waitForResult(client, retry.useId);
  } catch {
    await markOutcomeUnknown(operation);
    throw new WalletOutcomeUnknownError();
  }
  await saveAcceptedState(operation, final, retry);
  return loadWallet();
}

export async function resumePendingWalletUse(client: ApiClient): Promise<WalletSnapshot> {
  const operation = (await loadWallet()).operation;
  if (!operation || operation.state !== "PENDING" || !operation.useId) return loadWallet();
  let result: UseStatusResponse;
  try {
    result = await waitForResult(client, operation.useId);
  } catch {
    await markOutcomeUnknown(operation);
    return loadWallet();
  }
  await saveAcceptedState(operation, result);
  return loadWallet();
}

export function actionLabel(): string {
  return canonicalJson(ACTION);
}
