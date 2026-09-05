import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function sql(query: string): string {
  return execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "migration_owner",
      "-d",
      "anonlimit",
      "-At",
      "-c",
      query,
    ],
    { encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "pipe"] }
  ).trim();
}

describe("live foundation database", () => {
  it("uses PostgreSQL 17 and completed the migration shell", () => {
    expect(sql("SELECT current_setting('server_version_num')::int / 10000")).toBe("17");
    expect(sql("SELECT to_regclass('public.schema_migrations') IS NOT NULL")).toBe("t");
  });

  it("isolates service roles and keeps future worker tables least-privileged", () => {
    expect(
      sql(`
      SELECT
        has_schema_privilege('verifier_api', 'verifier', 'USAGE'),
        has_schema_privilege('verifier_worker', 'verifier', 'USAGE'),
        has_schema_privilege('action_service', 'action_sim', 'USAGE'),
        has_schema_privilege('verifier_api', 'action_sim', 'USAGE'),
        has_schema_privilege('verifier_worker', 'action_sim', 'USAGE'),
        has_schema_privilege('action_service', 'verifier', 'USAGE'),
        has_schema_privilege('verifier_api', 'public', 'CREATE'),
        has_table_privilege('verifier_api', 'public.schema_migrations', 'INSERT');
    `)
    ).toBe("t|t|t|f|f|f|f|f");
    expect(
      sql(`
      SELECT count(*) FROM pg_roles
      WHERE rolname IN ('verifier_api', 'verifier_worker', 'action_service')
        AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole;
    `)
    ).toBe("3");
    const result = sql(`
      BEGIN;
      CREATE TABLE verifier.foundation_probe (id integer);
      CREATE TABLE action_sim.foundation_probe (id integer);
      SELECT
        has_table_privilege('verifier_api', 'verifier.foundation_probe', 'INSERT'),
        has_table_privilege('verifier_worker', 'verifier.foundation_probe', 'UPDATE'),
        has_table_privilege('action_service', 'action_sim.foundation_probe', 'INSERT'),
        has_table_privilege('verifier_api', 'action_sim.foundation_probe', 'SELECT'),
        has_table_privilege('action_service', 'verifier.foundation_probe', 'SELECT');
      ROLLBACK;
    `);
    expect(result.split(/\r?\n/)).toContain("t|f|t|f|f");
  });
});
