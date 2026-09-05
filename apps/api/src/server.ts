import { getApiEnv } from "@anonlimit/config/server";
import { createVerifierDatabase } from "@anonlimit/db/verifier";
import { createApp } from "./app.js";

async function main(): Promise<void> {
  const config = getApiEnv();
  const database = createVerifierDatabase(config.databaseUrl);
  const app = createApp(config, database.check);
  app.addHook("onClose", () => database.close());
  const stop = () => {
    void app.close().catch(() => {
      process.stderr.write("SHUTDOWN_FAILED\n");
      process.exitCode = 1;
    });
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    await app.listen({ host: "0.0.0.0", port: config.port });
  } catch {
    await app.close();
    throw new Error("STARTUP_FAILED");
  }
}
main().catch(() => {
  process.stderr.write("STARTUP_FAILED\n");
  process.exitCode = 1;
});
