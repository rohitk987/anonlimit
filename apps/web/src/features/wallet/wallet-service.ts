import {
  type Action,
  type IssuanceResponse,
  type UseResult,
  type UseStatusResponse,
} from "@anonlimit/contracts";
import { canonicalJson, computeIntentDigest } from "@anonlimit/domain";
import { createSimulatedHolder, sha256Hex } from "@anonlimit/crypto/holder";
import type { ApiClient } from "../../lib/api-client.js";
import {
  readCredential,
  readLatestOperation,
  saveCredential,
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

export async function loadWallet(): Promise<WalletSnapshot> {
  const [credential, operation] = await Promise.all([readCredential(), readLatestOperation()]);
  return { credential, operation };
}

export async function issueWalletCredential(client: ApiClient): Promise<WalletSnapshot> {
  const response: IssuanceResponse = await client.issueCredential(POLICY_ID, POLICY_VERSION);
  const record: WalletCredentialRecord = {
    id: "active",
    credential: response.credential,
    demoRunId: response.demoRunId,
    policy: response.policy,
    nextSlot: 0,
    updatedAt: new Date().toISOString(),
  };
  await saveCredential(record);
  return loadWallet();
}

function operationId(): string {
  return globalThis.crypto.randomUUID();
}

async function waitForResult(client: ApiClient, useId: string): Promise<UseStatusResponse> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const status = await client.getUseStatus(useId);
    if (status.status !== "ACCEPTED_PENDING_ACTION") return status;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }
  throw new Error("RECEIPT_TIMEOUT");
}

function operationState(
  operation: PendingOperationRecord,
  result: UseResult | UseStatusResponse,
  now: string
): PendingOperationRecord {
  if (result.status === "SUCCEEDED")
    return { ...operation, state: "SUCCEEDED", useId: result.useId, result, updatedAt: now };
  if (result.status === "FAILED_FINAL")
    return { ...operation, state: "FAILED", useId: result.useId, result, updatedAt: now };
  return { ...operation, state: "PENDING", useId: result.useId, updatedAt: now };
}

export async function performWalletUse(client: ApiClient): Promise<WalletSnapshot> {
  const current = await readCredential();
  if (!current) throw new Error("CREDENTIAL_REQUIRED");
  if (current.nextSlot >= current.policy.maxUses) throw new Error("LIMIT_REACHED");
  const id = operationId();
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
  const pending: PendingOperationRecord = {
    operationId: id,
    hiddenSlot: current.nextSlot,
    action: ACTION,
    intentDigest,
    nullifier: envelope.nullifier,
    envelope,
    challenge,
    state: "PENDING",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  // This write deliberately happens before the first presentation request.
  await saveOperation(pending);
  const submitted = await client.submitPresentation(envelope);
  let final: UseStatusResponse | UseResult = submitted;
  if (submitted.status === "ACCEPTED_PENDING_ACTION")
    final = await waitForResult(client, submitted.useId);
  await saveOperation(operationState(pending, final, new Date().toISOString()));
  if (final.status === "SUCCEEDED") {
    await saveCredential({
      ...current,
      nextSlot: current.nextSlot + 1,
      updatedAt: new Date().toISOString(),
    });
  }
  return loadWallet();
}

export async function resumePendingWalletUse(client: ApiClient): Promise<WalletSnapshot> {
  const operation = await readLatestOperation();
  if (!operation || operation.state !== "PENDING") return loadWallet();
  let result: UseResult | UseStatusResponse;
  if (operation.useId) result = await waitForResult(client, operation.useId);
  else result = await client.submitPresentation(operation.envelope);
  if (result.status === "ACCEPTED_PENDING_ACTION")
    result = await waitForResult(client, result.useId);
  await saveOperation(operationState(operation, result, new Date().toISOString()));
  if (result.status === "SUCCEEDED") {
    const credential = await readCredential();
    if (credential && credential.nextSlot <= operation.hiddenSlot)
      await saveCredential({
        ...credential,
        nextSlot: operation.hiddenSlot + 1,
        updatedAt: new Date().toISOString(),
      });
  }
  return loadWallet();
}

export function actionLabel(): string {
  return canonicalJson(ACTION);
}
