import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPhase3Postgres, type Phase3Postgres } from "../helpers/phase3-postgres.js";

interface SchemaColumn {
  readonly table_name: string;
  readonly column_name: string;
  readonly data_type: string;
  readonly character_maximum_length: number | null;
}

const REQUIRED_VERIFIER_TABLES = [
  "demo_faults",
  "demo_runs",
  "outbox_events",
  "protocol_events",
  "quota_policies",
  "use_records",
  "verification_challenges",
] as const;
const REQUIRED_ACTION_TABLES = ["action_faults", "action_results", "reset_demo_runs"] as const;

function prohibitedColumns(columns: readonly SchemaColumn[]): string[] {
  return columns.flatMap(({ table_name: table, column_name: column }) => {
    const normalized = column.toLowerCase();
    const tokens = normalized.split(/[^a-z0-9]+/);
    const exposesIdentity = tokens.some((token) =>
      [
        "account",
        "cookie",
        "credential",
        "device",
        "email",
        "fingerprint",
        "holder",
        "identity",
        "ip",
        "patient",
        "phone",
        "session",
        "subject",
        "user",
        "wallet",
      ].includes(token)
    );
    const exposesName = ["full_name", "first_name", "last_name"].some((name) =>
      normalized.includes(name)
    );
    const exposesProof = tokens.includes("proof") || tokens.includes("presentation");
    const exposesHiddenSlot = tokens.includes("slot") || normalized.includes("hidden_slot");
    const exposesNullifier = tokens.includes("nullifier") && column !== "nullifier_key";
    return exposesIdentity || exposesName || exposesProof || exposesHiddenSlot || exposesNullifier
      ? [`${table}.${column}`]
      : [];
  });
}

describe.sequential("Phase 3 database schema privacy", () => {
  let database: Phase3Postgres | undefined;

  beforeAll(async () => {
    database = await startPhase3Postgres();
    await database.migrate();
  }, 120_000);

  afterAll(async () => {
    await database?.stop();
  }, 30_000);

  it("contains every product table without identity, credential, proof, hidden-slot, or raw-nullifier columns", async () => {
    if (!database) throw new Error("TEST_DATABASE_UNAVAILABLE");
    const result = await database.pool.query<SchemaColumn>(`
      SELECT table_name, column_name, data_type, character_maximum_length
      FROM information_schema.columns
      WHERE table_schema IN ('verifier', 'action_sim')
      ORDER BY table_schema, table_name, ordinal_position
    `);
    const productTables = await database.pool.query<{ table_schema: string; table_name: string }>(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema IN ('verifier', 'action_sim') AND table_type = 'BASE TABLE'
      ORDER BY table_schema, table_name
    `);

    expect(
      productTables.rows
        .filter(({ table_schema }) => table_schema === "verifier")
        .map(({ table_name }) => table_name)
    ).toEqual(expect.arrayContaining([...REQUIRED_VERIFIER_TABLES]));
    expect(
      productTables.rows
        .filter(({ table_schema }) => table_schema === "action_sim")
        .map(({ table_name }) => table_name)
    ).toEqual(expect.arrayContaining([...REQUIRED_ACTION_TABLES]));
    expect(prohibitedColumns(result.rows)).toEqual([]);
    expect(
      result.rows.filter(
        ({ table_name, column_name }) =>
          table_name === "use_records" && column_name === "nullifier_key"
      )
    ).toEqual([
      {
        table_name: "use_records",
        column_name: "nullifier_key",
        data_type: "character varying",
        character_maximum_length: 76,
      },
    ]);

    const protection = await database.pool.query<{ definition: string }>(`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE connamespace = 'verifier'::regnamespace
        AND conname = 'ck_use_records_nullifier_key'
    `);
    expect(protection.rows).toEqual([
      {
        definition: expect.stringContaining("^hmac-sha256:[a-f0-9]{64}$"),
      },
    ]);
  });

  it("detects common identity and raw-presentation column names", () => {
    const fixture = [
      "user_id",
      "full_name",
      "ip_address",
      "browser_cookie",
      "raw_presentation",
      "raw_nullifier",
    ].map((column_name) => ({
      table_name: "unsafe_fixture",
      column_name,
      data_type: "text",
      character_maximum_length: null,
    }));
    expect(prohibitedColumns(fixture)).toEqual(
      fixture.map(({ table_name, column_name }) => `${table_name}.${column_name}`)
    );
  });
});
