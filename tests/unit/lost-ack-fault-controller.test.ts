import { describe, expect, it } from "vitest";
import type { UseResult, UseStatusResponse } from "@anonlimit/contracts";
import {
  createLostAckFaultController,
  type LostAckFaultRepository,
} from "../../apps/api/src/modules/demo/fault-controller.js";

const OPERATION_ID = "00000000-0000-4000-8000-000000000001";
const USE_ID = "00000000-0000-4000-8000-000000000002";
const EVENT_ID = "00000000-0000-4000-8000-000000000003";
const TRACE_ID = "00000000-0000-4000-8000-000000000004";

const NEW_PENDING: UseResult = {
  useId: USE_ID,
  status: "ACCEPTED_PENDING_ACTION",
  code: "ACCEPTED_PENDING_ACTION",
  replayed: false,
  usageDelta: 1,
  actionDelta: 0,
};

const PENDING: UseStatusResponse = {
  useId: USE_ID,
  status: "ACCEPTED_PENDING_ACTION",
};

const FAILED: UseStatusResponse = {
  useId: USE_ID,
  status: "FAILED_FINAL",
  failureCode: "ACTION_FAILED_FINAL",
};

const SUCCEEDED: UseStatusResponse = {
  useId: USE_ID,
  status: "SUCCEEDED",
  receipt: {
    receiptId: "00000000-0000-4000-8000-000000000005",
    useId: USE_ID,
    actionKey: `hmac-sha256:${"a".repeat(64)}`,
    status: "COMMITTED",
    committedAt: "2026-09-05T18:00:00.000Z",
  },
};

interface FakeFaultRepository extends LostAckFaultRepository {
  readonly state: {
    armed: boolean;
    cancelCalls: number;
    consumeCalls: number;
  };
}

function fakeRepository(input: {
  readStatus: () => Promise<UseStatusResponse | null>;
  consume?: () => boolean;
}): FakeFaultRepository {
  const state = { armed: true, cancelCalls: 0, consumeCalls: 0 };
  return {
    state,
    async armDropNextAck(operationId) {
      state.armed = true;
      return { demoRunId: EVENT_ID, operationId };
    },
    async isDropNextAckArmed(operationId) {
      return state.armed && operationId === OPERATION_ID;
    },
    async cancelDropNextAck(operationId) {
      if (operationId === OPERATION_ID) {
        state.cancelCalls += 1;
        state.armed = false;
      }
    },
    getUseStatus: input.readStatus,
    async consumeDropNextAckAfterSuccess() {
      state.consumeCalls += 1;
      const consumed = input.consume?.() ?? true;
      if (consumed) state.armed = false;
      return consumed;
    },
  };
}

function request(response: UseResult = NEW_PENDING) {
  return { operationId: OPERATION_ID, traceId: TRACE_ID, response };
}

describe("lost acknowledgement fault lifecycle", () => {
  it("cancels an armed fault when durable success misses the bounded deadline", async () => {
    const repository = fakeRepository({ readStatus: async () => PENDING });
    let now = 0;
    const controller = createLostAckFaultController(repository, {
      timeoutMs: 25,
      pollIntervalMs: 10,
      now: () => now,
      delay: async (milliseconds) => {
        now += milliseconds;
      },
      randomUuid: () => EVENT_ID,
    });

    await expect(controller.consumeAfterDurableResult(request())).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      statusCode: 503,
    });
    expect(repository.state).toEqual({ armed: false, cancelCalls: 1, consumeCalls: 0 });
  });

  it("cancels an armed fault when the use reaches a non-success terminal state", async () => {
    const repository = fakeRepository({ readStatus: async () => FAILED });
    const controller = createLostAckFaultController(repository, { randomUuid: () => EVENT_ID });

    await expect(controller.consumeAfterDurableResult(request())).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      statusCode: 503,
    });
    expect(repository.state).toEqual({ armed: false, cancelCalls: 1, consumeCalls: 0 });
  });

  it("cancels when guarded durable consumption declines the armed fault", async () => {
    const repository = fakeRepository({
      readStatus: async () => SUCCEEDED,
      consume: () => false,
    });
    const controller = createLostAckFaultController(repository, { randomUuid: () => EVENT_ID });

    await expect(controller.consumeAfterDurableResult(request())).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      statusCode: 503,
    });
    expect(repository.state).toEqual({ armed: false, cancelCalls: 1, consumeCalls: 1 });
  });

  it("does not let a concurrent exact replay cancel the original request's fault", async () => {
    const repository = fakeRepository({ readStatus: async () => SUCCEEDED });
    const controller = createLostAckFaultController(repository, { randomUuid: () => EVENT_ID });
    const replay: UseResult = {
      useId: USE_ID,
      status: "SUCCEEDED",
      code: "RETRY_RESOLVED",
      replayed: true,
      usageDelta: 0,
      actionDelta: 0,
      receipt: SUCCEEDED.status === "SUCCEEDED" ? SUCCEEDED.receipt : neverReceipt(),
    };

    await expect(controller.consumeAfterDurableResult(request(replay))).resolves.toBe(false);
    expect(repository.state).toEqual({ armed: true, cancelCalls: 0, consumeCalls: 0 });
  });

  it("cancels before propagating an outcome-read failure", async () => {
    const repository = fakeRepository({
      readStatus: async () => {
        throw new Error("STATUS_UNAVAILABLE");
      },
    });
    const controller = createLostAckFaultController(repository, { randomUuid: () => EVENT_ID });

    await expect(controller.consumeAfterDurableResult(request())).rejects.toThrow(
      "STATUS_UNAVAILABLE"
    );
    expect(repository.state).toEqual({ armed: false, cancelCalls: 1, consumeCalls: 0 });
  });
});

function neverReceipt(): never {
  throw new Error("TEST_RECEIPT_UNAVAILABLE");
}
