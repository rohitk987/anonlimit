import { getSeedEnv } from "@anonlimit/config/server";
import { seedDefaultPolicy } from "@anonlimit/db/seed";

async function main(): Promise<void> {
  const config = getSeedEnv();
  await seedDefaultPolicy(config.databaseUrl, { issuerKeyId: config.issuerKeyId });
  process.stdout.write("Default policy seed completed.\n");
}

void main().catch(() => {
  process.stderr.write("SEED_FAILED\n");
  process.exitCode = 1;
});
