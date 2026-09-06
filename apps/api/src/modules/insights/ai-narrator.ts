import {
  aiCommentarySchema,
  insightsReportSchema,
  type AiNarration,
  type InsightsReport,
} from "@anonlimit/contracts";

type Analysis = Omit<InsightsReport, "ai">;
export interface AiNarrator {
  explain(report: Analysis): Promise<AiNarration>;
}
interface Options {
  readonly apiKey: string;
  readonly model: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

const unavailable = (): AiNarration => ({ status: "UNAVAILABLE", commentary: null });
const waiting = (): AiNarration => ({ status: "WAITING", commentary: null });
const COOLDOWN_MS = 60_000;
const HOUR_MS = 3_600_000;
const MAX_CALLS_PER_HOUR = 8;
const MAX_RESPONSE_BYTES = 32_768;

/** Only aggregate numbers and validated enums can enter an external model request. */
export function aiAggregateInput(report: Analysis) {
  const valid = insightsReportSchema.parse({
    ...report,
    ai: { status: "DISABLED", commentary: null },
  });
  const counts = valid.summary.counts;
  const activity = valid.abuse.counters;
  return {
    basis: "SIMULATED_CRYPTO_DEMO",
    scope: "RUN_AGGREGATE_NOT_A_PERSON",
    declaredLimit: valid.summary.declaredLimit,
    overall: valid.summary.status,
    counts: {
      committedUses: counts.committedUses,
      outboxEvents: counts.outboxEvents,
      externalActions: counts.externalActions,
      retryUsageDelta: counts.retryUsageDelta,
      retryActionDelta: counts.retryActionDelta,
      failedAttemptUses: counts.failedAttemptUses,
      storedHolderIdentities: counts.storedHolderIdentities,
      credentialWideIdentifiersStored: counts.credentialWideIdentifiersStored,
      linkedDistinctLegitimateUsePairs: counts.linkedDistinctLegitimateUsePairs,
    },
    checks: valid.summary.findings.map((finding) => ({ id: finding.id, status: finding.status })),
    abuse: {
      level: valid.abuse.level,
      windowSeconds: valid.abuse.windowSeconds,
      counters: {
        attempts: activity.attempts,
        accepted: activity.accepted,
        rejected: activity.rejected,
        conflicts: activity.conflicts,
        retries: activity.retries,
        overLimit: activity.overLimit,
      },
      signals: valid.abuse.signals.map((signal) => ({
        code: signal.code,
        observed: signal.observed,
        threshold: signal.threshold,
      })),
    },
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readResponse(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error("AI_UNAVAILABLE");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("AI_UNAVAILABLE");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function parseCommentary(body: unknown): AiNarration {
  if (!record(body) || body.status !== "completed" || !Array.isArray(body.output))
    return unavailable();
  const texts: string[] = [];
  for (const item of body.output) {
    if (!record(item) || item.type !== "message") continue;
    if (item.status !== "completed" || !Array.isArray(item.content)) return unavailable();
    for (const content of item.content) {
      if (!record(content) || content.type !== "output_text" || typeof content.text !== "string")
        return unavailable();
      texts.push(content.text);
    }
  }
  if (texts.length !== 1) return unavailable();
  const commentary = aiCommentarySchema.parse(JSON.parse(texts[0] ?? ""));
  return { status: "READY", commentary };
}

export function createAiNarrator(options?: Options): AiNarrator {
  if (!options) return { explain: async () => ({ status: "DISABLED", commentary: null }) };
  const transport = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let lastAttempt = Number.NEGATIVE_INFINITY;
  let attempts: number[] = [];
  let cached: { key: string; at: number; result: AiNarration } | undefined;
  let pending: { key: string; result: Promise<AiNarration> } | undefined;

  async function request(input: ReturnType<typeof aiAggregateInput>): Promise<AiNarration> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("AI_UNAVAILABLE"));
      }, 8_000);
    });
    try {
      const work = async () => {
        const response = await transport("https://api.openai.com/v1/responses", {
          method: "POST",
          redirect: "error",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${options?.apiKey}`,
          },
          body: JSON.stringify({
            model: options?.model,
            store: false,
            max_output_tokens: 900,
            instructions:
              "Explain this anonymous-credential demo in plain language. The input contains aggregate evidence only. Preserve PASS, FAIL, NOT_RUN and INCOMPLETE exactly; null means unavailable, never zero. Describe the bound per credential, never per human. Privacy counts concern measured verifier storage only and unlinkability is a simulator assumption, not production cryptographic proof. Abuse thresholds indicate a run-wide review signal, not an identified attacker; normal recovery and concurrency can cause retries. Never recommend identifying, fingerprinting, blocking a person or changing quota decisions. Return short summary and abuseExplanation prose. You cannot run actions, inspect identity, or change evidence.",
            input: JSON.stringify(input),
            text: {
              format: {
                type: "json_schema",
                name: "anonlimit_commentary",
                strict: true,
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: { summary: { type: "string" }, abuseExplanation: { type: "string" } },
                  required: ["summary", "abuseExplanation"],
                },
              },
            },
          }),
        });
        return parseCommentary(await readResponse(response));
      };
      return await Promise.race([work(), timeout]);
    } catch {
      return unavailable();
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  return {
    async explain(report) {
      try {
        const input = aiAggregateInput(report);
        if (!["PASS", "FAIL"].includes(input.overall) && input.abuse.level !== "REVIEW")
          return waiting();
        // The run ID isolates the local cache; it is never included in the request body.
        const key = `${report.demoRunId}:${JSON.stringify(input)}`;
        const time = now();
        if (!Number.isFinite(time)) return unavailable();
        if (
          cached?.key === key &&
          (cached.result.status === "READY" || time - cached.at < COOLDOWN_MS)
        )
          return cached.result;
        if (pending) return pending.key === key ? pending.result : waiting();
        attempts = attempts.filter((at) => time - at < HOUR_MS);
        if (time - lastAttempt < COOLDOWN_MS || attempts.length >= MAX_CALLS_PER_HOUR)
          return waiting();
        lastAttempt = time;
        attempts.push(time);
        const result = request(input);
        pending = { key, result };
        try {
          const response = await result;
          cached = { key, at: time, result: response };
          return response;
        } finally {
          pending = undefined;
        }
      } catch {
        return unavailable();
      }
    },
  };
}
