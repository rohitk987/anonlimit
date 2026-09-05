import { canonicalJson } from "./canonical-json.js";
import { DomainError } from "./errors.js";
import { assertPolicy, isoTimestamp, PROTOCOL_VERSION, validText, type Policy } from "./policy.js";
import { canonicalQuotaScope } from "./quota-scope.js";

export type Sha256Hex = (input: string) => Promise<string>;
export type HmacSha256Hex = (key: string, input: string) => Promise<string>;
export interface Action {
  readonly type: "REDEEM_DEMO_BENEFIT";
  readonly payload: { readonly benefitCode: string };
}
export interface Intent {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly operationId: string;
  readonly method: string;
  readonly resource: string;
  readonly action: Action;
}
function assertHex(hex: string): string {
  if (!/^[a-f0-9]{64}$/u.test(hex)) throw new DomainError("INVALID_HASH_OUTPUT");
  return hex;
}
function assertDigest(value: string): void {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) throw new DomainError("INVALID_INTENT");
}
function assertUuid(value: string): void {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value))
    throw new DomainError("INVALID_INTENT");
}
export function canonicalAction(action: Action): string {
  if (
    !action ||
    typeof action !== "object" ||
    !action.payload ||
    typeof action.payload !== "object" ||
    action.type !== "REDEEM_DEMO_BENEFIT" ||
    !validText(action.payload.benefitCode) ||
    !["HACKATHON", "WORKSHOP"].includes(action.payload.benefitCode) ||
    Object.keys(action).some((key) => key !== "type" && key !== "payload") ||
    Object.keys(action.payload).some((key) => key !== "benefitCode")
  )
    throw new DomainError("INVALID_ACTION");
  return canonicalJson(action);
}
async function digest(domain: string, value: unknown, sha256Hex: Sha256Hex): Promise<string> {
  return `sha256:${assertHex(await sha256Hex(canonicalJson({ domain, value })))}`;
}
export async function computePolicyDigest(policy: Policy, sha256Hex: Sha256Hex): Promise<string> {
  assertPolicy(policy);
  const {
    id,
    version,
    issuerKeyId,
    audience,
    maxUses,
    status,
    quotaWindowId,
    validFrom,
    validUntil,
  } = policy;
  return digest(
    `${PROTOCOL_VERSION}/policy`,
    { id, version, issuerKeyId, audience, maxUses, status, quotaWindowId, validFrom, validUntil },
    sha256Hex
  );
}
export async function computeScopeHash(policy: Policy, sha256Hex: Sha256Hex): Promise<string> {
  return digest(`${PROTOCOL_VERSION}/scope`, canonicalQuotaScope(policy), sha256Hex);
}
export async function computeIntentDigest(intent: Intent, sha256Hex: Sha256Hex): Promise<string> {
  assertUuid(intent.operationId);
  if (
    intent.protocolVersion !== PROTOCOL_VERSION ||
    !/^[A-Z]{3,16}$/u.test(intent.method) ||
    !/^\/[a-zA-Z0-9/_-]{1,255}$/u.test(intent.resource)
  )
    throw new DomainError("INVALID_INTENT");
  canonicalAction(intent.action);
  return digest(
    `${PROTOCOL_VERSION}/intent`,
    {
      protocolVersion: intent.protocolVersion,
      operationId: intent.operationId,
      method: intent.method,
      resource: intent.resource,
      action: intent.action,
    },
    sha256Hex
  );
}
export interface ProofContextInput {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly scope: string;
  readonly intentDigest: string;
  readonly challengeId: string;
  readonly nonce: string;
  readonly expiresAt: string;
  readonly policyDigest: string;
  readonly demoRunId: string;
}
export async function computeProofContext(
  input: ProofContextInput,
  sha256Hex: Sha256Hex
): Promise<string> {
  assertUuid(input.challengeId);
  assertUuid(input.demoRunId);
  assertDigest(input.intentDigest);
  assertDigest(input.policyDigest);
  if (
    input.protocolVersion !== PROTOCOL_VERSION ||
    !input.scope ||
    !/^[a-f0-9]{64}$/u.test(input.nonce) ||
    !Number.isFinite(isoTimestamp(input.expiresAt))
  )
    throw new DomainError("INVALID_INTENT");
  const {
    protocolVersion,
    scope,
    intentDigest,
    challengeId,
    nonce,
    expiresAt,
    policyDigest,
    demoRunId,
  } = input;
  return digest(
    `${PROTOCOL_VERSION}/proof-context`,
    {
      protocolVersion,
      scope,
      intentDigest,
      challengeId,
      nonce,
      expiresAt,
      policyDigest,
      demoRunId,
    },
    sha256Hex
  );
}
async function keyedDigest(
  domain: string,
  value: unknown,
  key: string,
  hmacSha256Hex: HmacSha256Hex
): Promise<string> {
  if (key.length < 32) throw new DomainError("INVALID_INTENT");
  return `hmac-sha256:${assertHex(await hmacSha256Hex(key, canonicalJson({ domain, value })))}`;
}
export async function deriveNullifierKey(
  input: { readonly scopeHash: string; readonly rawNullifier: string },
  ledgerKey: string,
  hmacSha256Hex: HmacSha256Hex
): Promise<string> {
  assertDigest(input.scopeHash);
  if (!/^[a-f0-9]{64}$/u.test(input.rawNullifier)) throw new DomainError("INVALID_INTENT");
  return keyedDigest(
    `${PROTOCOL_VERSION}/ledger-nullifier`,
    { scopeHash: input.scopeHash, rawNullifier: input.rawNullifier },
    ledgerKey,
    hmacSha256Hex
  );
}
export async function deriveActionKey(
  input: { readonly useId: string; readonly intentDigest: string },
  actionKey: string,
  hmacSha256Hex: HmacSha256Hex
): Promise<string> {
  assertUuid(input.useId);
  assertDigest(input.intentDigest);
  return keyedDigest(
    `${PROTOCOL_VERSION}/external-action`,
    { useId: input.useId, intentDigest: input.intentDigest },
    actionKey,
    hmacSha256Hex
  );
}
