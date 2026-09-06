import {
  challengeResponseSchema,
  demoFaultResponseSchema,
  demoResetResponseSchema,
  demoLinkabilityRequestSchema,
  evidenceReportSchema,
  insightsReportSchema,
  linkabilityReportSchema,
  issuanceResponseSchema,
  policySchema,
  useResultSchema,
  useStatusResponseSchema,
  type Action,
  type ChallengeResponse,
  type DemoFaultResponse,
  type DemoResetResponse,
  type EvidenceReport,
  type InsightsReport,
  type LinkabilityReport,
  type IssuanceResponse,
  type Policy,
  type Presentation,
  type UseResult,
  type UseStatusResponse,
} from "@anonlimit/contracts";

export interface ApiClient {
  getPolicy(policyId: string, version: number): Promise<Policy>;
  issueCredential(policyId: string, version: number): Promise<IssuanceResponse>;
  createChallenge(input: {
    policyId: string;
    policyVersion: number;
    audience: string;
    operationId: string;
    action: Action;
  }): Promise<ChallengeResponse>;
  submitPresentation(presentation: Presentation): Promise<UseResult>;
  submitSerializedPresentation(serializedEnvelope: string, operationId: string): Promise<UseResult>;
  getUseStatus(useId: string): Promise<UseStatusResponse>;
  armDropNextAck(operationId: string): Promise<DemoFaultResponse>;
  resetDemo(): Promise<DemoResetResponse>;
  getEvidence(): Promise<EvidenceReport>;
  runLinkabilityTest(presentations: Presentation[]): Promise<LinkabilityReport>;
  eventStreamUrl(after?: number): string;
  attemptFourthUse(): Promise<void>;
}

export interface InsightsClient {
  getInsights(signal?: AbortSignal): Promise<InsightsReport>;
}

/** Read-only aggregate analysis; no wallet or presentation material is sent. */
export function createInsightsClient(baseUrl: string): InsightsClient {
  return {
    async getInsights(signal) {
      const timeout = AbortSignal.timeout(10_000);
      const response = await fetch(baseUrl + "/v1/demo/insights", {
        credentials: "omit",
        cache: "no-store",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!response.ok) throw new ApiResponseError("INSIGHTS_UNAVAILABLE", response.status);
      return insightsReportSchema.parse(await response.json());
    },
  };
}

export class ApiTransportError extends Error {
  constructor() {
    super("TRANSPORT_UNCERTAIN");
    this.name = "ApiTransportError";
  }
}

export class ApiResponseError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "ApiResponseError";
    this.code = code;
    this.status = status;
  }
}

export function createApiClient(baseUrl: string): ApiClient {
  async function request(path: string, init?: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(baseUrl + path, {
        ...init,
        credentials: "omit",
        signal: AbortSignal.timeout(20_000),
        headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      });
    } catch {
      throw new ApiTransportError();
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      if (response.ok) throw new ApiTransportError();
      body = null;
    }
    if (!response.ok) {
      const code =
        body && typeof body === "object" && "code" in body && typeof body.code === "string"
          ? body.code
          : "REQUEST_FAILED";
      throw new ApiResponseError(code, response.status);
    }
    return body;
  }
  return {
    async getPolicy(policyId, version) {
      return policySchema.parse(
        await request(`/v1/policies/${encodeURIComponent(policyId)}/versions/${version}`)
      );
    },
    async issueCredential(policyId, version) {
      return issuanceResponseSchema.parse(
        await request("/v1/issuer/credentials", {
          method: "POST",
          body: JSON.stringify({
            protocolVersion: "AnonLimit/v1",
            policyId,
            policyVersion: version,
          }),
        })
      );
    },
    async createChallenge(input) {
      return challengeResponseSchema.parse(
        await request("/v1/verifier/challenges", {
          method: "POST",
          body: JSON.stringify({ protocolVersion: "AnonLimit/v1", ...input }),
        })
      );
    },
    async submitPresentation(presentation) {
      return useResultSchema.parse(
        await request("/v1/verifier/presentations", {
          method: "POST",
          headers: { "Idempotency-Key": presentation.operationId },
          body: JSON.stringify(presentation),
        })
      );
    },
    async submitSerializedPresentation(serializedEnvelope, operationId) {
      return useResultSchema.parse(
        await request("/v1/verifier/presentations", {
          method: "POST",
          headers: { "Idempotency-Key": operationId },
          body: serializedEnvelope,
        })
      );
    },
    async getUseStatus(useId) {
      return useStatusResponseSchema.parse(await request(`/v1/verifier/uses/${useId}`));
    },
    async armDropNextAck(operationId) {
      return demoFaultResponseSchema.parse(
        await request("/v1/demo/faults/drop-next-ack", {
          method: "POST",
          body: JSON.stringify({ operationId }),
        })
      );
    },
    async resetDemo() {
      return demoResetResponseSchema.parse(
        await request("/v1/demo/reset", {
          method: "POST",
          body: JSON.stringify({}),
        })
      );
    },
    async getEvidence() {
      return evidenceReportSchema.parse(await request("/v1/demo/evidence"));
    },
    async attemptFourthUse() {
      await request("/v1/demo/attempt-fourth-use", { method: "POST", body: "{}" });
    },
    async runLinkabilityTest(presentations) {
      const input = demoLinkabilityRequestSchema.parse({ presentations });
      return linkabilityReportSchema.parse(
        await request("/v1/demo/linkability-test", {
          method: "POST",
          body: JSON.stringify(input),
        })
      );
    },
    eventStreamUrl(after) {
      const url = new URL("/v1/demo/events/stream", baseUrl);
      if (after !== undefined) url.searchParams.set("after", String(after));
      return url.toString();
    },
  };
}
