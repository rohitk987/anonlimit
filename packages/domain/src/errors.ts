export const DOMAIN_ERROR_CODES = [
  "INVALID_CANONICAL_VALUE",
  "INVALID_ACTION",
  "INVALID_INTENT",
  "INVALID_HASH_OUTPUT",
  "POLICY_REJECTED",
  "CHALLENGE_EXPIRED",
  "CHALLENGE_REJECTED",
  "INVALID_STATE_TRANSITION",
  "LEDGER_INCONSISTENT",
  "INVALID_EVIDENCE",
  "NULLIFIER_REUSE_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
] as const;
export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

/** Only constant codes are exposed; never attach input, causes, or credentials. */
export class DomainError extends Error {
  readonly code: DomainErrorCode;
  constructor(code: DomainErrorCode) {
    super(code);
    this.name = "DomainError";
    this.code = code;
  }
}
export type Result<T, E extends string = DomainErrorCode> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: E };
