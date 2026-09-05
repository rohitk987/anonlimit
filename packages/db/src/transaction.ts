const ACCEPTANCE_UNIQUENESS_CONSTRAINTS = [
  "uq_use_records_challenge",
  "uq_use_records_run_scope_nullifier",
  "uq_use_records_run_scope_operation",
  "uq_use_records_action_key",
  "uq_outbox_events_use_type",
] as const;

export type AcceptanceUniquenessConstraint = (typeof ACCEPTANCE_UNIQUENESS_CONSTRAINTS)[number];

export class AcceptanceUniquenessError extends Error {
  readonly constraint: AcceptanceUniquenessConstraint;

  constructor(constraint: AcceptanceUniquenessConstraint) {
    super("ACCEPTANCE_UNIQUENESS_CONFLICT");
    this.name = "AcceptanceUniquenessError";
    this.constraint = constraint;
  }
}

/** A locked acceptance candidate was committed by another transaction after the initial lookup. */
export class AcceptanceRaceLostError extends Error {
  constructor() {
    super("ACCEPTANCE_RACE_LOST");
    this.name = "AcceptanceRaceLostError";
  }
}

export type AcceptancePreconditionCode =
  "POLICY_REJECTED" | "CHALLENGE_REJECTED" | "CHALLENGE_EXPIRED";

export class AcceptancePreconditionError extends Error {
  readonly code: AcceptancePreconditionCode;

  constructor(code: AcceptancePreconditionCode) {
    super(code);
    this.name = "AcceptancePreconditionError";
    this.code = code;
  }
}

function databaseFailure(value: unknown): { code?: unknown; constraint?: unknown } {
  if (!value || typeof value !== "object") return {};
  const descriptorCode = Object.getOwnPropertyDescriptor(value, "code");
  const descriptorConstraint = Object.getOwnPropertyDescriptor(value, "constraint");
  return {
    code: descriptorCode && "value" in descriptorCode ? descriptorCode.value : undefined,
    constraint:
      descriptorConstraint && "value" in descriptorConstraint
        ? descriptorConstraint.value
        : undefined,
  };
}

/** PostgreSQL conflicts are classified only by SQLSTATE and the migration-owned constraint name. */
export function acceptanceUniquenessError(error: unknown): AcceptanceUniquenessError | null {
  const failure = databaseFailure(error);
  if (failure.code !== "23505" || typeof failure.constraint !== "string") return null;
  const constraint = ACCEPTANCE_UNIQUENESS_CONSTRAINTS.find(
    (candidate) => candidate === failure.constraint
  );
  return constraint ? new AcceptanceUniquenessError(constraint) : null;
}
