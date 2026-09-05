import type { UseStatusResponse } from "@anonlimit/contracts";

export interface OutcomeWaitOptions {
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly now?: () => number;
  readonly delay?: (milliseconds: number) => Promise<void>;
}

const defaultDelay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Polls without retaining a transaction or row lock. A null result means the bound elapsed. */
export async function waitForOutcome(
  readStatus: () => Promise<UseStatusResponse | null>,
  options: OutcomeWaitOptions = {}
): Promise<UseStatusResponse | null> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const pollIntervalMs = options.pollIntervalMs ?? 25;
  const now = options.now ?? Date.now;
  const delay = options.delay ?? defaultDelay;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
    throw new Error("WAIT_CONFIGURATION_INVALID");
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1 || pollIntervalMs > timeoutMs)
    throw new Error("WAIT_CONFIGURATION_INVALID");
  const startedAt = now();
  if (!Number.isFinite(startedAt)) throw new Error("CLOCK_INVALID");
  const deadline = startedAt + timeoutMs;
  while (true) {
    const status = await readStatus();
    if (status?.status !== "ACCEPTED_PENDING_ACTION") return status;
    const currentTime = now();
    if (!Number.isFinite(currentTime)) throw new Error("CLOCK_INVALID");
    if (currentTime >= deadline) return null;
    await delay(Math.min(pollIntervalMs, deadline - currentTime));
  }
}
