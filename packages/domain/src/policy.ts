import { DomainError } from "./errors.js";

export const PROTOCOL_VERSION = "AnonLimit/v1" as const;
export interface Policy {
  readonly id: string;
  readonly version: number;
  readonly issuerKeyId: string;
  readonly audience: string;
  readonly maxUses: number;
  readonly status: "ACTIVE" | "DISABLED";
  readonly quotaWindowId: string;
  readonly validFrom: string;
  readonly validUntil: string;
}
export function validText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value.isWellFormed() &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}
export function isoTimestamp(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value)) return Number.NaN;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return Number.NaN;
  const normalized = new Date(timestamp).toISOString();
  return normalized.slice(0, 19) === value.slice(0, 19) ? timestamp : Number.NaN;
}
export function assertPolicy(policy: Policy): void {
  const from = isoTimestamp(policy.validFrom);
  const until = isoTimestamp(policy.validUntil);
  if (
    ![policy.id, policy.issuerKeyId, policy.audience, policy.quotaWindowId].every((value) =>
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
    ) ||
    !Number.isSafeInteger(policy.version) ||
    policy.version < 1 ||
    policy.version > 2_147_483_647 ||
    !Number.isSafeInteger(policy.maxUses) ||
    policy.maxUses < 1 ||
    policy.maxUses > 100 ||
    (policy.status !== "ACTIVE" && policy.status !== "DISABLED") ||
    !Number.isFinite(from) ||
    !Number.isFinite(until) ||
    from >= until
  )
    throw new DomainError("POLICY_REJECTED");
}
/** Freshness is used only for new acceptance, after exact-retry resolution. */
export function assertPolicyFresh(policy: Policy, now: number): void {
  assertPolicy(policy);
  if (
    policy.status !== "ACTIVE" ||
    !Number.isFinite(now) ||
    now < isoTimestamp(policy.validFrom) ||
    now >= isoTimestamp(policy.validUntil)
  )
    throw new DomainError("POLICY_REJECTED");
}
export interface PolicyReference {
  readonly policyId: string;
  readonly policyVersion: number;
  readonly issuerKeyId: string;
  readonly audience: string;
  readonly quotaWindowId: string;
}
export function assertPolicyBinding(policy: Policy, reference: PolicyReference): void {
  assertPolicy(policy);
  if (
    policy.id !== reference.policyId ||
    policy.version !== reference.policyVersion ||
    policy.issuerKeyId !== reference.issuerKeyId ||
    policy.audience !== reference.audience ||
    policy.quotaWindowId !== reference.quotaWindowId
  )
    throw new DomainError("POLICY_REJECTED");
}
export interface ChallengeBinding {
  readonly challengeId: string;
  readonly nonce: string;
  readonly expiresAt: string;
  readonly policyDigest: string;
  readonly demoRunId: string;
  readonly scopeHash: string;
  readonly operationId: string;
  readonly intentDigest: string;
}
export function assertChallengeFresh(
  challenge: ChallengeBinding & { readonly state: "ISSUED" | "CONSUMED" },
  expected: ChallengeBinding,
  now: number
): void {
  const keys: readonly (keyof ChallengeBinding)[] = [
    "challengeId",
    "nonce",
    "expiresAt",
    "policyDigest",
    "demoRunId",
    "scopeHash",
    "operationId",
    "intentDigest",
  ];
  if (challenge.state !== "ISSUED" || keys.some((key) => challenge[key] !== expected[key]))
    throw new DomainError("CHALLENGE_REJECTED");
  const expires = isoTimestamp(challenge.expiresAt);
  if (!Number.isFinite(expires) || !Number.isFinite(now))
    throw new DomainError("CHALLENGE_REJECTED");
  if (now >= expires) throw new DomainError("CHALLENGE_EXPIRED");
}
