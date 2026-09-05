import { writeFile, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { getWorkerEnv } from "@anonlimit/config/server";
import { createVerifierDatabase } from "@anonlimit/db/verifier";
import { createSafeLogger } from "@anonlimit/observability";

async function main(): Promise<void> {
  const config = getWorkerEnv();
  const logger = createSafeLogger(config.logLevel);
  const database = createVerifierDatabase(config.databaseUrl);
  const heartbeat = join(tmpdir(), "anonlimit-worker-ready.json");
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    while (!controller.signal.aborted) {
      try {
        await database.check();
        await writeFile(heartbeat + ".tmp", JSON.stringify({ checkedAt: Date.now() }));
        await rename(heartbeat + ".tmp", heartbeat);
      } catch {
        await rm(heartbeat, { force: true });
        logger.warn({ errorCode: "DATABASE_UNAVAILABLE" });
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
