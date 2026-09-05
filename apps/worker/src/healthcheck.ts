import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getWorkerEnv } from "@anonlimit/config/server";

async function check(): Promise<void> {
  const config = getWorkerEnv();
  const raw: unknown = JSON.parse(
    await readFile(join(tmpdir(), "anonlimit-worker-ready.json"), "utf8")
  );
  if (
    !raw ||
    typeof raw !== "object" ||
    !("checkedAt" in raw) ||
    typeof raw.checkedAt !== "number" ||
    !Number.isFinite(raw.checkedAt) ||
    Date.now() < raw.checkedAt ||
    Date.now() - raw.checkedAt > config.outboxPollMs + 10000
  )
    throw new Error("UNHEALTHY");
}
check().catch(() => {
  process.exitCode = 1;
});
