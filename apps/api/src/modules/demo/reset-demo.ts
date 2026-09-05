import { randomUUID } from "node:crypto";
import {
  demoResetResponseSchema,
  uuidSchema,
  type DemoResetResponse,
  type Policy,
} from "@anonlimit/contracts";
import { DemoRunResetConflictError } from "@anonlimit/db/verifier";
import { ProtocolPublicError } from "../protocol/protocol-service.js";
import type { ActionSimulatorResetClient } from "../internal/action-simulator-client.js";

export interface DemoResetRepository {
  getActiveDemoRun(): Promise<{ readonly demoRunId: string } | null>;
  resetDemoRun(input: {
    readonly expectedDemoRunId: string;
    readonly newDemoRunId: string;
    readonly eventId: string;
    readonly traceId: string;
    readonly policyId: string;
    readonly policyVersion: number;
    readonly resetAt: string;
  }): Promise<{
    readonly demoRunId: string;
    readonly resetAt: string;
    readonly policy: Policy;
  }>;
}

export interface DemoResetController {
  reset(traceId: string): Promise<DemoResetResponse>;
}

export interface DemoResetControllerOptions {
  readonly repository: DemoResetRepository;
  readonly actionClient: ActionSimulatorResetClient;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly now?: () => number;
  readonly randomUuid?: () => string;
}

function checkedUuid(randomUuid: () => string): string {
  const parsed = uuidSchema.safeParse(randomUuid());
  if (!parsed.success) throw new Error("RANDOMNESS_INVALID");
  return parsed.data;
}

function resetTimestamp(now: () => number): string {
  const time = now();
  if (!Number.isFinite(time)) throw new Error("CLOCK_INVALID");
  return new Date(time).toISOString();
}

/**
 * A reset first fences the Action Simulator's selected run, then clears the same verifier run in
 * one database transaction. A failed sink call leaves the verifier run intact, so retrying the
 * public reset can safely resume it without choosing a client-supplied run identifier.
 */
export function createDemoResetController(
  options: DemoResetControllerOptions
): DemoResetController {
  const now = options.now ?? Date.now;
  const randomUuid = options.randomUuid ?? randomUUID;
  let inFlight: Promise<DemoResetResponse> | undefined;

  const performReset = async (traceId: string): Promise<DemoResetResponse> => {
    if (!uuidSchema.safeParse(traceId).success) throw new Error("TRACE_ID_INVALID");
    const activeRun = await options.repository.getActiveDemoRun();
    if (!activeRun) throw new ProtocolPublicError("DEMO_DISABLED");

    try {
      await options.actionClient.resetDemoRun(activeRun.demoRunId);
    } catch {
      throw new ProtocolPublicError("SERVICE_UNAVAILABLE");
    }

    try {
      const reset = await options.repository.resetDemoRun({
        expectedDemoRunId: activeRun.demoRunId,
        newDemoRunId: checkedUuid(randomUuid),
        eventId: checkedUuid(randomUuid),
        traceId,
        policyId: options.policyId,
        policyVersion: options.policyVersion,
        resetAt: resetTimestamp(now),
      });
      return demoResetResponseSchema.parse({
        protocolVersion: "AnonLimit/v1",
        demoRunId: reset.demoRunId,
        resetAt: reset.resetAt,
        policy: reset.policy,
      });
    } catch (error) {
      if (error instanceof DemoRunResetConflictError)
        throw new ProtocolPublicError("SERVICE_UNAVAILABLE");
      throw error;
    }
  };

  return Object.freeze({
    async reset(traceId: string) {
      if (inFlight) return inFlight;
      const current = performReset(traceId);
      inFlight = current;
      try {
        return await current;
      } finally {
        if (inFlight === current) inFlight = undefined;
      }
    },
  });
}
