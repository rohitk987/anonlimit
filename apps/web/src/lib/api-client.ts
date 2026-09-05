import {
  challengeResponseSchema,
  issuanceResponseSchema,
  policySchema,
  useResultSchema,
  useStatusResponseSchema,
  type Action,
  type ChallengeResponse,
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
  getUseStatus(useId: string): Promise<UseStatusResponse>;
}

export function createApiClient(baseUrl: string): ApiClient {
  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(baseUrl + path, {
      ...init,
      credentials: "omit",
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code =
        body && typeof body === "object" && "code" in body && typeof body.code === "string"
          ? body.code
          : "REQUEST_FAILED";
      throw new Error(code);
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
    async getUseStatus(useId) {
      return useStatusResponseSchema.parse(await request(`/v1/verifier/uses/${useId}`));
    },
  };
}
