import { afterEach, describe, expect, it, vi } from "vitest";
import { parseInsightsAiEnv } from "@anonlimit/config/server";
import { insightsReportSchema, type InsightsReport } from "@anonlimit/contracts";
import {
  aiAggregateInput,
  createAiNarrator,
} from "../../apps/api/src/modules/insights/ai-narrator.js";

function report(): Omit<InsightsReport, "ai"> {
  return {
    protocolVersion: "AnonLimit/v1",
    demoRunId: "70000000-0000-4000-8000-000000000001",
    generatedAt: "2026-09-06T12:00:00.000Z",
    analysisVersion: "rules-v1",
    scope: "ACTIVE_DEMO_RUN",
    advisoryOnly: true,
    summary: {
      status: "PASS",
      declaredLimit: 3,
      headline: "PRIVATE_PROSE_CANARY",
      counts: {
        committedUses: 3,
        outboxEvents: 3,
        externalActions: 3,
        retryUsageDelta: 0,
        retryActionDelta: 0,
        failedAttemptUses: 0,
        credentialWideIdentifiersStored: 0,
        storedHolderIdentities: 0,
        linkedDistinctLegitimateUsePairs: 0,
      },
      findings: (
        [
          "boundedUse",
          "retryIdempotency",
          "overLimitRejected",
          "noStableIdentity",
          "distinctUseUnlinkability",
        ] as const
      ).map((id) => ({ id, status: "PASS", text: "PRIVATE_PROSE_CANARY" })),
      nextSteps: ["PRIVATE_PROSE_CANARY"],
    },
    abuse: {
      level: "QUIET",
      windowSeconds: 60,
      signals: [],
      counters: { attempts: 5, accepted: 3, rejected: 0, conflicts: 0, retries: 1, overLimit: 1 },
    },
  };
}

function successful() {
  return Response.json({
    status: "completed",
    output: [
      {
        type: "message",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: JSON.stringify({
              summary: "The measured demo passed.",
              abuseExplanation: "No review threshold was reached.",
            }),
          },
        ],
      },
    ],
  });
}
const key = "sk-test-" + "x".repeat(40);
afterEach(() => vi.useRealTimers());

