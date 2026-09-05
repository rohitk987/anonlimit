import {
  internalActionRequestSchema,
  internalActionResponseSchema,
  type InternalActionResponse,
} from "@anonlimit/contracts";
import type { WorkerEnv } from "@anonlimit/config/server";
import type { ClaimedOutboxEvent } from "@anonlimit/db/verifier";

export type DeliveryResult =
  | { readonly kind: "SUCCESS"; readonly response: InternalActionResponse }
  | { readonly kind: "INTEGRITY" }
  | { readonly kind: "RETRYABLE"; readonly code: string };

export async function deliverAction(
  config: Pick<WorkerEnv, "actionServiceUrl" | "actionServiceToken">,
  event: ClaimedOutboxEvent,
  signal: AbortSignal
): Promise<DeliveryResult> {
  const request = internalActionRequestSchema.parse({
    demoRunId: event.demoRunId,
    actionKey: event.actionKey,
    useId: event.useId,
    intentDigest: event.intentDigest,
    payloadDigest: event.payloadDigest,
    action: event.action,
  });
  let response: Response;
  try {
    response = await fetch(`${config.actionServiceUrl}/internal/v1/actions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.actionServiceToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": event.actionKey,
      },
      body: JSON.stringify(request),
      signal,
    });
  } catch {
    if (signal.aborted) throw new Error("WORKER_ABORTED");
    return { kind: "RETRYABLE", code: "ACTION_SERVICE_UNAVAILABLE" };
  }
  if (response.status === 409) {
    const body: unknown = await response.json().catch(() => null);
    if (
      body &&
      typeof body === "object" &&
      "code" in body &&
      body.code === "ACTION_INTEGRITY_CONFLICT"
    )
      return { kind: "INTEGRITY" };
    return { kind: "RETRYABLE", code: "ACTION_CONFLICT" };
  }
  if (!response.ok) return { kind: "RETRYABLE", code: `ACTION_HTTP_${response.status}` };
  const body: unknown = await response.json().catch(() => null);
  const parsed = internalActionResponseSchema.safeParse(body);
  return parsed.success
    ? { kind: "SUCCESS", response: parsed.data }
    : { kind: "RETRYABLE", code: "ACTION_INVALID_RESPONSE" };
}
