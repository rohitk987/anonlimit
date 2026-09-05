import { randomUUID } from "node:crypto";
import { uuidSchema, type UseResult } from "@anonlimit/contracts";
import type { BoundTestAdapter } from "@anonlimit/crypto/audit";
import {
  ProtocolPublicError,
  type ProtocolRepository,
  type ProtocolResponse,
  type ProtocolService,
} from "../protocol/protocol-service.js";

export interface DemoBoundaryController {
  attemptFourthUse(traceId: string): Promise<ProtocolResponse<UseResult>>;
}

export interface DemoBoundaryControllerOptions {
  readonly repository: Pick<ProtocolRepository, "getActiveDemoRun">;
  readonly protocol: Pick<ProtocolService, "getPolicy" | "createChallenge" | "present">;
  readonly probeAdapter: BoundTestAdapter;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly randomUuid?: () => string;
}

/**
 * Creates an authenticated slot-L simulator probe and submits it through the ordinary verifier.
 * The request contains no credential, slot, proof, client-selected run, or policy. The transient
 * presentation is neither returned nor persisted here. Only the protocol verifier decides whether
 * it is rejected; an unexpected acceptance is returned truthfully for the UI/evidence to flag.
 */
export function createDemoBoundaryController(
  options: DemoBoundaryControllerOptions
): DemoBoundaryController {
  const randomUuid = options.randomUuid ?? randomUUID;
  return Object.freeze({
    async attemptFourthUse(traceId: string) {
      if (!uuidSchema.safeParse(traceId).success) throw new Error("TRACE_ID_INVALID");
      const run = await options.repository.getActiveDemoRun();
      if (!run) throw new ProtocolPublicError("DEMO_DISABLED");
      const { body: policy } = await options.protocol.getPolicy({
        id: options.policyId,
        version: String(options.policyVersion),
      });
      const operationId = uuidSchema.parse(randomUuid());
      const action = {
        type: "REDEEM_DEMO_BENEFIT",
        payload: { benefitCode: "HACKATHON" },
      } as const;
      const { body: challenge } = await options.protocol.createChallenge({
        protocolVersion: "AnonLimit/v1",
        policyId: policy.id,
        policyVersion: policy.version,
        audience: policy.audience,
        operationId,
        action,
      });
      let presentation;
      try {
        presentation = await options.probeAdapter.createOutOfRangePresentation({
          policy,
          demoRunId: run.demoRunId,
          operationId,
          action,
          challenge,
        });
      } catch {
        // A broken probe is unavailable, not evidence of a verifier rejection.
        throw new ProtocolPublicError("SERVICE_UNAVAILABLE");
      }
      return options.protocol.present(presentation, traceId);
    },
  });
}
