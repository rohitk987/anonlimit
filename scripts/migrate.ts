import { resolve } from "node:path";
import { getMigrationEnv } from "@anonlimit/config/server";
import { runMigrations } from "@anonlimit/db/migrations";

async function main(): Promise<void> {
  await runMigrations(getMigrationEnv().databaseUrl, resolve("packages/db/migrations"));
  process.stdout.write("Migration shell completed.\n");
}

void main().catch(() => {
  process.stderr.write("MIGRATION_FAILED\n");
  process.exitCode = 1;
});
