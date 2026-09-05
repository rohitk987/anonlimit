import { createHash, randomUUID } from "node:crypto";
import {
  demoFaultResponseSchema,
  type DemoFaultResponse,
  type UseResult,
  type UseStatusResponse,
} from "@anonlimit/contracts";
import { ProtocolPublicError } from "../protocol/protocol-service.js";
import { waitForOutcome, type OutcomeWaitOptions } from "../presentations/wait-for-outcome.js";

export interface LostAckFaultRepository {
  armDropNextAck(operationId: string): Promise<{
    readonly demoRunId: string;
    readonly operationId: string;
  }>;
  isDropNextAckArmed(operationId: string): Promise<boolean>;
  cancelDropNextAck(operationId: string): Promise<void>;
  getUseStatus(useId: string): Promise<UseStatusResponse | null>;
  consumeDropNextAckAfterSuccess(input: {
    readonly eventId: string;
    readonly traceId: string;
    readonly operationId: string;
    readonly useId: string;
    readonly maskedUseRef: string;
  }): Promise<boolean>;
}

export interface LostAckFaultController {
  arm(operationId: string): Promise<DemoFaultResponse>;
  consumeAfterDurableResult(input: {
    readonly operationId: string;
    readonly traceId: string;
    readonly response: UseResult;
  }): Promise<boolean>;
}

export interface LostAckFaultControllerOptions extends OutcomeWaitOptions {
  readonly randomUuid?: () => string;
}

function maskedUseReference(useId: string): string {
  return `use_${createHash("sha256").update(useId).digest("hex").slice(0, 12)}`;
}

export function createLostAckFaultController(
  repository: LostAckFaultRepository,
  options: LostAckFaultControllerOptions = {}
): LostAckFaultController {
  const randomUuid = options.randomUuid ?? randomUUID;
  return Object.freeze({
    async arm(operationId: string) {
      const armed = await repository.armDropNextAck(operationId);
      return demoFaultResponseSchema.parse({
        ...armed,
        fault: "DROP_NEXT_ACK_AFTER_COMMIT",
        armed: true,
      });
    },

    async consumeAfterDurableResult(input: {
      readonly operationId: string;
      readonly traceId: string;
      readonly response: UseResult;
    }) {
      // A concurrent exact replay must not cancel the fault while the original accepted request
      // is waiting for durable completion.
      if (input.response.replayed || input.response.status !== "ACCEPTED_PENDING_ACTION")
        return false;
      if (!(await repository.isDropNextAckArmed(input.operationId))) return false;

      let terminal: UseStatusResponse | null;
      try {
        terminal = await waitForOutcome(
          () => repository.getUseStatus(input.response.useId),
          options
        );
      } catch (error) {
        await repository.cancelDropNextAck(input.operationId);
        throw error;
      }
      if (terminal?.status !== "SUCCEEDED") {
        await repository.cancelDropNextAck(input.operationId);
        // The use may already be accepted, so a normal acknowledgement would let the wallet treat
        // the armed scenario as complete. Return a recoverable uncertain result after disarming.
        throw new ProtocolPublicError("SERVICE_UNAVAILABLE");
      }
      const consumed = await repository.consumeDropNextAckAfterSuccess({
        eventId: randomUuid(),
        traceId: input.traceId,
        operationId: input.operationId,
        useId: terminal.useId,
        maskedUseRef: maskedUseReference(terminal.useId),
      });
      if (consumed) return true;

      // The durable status and fault row are checked in separate transactions. If the guarded
      // consume loses that race or refuses the row, explicitly clear any matching armed fault.
      await repository.cancelDropNextAck(input.operationId);
      throw new ProtocolPublicError("SERVICE_UNAVAILABLE");
    },
  });
}
