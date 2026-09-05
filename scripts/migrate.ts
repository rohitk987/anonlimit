import { resolve } from "node:path";
import { getMigrationEnv } from "@anonlimit/config/server";
import { runMigrations } from "@anonlimit/db/migrations";

async function main(): Promise<void> {
  const config = getMigrationEnv();
  await runMigrations(
    config.databaseUrl,
    resolve("packages/db/migrations"),
    config.rolePasswords,
    resolve("infra/postgres/00-create-schemas-and-roles.sql")
  );
  process.stdout.write("Migration shell completed.\n");
}

void main().catch(() => {
  process.stderr.write("MIGRATION_FAILED\n");
  process.exitCode = 1;
});
