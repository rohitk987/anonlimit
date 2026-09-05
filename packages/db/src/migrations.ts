import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

export async function runMigrations(connectionString: string, directory: string): Promise<void> {
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 30000,
  });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(170024)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS public.schema_migrations (name text PRIMARY KEY, digest text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())"
    );
    for (const schema of ["verifier", "action"] as const) {
      const names = (await readdir(join(directory, schema)))
        .filter((name) => /^\d+[-_][a-z0-9-]+\.sql$/.test(name))
        .sort();
      for (const name of names) {
        const key = schema + "/" + name;
        const sql = await readFile(join(directory, schema, name), "utf8");
        const digest = createHash("sha256").update(sql).digest("hex");
        const existing = await client.query<{ digest: string }>(
          "SELECT digest FROM public.schema_migrations WHERE name=$1",
          [key]
        );
        if (existing.rows[0]) {
          if (existing.rows[0].digest !== digest) throw new Error("MIGRATION_DRIFT");
          continue;
        }
        await client.query("BEGIN");
        try {
          await client.query(sql);
          await client.query("INSERT INTO public.schema_migrations(name,digest) VALUES ($1,$2)", [
            key,
            digest,
          ]);
          await client.query("COMMIT");
        } catch {
          await client.query("ROLLBACK");
          throw new Error("MIGRATION_FAILED");
        }
      }
    }
  } finally {
    await client.end();
  }
}
