// Serializers must pick these fields before validating their result. Never spread source objects.
export const publicErrorFields = ["code", "traceId", "usageDelta", "actionDelta"] as const;
export const protocolEventFields = [
  "sequence",
  "occurredAt",
  "event",
  "traceId",
  "demoRunId",
  "policyId",
  "policyVersion",
  "fromState",
  "toState",
  "decisionCode",
  "usageDelta",
  "actionDelta",
  "latencyMs",
  "maskedUseRef",
] as const;
export const evidenceUseFields = [
  "maskedUseRef",
  "intentDigest",
  "status",
  "receiptId",
  "actionKey",
] as const;
export const receiptFields = ["receiptId", "useId", "actionKey", "status", "committedAt"] as const;