describe("optional aggregate AI narration", () => {
  it("works locally by default and waits for useful evidence when enabled", async () => {
    expect(await createAiNarrator().explain(report())).toEqual({
      status: "DISABLED",
      commentary: null,
    });
    const transport = vi.fn<typeof fetch>();
    const narrator = createAiNarrator({ apiKey: key, model: "test-model", fetch: transport });
    const partial = report();
    partial.summary.status = "INCOMPLETE";
    expect((await narrator.explain(partial)).status).toBe("WAITING");
    expect(transport).not.toHaveBeenCalled();
  });

  it("sends only selected counts/enums to a fixed endpoint and keeps commentary separate", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(successful());
    const result = await createAiNarrator({
      apiKey: key,
      model: "test-model",
      fetch: transport,
    }).explain(report());
    expect(result.status).toBe("READY");
    expect(insightsReportSchema.safeParse({ ...report(), ai: result }).success).toBe(true);
    const call = transport.mock.calls[0];
    expect(call?.[0]).toBe("https://api.openai.com/v1/responses");
    expect(call?.[1]?.redirect).toBe("error");
    expect(call?.[1]?.headers).toMatchObject({ Authorization: `Bearer ${key}` });
    const body = String(call?.[1]?.body);
    expect(body).not.toContain(key);
    expect(body).not.toContain(report().demoRunId);
    expect(body).not.toContain(report().generatedAt);
    expect(body).not.toContain("PRIVATE_PROSE_CANARY");
    expect(JSON.parse(body)).toMatchObject({
      store: false,
      model: "test-model",
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(JSON.parse(body)).not.toHaveProperty("tools");
    const input = aiAggregateInput(report());
    expect(input.counts.committedUses).toBe(3);
    expect(input.abuse.counters.retries).toBe(1);
    expect(JSON.stringify(input)).not.toMatch(
      /demoRunId|generatedAt|traceId|receiptId|actionKey|maskedUseRef|PRIVATE_PROSE_CANARY/
    );
  });

  it("coalesces concurrent calls, caches identical facts and isolates reset runs", async () => {
    let resolve: ((value: Response) => void) | undefined;
    let time = 0;
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          })
      )
      .mockImplementation(async () => successful());
    const narrator = createAiNarrator({
      apiKey: key,
      model: "test-model",
      fetch: transport,
      now: () => time,
    });
    const first = narrator.explain(report());
    const second = narrator.explain(report());
    expect(transport).toHaveBeenCalledTimes(1);
    resolve?.(successful());
    expect(await second).toEqual(await first);
    expect((await narrator.explain(report())).status).toBe("READY");
    const reset = { ...report(), demoRunId: "70000000-0000-4000-8000-000000000002" };
    expect((await narrator.explain(reset)).status).toBe("WAITING");
    time = 60_000;
    expect((await narrator.explain(reset)).status).toBe("READY");
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("caps provider attempts including failures and retries after the hourly window", async () => {
    let time = 0;
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error("PRIVATE_ERROR_CANARY"));
    const narrator = createAiNarrator({
      apiKey: key,
      model: "test-model",
      fetch: transport,
      now: () => time,
    });
    for (let i = 0; i < 8; i += 1) {
      expect(await narrator.explain(report())).toEqual({ status: "UNAVAILABLE", commentary: null });
      expect((await narrator.explain(report())).status).toBe("UNAVAILABLE");
      time += 60_000;
    }
    expect((await narrator.explain(report())).status).toBe("WAITING");
    expect(transport).toHaveBeenCalledTimes(8);
    time = 3_600_000;
    expect((await narrator.explain(report())).status).toBe("UNAVAILABLE");
    expect(transport).toHaveBeenCalledTimes(9);
  });

  it.each([
    () => new Response("PRIVATE_ERROR_CANARY", { status: 429 }),
    () => Response.json({ status: "incomplete", output: [] }),
    () =>
      Response.json({
        status: "completed",
        output: [
          {
            type: "message",
            status: "completed",
            content: [{ type: "refusal", refusal: "PRIVATE_ERROR_CANARY" }],
          },
        ],
      }),
    () => new Response("not-json"),
    () => new Response("x".repeat(32_769)),
    () =>
      Response.json({
        status: "completed",
        output: [
          {
            type: "message",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: '{"summary":"invented","abuseExplanation":"invented","override":"PASS"}',
              },
            ],
          },
        ],
      }),
  ])(
    "fails safely without exposing provider errors or changing measured facts",
    async (response) => {
      const input = report();
      const before = JSON.stringify(input);
      const narrator = createAiNarrator({
        apiKey: key,
        model: "test-model",
        fetch: async () => response(),
      });
      expect(await narrator.explain(input)).toEqual({ status: "UNAVAILABLE", commentary: null });
      expect(JSON.stringify(input)).toBe(before);
    }
  );

  it("bounds a hung provider call and aborts transport", async () => {
    vi.useFakeTimers();
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(() => new Promise<Response>(() => undefined));
    const result = createAiNarrator({ apiKey: key, model: "test-model", fetch: transport }).explain(
      report()
    );
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await result).toEqual({ status: "UNAVAILABLE", commentary: null });
    expect(transport.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("requires explicit server configuration and reports errors without values", () => {
    expect(parseInsightsAiEnv({})).toBeUndefined();
    expect(
      parseInsightsAiEnv({ ANONLIMIT_AI_ENABLED: "false", OPENAI_API_KEY: "unused" })
    ).toBeUndefined();
    expect(
      parseInsightsAiEnv({
        ANONLIMIT_AI_ENABLED: "true",
        OPENAI_API_KEY: key,
        ANONLIMIT_AI_MODEL: "test-model",
      })
    ).toEqual({ apiKey: key, model: "test-model" });
    for (const config of [
      { ANONLIMIT_AI_ENABLED: "true" },
      { ANONLIMIT_AI_ENABLED: "yes" },
      { ANONLIMIT_AI_ENABLED: "true", OPENAI_API_KEY: key },
    ])
      expect(() => parseInsightsAiEnv(config)).toThrow("CONFIGURATION_INVALID");
  });
});
