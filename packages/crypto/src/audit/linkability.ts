import { canonicalQuotaScope } from "@anonlimit/domain";
import {
  createBindingVerifier,
  type SimulatorOptions,
  type VerificationInput,
} from "../simulated-provider/server.js";

export type LinkabilityResult =
  | { ok: true; result: "SAME_USE" | "UNLINKABLE"; basis: "SIMULATED_PROVIDER_ASSUMPTION" }
  | { ok: false; code: "PRESENTATION_REJECTED" };
export interface AuditAdapter {
  testLinkability(a: VerificationInput, b: VerificationInput): Promise<LinkabilityResult>;
}

/** Assumption-based simulator oracle, not a proof of real-world anonymity. */
export function createSimulatedAuditor(options: SimulatorOptions): AuditAdapter {
  // Historical accepted proof contexts may be expired; signature/context binding still has to verify.
  const verifyBinding = createBindingVerifier(options, false);
  return {
    async testLinkability(a, b) {
      try {
        const left = structuredClone(a);
        const right = structuredClone(b);
        const results = await Promise.all([verifyBinding(left), verifyBinding(right)]);
        if (results.some((result) => !result.valid))
          return { ok: false, code: "PRESENTATION_REJECTED" };
        const sameUse =
          left.demoRunId === right.demoRunId &&
          canonicalQuotaScope(left.policy) === canonicalQuotaScope(right.policy) &&
          left.presentation.nullifier === right.presentation.nullifier;
        return {
          ok: true,
          result: sameUse ? "SAME_USE" : "UNLINKABLE",
          basis: "SIMULATED_PROVIDER_ASSUMPTION",
        };
      } catch {
        return { ok: false, code: "PRESENTATION_REJECTED" };
      }
    },
  };
}
