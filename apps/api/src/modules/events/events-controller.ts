import { eventStreamQuerySchema, type ProtocolEvent } from "@anonlimit/contracts";
import type { VerifierDatabase } from "@anonlimit/db/verifier";

export interface EventStreamController {
  read(after: number): Promise<readonly ProtocolEvent[]>;
  format(events: readonly ProtocolEvent[]): string;
}

export function createEventStreamController(
  repository: Pick<VerifierDatabase, "getProtocolEvents">
) {
  return Object.freeze<EventStreamController>({
    read(after) {
      return repository.getProtocolEvents(after, 500);
    },
    format(events) {
      return events
        .map(
          (event) => `id: ${event.sequence}\nevent: protocol\ndata: ${JSON.stringify(event)}\n\n`
        )
        .join("");
    },
  });
}

export function eventCursor(value: unknown): number {
  const parsed = eventStreamQuerySchema.parse({
    after: value === undefined ? undefined : String(value),
  });
  return parsed.after === undefined ? 0 : Number(parsed.after);
}
