import { useEffect, useState } from "react";
import { protocolEventSchema, type EvidenceReport, type ProtocolEvent } from "@anonlimit/contracts";
import type { ApiClient } from "../../lib/api-client.js";

/** Replay the server's finite SSE batches. The cursor advances only after strict validation. */
export function useEvidence(client: ApiClient, enabled: boolean, refreshKey: number) {
  const [evidence, setEvidence] = useState<EvidenceReport | null>(null);
  const [events, setEvents] = useState<readonly ProtocolEvent[]>([]);
  const [streamState, setStreamState] = useState("Connecting to backend evidence…");
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let cursor = 0;
    let runId = "";
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const report = await client.getEvidence();
        if (!active) return;
        if (runId !== report.demoRunId) {
          runId = report.demoRunId;
          cursor = 0;
          setEvents([]);
        }
        setEvidence(report);
        const response = await fetch(client.eventStreamUrl(cursor), {
          credentials: "omit",
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        });
        if (!response.ok) throw new Error("EVENTS_UNAVAILABLE");
        const batch = (await response.text())
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data: "))
          .map((line) => protocolEventSchema.parse(JSON.parse(line.slice(6))));
        if (!active) return;
        if (batch.some((event) => event.demoRunId !== runId)) {
          // Reset raced the two reads. Start a new snapshot rather than mix runs.
          cursor = 0;
          setEvidence(null);
          setEvents([]);
          setStreamState("Run changed; reconnecting…");
        } else {
          cursor = Math.max(cursor, ...batch.map((event) => event.sequence));
          setEvents((previous) => [
            ...new Map([...previous, ...batch].map((event) => [event.sequence, event])).values(),
          ]);
          setStreamState("Live · verified API evidence");
        }
      } catch {
        if (active)
          setStreamState("Evidence unavailable · retrying; displayed snapshot may be stale");
      } finally {
        if (active) timer = setTimeout(() => void poll(), 1_000);
      }
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [client, enabled, refreshKey]);
  return { evidence, events, streamState };
}
