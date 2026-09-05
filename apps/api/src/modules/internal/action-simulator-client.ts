import {
  internalActionEvidenceResponseSchema,
  internalDemoResetResponseSchema,
  uuidSchema,
  type InternalActionEvidenceResponse,
  type InternalDemoResetResponse,
} from "@anonlimit/contracts";

export interface ActionSimulatorResetClient {
  resetDemoRun(demoRunId: string): Promise<InternalDemoResetResponse>;
}

export interface ActionSimulatorEvidenceClient {
  getEvidence(demoRunId: string): Promise<InternalActionEvidenceResponse>;
}

export interface ActionSimulatorResetClientOptions {
  readonly actionServiceUrl: string;
  readonly actionServiceToken: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

function resetUrl(baseUrl: string): string {
  return new URL("/internal/v1/demo/reset", baseUrl).toString();
}

function evidenceUrl(baseUrl: string, demoRunId: string): string {
  const url = new URL("/internal/v1/evidence", baseUrl);
  url.searchParams.set("demoRunId", uuidSchema.parse(demoRunId));
  return url.toString();
}

/** A narrow private client; only the API can select the active run it asks the sink to clear. */
export function createActionSimulatorResetClient(
  options: ActionSimulatorResetClientOptions
): ActionSimulatorResetClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 2_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000)
    throw new Error("CONFIGURATION_INVALID");
  const url = resetUrl(options.actionServiceUrl);

  return Object.freeze({
    async resetDemoRun(demoRunId: string) {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.actionServiceToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ demoRunId }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new Error("ACTION_RESET_UNAVAILABLE");
      }
      if (!response.ok) throw new Error("ACTION_RESET_UNAVAILABLE");
      let body: unknown;
      try {
        body = (await response.json()) as unknown;
      } catch {
        throw new Error("ACTION_RESET_UNAVAILABLE");
      }
      const parsed = internalDemoResetResponseSchema.safeParse(body);
      if (!parsed.success || parsed.data.demoRunId !== demoRunId)
        throw new Error("ACTION_RESET_UNAVAILABLE");
      return parsed.data;
    },
  });
}

/** Reads only the Action Simulator's sanitized, run-scoped receipts. */
export function createActionSimulatorEvidenceClient(
  options: ActionSimulatorResetClientOptions
): ActionSimulatorEvidenceClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 2_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000)
    throw new Error("CONFIGURATION_INVALID");
  return Object.freeze({
    async getEvidence(demoRunId: string) {
      const url = evidenceUrl(options.actionServiceUrl, demoRunId);
      let response: Response;
      try {
        response = await fetchImpl(url, {
          headers: { Authorization: `Bearer ${options.actionServiceToken}` },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new Error("ACTION_EVIDENCE_UNAVAILABLE");
      }
      if (!response.ok) throw new Error("ACTION_EVIDENCE_UNAVAILABLE");
      let body: unknown;
      try {
        body = (await response.json()) as unknown;
      } catch {
        throw new Error("ACTION_EVIDENCE_UNAVAILABLE");
      }
      const parsed = internalActionEvidenceResponseSchema.safeParse(body);
      if (!parsed.success) throw new Error("ACTION_EVIDENCE_UNAVAILABLE");
      return parsed.data;
    },
  });
}
