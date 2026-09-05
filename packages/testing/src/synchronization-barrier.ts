/**
 * Release exactly when the configured number of concurrent participants has arrived.
 *
 * Tests use this to start requests together without relying on arbitrary sleeps. The barrier is
 * deliberately one-shot: a participant can only arrive once and every waiter is released by the
 * final arrival.
 */
export interface SynchronizationBarrier {
  readonly arrived: number;
  wait(): Promise<void>;
}

export function createSynchronizationBarrier(participants: number): SynchronizationBarrier {
  if (!Number.isSafeInteger(participants) || participants < 2) {
    throw new Error("BARRIER_PARTICIPANTS_INVALID");
  }

  let arrived = 0;
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    get arrived() {
      return arrived;
    },
    async wait() {
      arrived += 1;
      if (arrived === participants) release();
      await released;
    },
  };
}
