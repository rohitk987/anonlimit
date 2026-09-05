import { describe, expect, it } from "vitest";
import {
  serializeProtocolEvent,
  serializePublicError,
  createSafeLogger,
} from "@anonlimit/observability";

const traceId = "00000000-0000-4000-8000-000000000001";
const runId = "00000000-0000-4000-8000-000000000002";
const event = {
  sequence: 1,
  occurredAt: "2026-09-05T12:00:00.000Z",
  event: "USE_ACCEPTED",
  traceId,
  demoRunId: runId,
  policyId: "anon-demo",
  policyVersion: 1,
  fromState: "UNSEEN",
  toState: "ACCEPTED_PENDING_ACTION",
  decisionCode: "ACCEPTED_PENDING_ACTION",
  usageDelta: 1,
  actionDelta: 0,
};

describe("privacy-safe protocol serialization", () => {
  it("copies only event fields from an internal source", () => {
    const safe = serializeProtocolEvent({
      ...event,
      credential: "private-marker",
      nullifier: "private-marker",
      proof: "private-marker",
      hiddenSlot: 2,
      userAgent: "private-marker",
    });
    expect(safe).toEqual(event);
    expect(JSON.stringify(safe)).not.toContain("private-marker");
  });

  it("does not execute accessors while selecting public fields", () => {
    let accessed = false;
    const source = Object.defineProperty({ ...event }, "traceId", {
      enumerable: true,
      get() {
        accessed = true;
        return traceId;
      },
    });
    expect(() => serializeProtocolEvent(source)).toThrow("EVENT_SERIALIZATION_FAILED");
    expect(accessed).toBe(false);
  });

  it("creates a closed public error and reports malformed values generically", () => {
    const safe = serializePublicError({
      code: "PRESENTATION_REJECTED",
      traceId,
      usageDelta: 0,
      actionDelta: 0,
      stack: "private-marker",
      message: "private-marker",
    });
    expect(safe).toEqual({
      code: "PRESENTATION_REJECTED",
      traceId,
      usageDelta: 0,
      actionDelta: 0,
    });
    expect(() =>
      serializePublicError({
        code: "PRESENTATION_REJECTED",
        traceId: "private-marker",
        usageDelta: 0,
        actionDelta: 0,
      })
    ).toThrow("ERROR_SERIALIZATION_FAILED");
  });

  it("allows frozen protocol error codes in logs without including provider details", () => {
    const lines: string[] = [];
    const logger = createSafeLogger("info", {
      write(chunk) {
        lines.push(chunk);
      },
    });
    logger.warn({
      errorCode: "NULLIFIER_REUSE_CONFLICT",
      providerDiagnostic: "private-marker",
    });
    const output = lines.join("");
    expect(output).toContain("NULLIFIER_REUSE_CONFLICT");
    expect(output).not.toContain("private-marker");
  });
});
