import { useEffect, useState } from "react";
import type { InsightsReport } from "@anonlimit/contracts";
import type { InsightsClient } from "../../lib/api-client.js";

export interface InsightsState {
  readonly report: InsightsReport | null;
  readonly status: "WAITING" | "LOADING" | "READY" | "UNAVAILABLE";
}

type Snapshot = InsightsState & {
  readonly demoRunId: string;
  readonly refreshKey: number;
};

/** Keep the independently polled report tied to the currently visible evidence run. */
export function useInsights(
  client: InsightsClient,
  enabled: boolean,
  demoRunId: string | null,
  refreshKey: number
): InsightsState {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  useEffect(() => {
    if (!enabled || !demoRunId) {
      setSnapshot(null);
      return;
    }
    const runId = demoRunId;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    setSnapshot({ demoRunId: runId, refreshKey, report: null, status: "LOADING" });
    async function poll() {
      try {
        const report = await client.getInsights(controller.signal);
        if (!active) return;
        if (report.demoRunId !== runId) {
          setSnapshot({ demoRunId: runId, refreshKey, report: null, status: "WAITING" });
        } else {
          setSnapshot({ demoRunId: runId, refreshKey, report, status: "READY" });
        }
      } catch {
        if (active)
          setSnapshot({ demoRunId: runId, refreshKey, report: null, status: "UNAVAILABLE" });
      } finally {
        if (active) timer = setTimeout(() => void poll(), 5_000);
      }
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [client, enabled, demoRunId, refreshKey]);

  // These guards apply during render, before an invalidating effect can run.
  if (!enabled || !demoRunId) return { report: null, status: "WAITING" };
  if (!snapshot || snapshot.demoRunId !== demoRunId || snapshot.refreshKey !== refreshKey)
    return { report: null, status: "LOADING" };
  return { report: snapshot.report, status: snapshot.status };
}
