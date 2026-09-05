import { canonicalJson } from "./canonical-json.js";
import { assertPolicy, type Policy } from "./policy.js";
/** Only issuer-authorized server policy fields affect the allowance domain. */
export function canonicalQuotaScope(policy: Policy): string {
  assertPolicy(policy);
  return canonicalJson({
    issuerKeyId: policy.issuerKeyId,
    policyId: policy.id,
    policyVersion: policy.version,
    verifierAudience: policy.audience,
    quotaWindowId: policy.quotaWindowId,
  });
}
