import { writeFile, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { getWorkerEnv } from "@anonlimit/config/server";
import { createVerifierWorkerDatabase } from "@anonlimit/db/verifier";
import { createSafeLogger } from "@anonlimit/observability";
import { deliverAction } from "./action-client.js";

async function main(): Promise<void> {
  const config = getWorkerEnv();
  const logger = createSafeLogger(config.logLevel);
  const database = createVerifierWorkerDatabase(config.databaseUrl);
  const heartbeat = join(tmpdir(), "anonlimit-worker-ready.json");
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    while (!controller.signal.aborted) {
      try {
        await database.check();
        const batch = await database.claimOutboxBatch(10, 30_000);
        for (const event of batch) {
          if (controller.signal.aborted) break;
          const delivery = await deliverAction(config, event, controller.signal);
          if (delivery.kind === "SUCCESS") {
            await database.completeOutboxSuccess(event.eventId, delivery.response);
          } else if (delivery.kind === "INTEGRITY") {
            await database.failOutbox(event.eventId, "ACTION_INTEGRITY_CONFLICT");
          } else {
            await database.retryOutbox(event.eventId, delivery.code);
          }
        }
        await writeFile(heartbeat + ".tmp", JSON.stringify({ checkedAt: Date.now() }));
        await rename(heartbeat + ".tmp", heartbeat);
      } catch (error) {
        if (controller.signal.aborted) break;
        await rm(heartbeat, { force: true });
        logger.warn({
          errorCode:
            error instanceof Error && error.message === "WORKER_ABORTED"
              ? "WORKER_ABORTED"
              : "WORKER_LOOP_FAILED",
        });
      }
      try {
        await delay(config.outboxPollMs, undefined, { signal: controller.signal });
      } catch {
        if (!controller.signal.aborted) throw new Error("WORKER_DELAY_FAILED");
      }
    }
  } finally {
    await rm(heartbeat, { force: true });
    await database.close();
  }
}
main().catch(() => {
  process.stderr.write("STARTUP_FAILED\n");
  process.exitCode = 1;
});
