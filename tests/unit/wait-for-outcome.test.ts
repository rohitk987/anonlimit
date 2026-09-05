import { describe, expect, it } from "vitest";
import type { UseStatusResponse } from "@anonlimit/contracts";
import { waitForOutcome } from "../../apps/api/src/modules/presentations/wait-for-outcome.js";

const PENDING: UseStatusResponse = {
  useId: "00000000-0000-4000-8000-000000000001",
  status: "ACCEPTED_PENDING_ACTION",
};
const SUCCEEDED: UseStatusResponse = {
  useId: PENDING.useId,
  status: "SUCCEEDED",
  receipt: {
    receiptId: "00000000-0000-4000-8000-000000000002",
    useId: PENDING.useId,
    actionKey: `hmac-sha256:${"a".repeat(64)}`,
    status: "COMMITTED",
    committedAt: "2026-09-05T18:00:00.000Z",
  },
};

describe("bounded outcome wait", () => {
  it("returns a terminal receipt without holding work between reads", async () => {
    const statuses = [PENDING, SUCCEEDED];
    let now = 0;
    const result = await waitForOutcome(async () => statuses.shift() ?? null, {
      timeoutMs: 100,
      pollIntervalMs: 10,
      now: () => now,
      delay: async (milliseconds) => {
        now += milliseconds;
      },
    });
    expect(result).toEqual(SUCCEEDED);
    expect(now).toBe(10);
  });

  it("returns null at its deterministic deadline while work remains pending", async () => {
    let now = 0;
    let reads = 0;
    const result = await waitForOutcome(
      async () => {
        reads += 1;
        return PENDING;
      },
      {
        timeoutMs: 25,
        pollIntervalMs: 10,
        now: () => now,
        delay: async (milliseconds) => {
          now += milliseconds;
        },
      }
    );
    expect(result).toBeNull();
    expect(reads).toBe(4);
    expect(now).toBe(25);
  });
});
