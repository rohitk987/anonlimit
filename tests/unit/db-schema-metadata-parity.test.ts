import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const dbRequire = createRequire(resolve(repositoryRoot, "packages/db/package.json"));

interface NamedMetadata {
  readonly name: string;
}

interface BuiltMetadata {
  getName(): string;
}

interface IndexMetadata {
  readonly config: { readonly name?: string };
}

interface TableConfig {
  readonly checks: readonly NamedMetadata[];
  readonly foreignKeys: readonly BuiltMetadata[];
  readonly indexes: readonly IndexMetadata[];
  readonly primaryKeys: readonly BuiltMetadata[];
  readonly uniqueConstraints: readonly BuiltMetadata[];
}

type GetTableConfig = (table: Record<PropertyKey, unknown>) => TableConfig;

const metadataPatterns = {
  checks: /\bCONSTRAINT\s+([a-z_][a-z0-9_]*)\s+CHECK\b/giu,
  foreignKeys: /\bCONSTRAINT\s+([a-z_][a-z0-9_]*)\s+FOREIGN\s+KEY\b/giu,
  indexes: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\b/giu,
  primaryKeys: /\bCONSTRAINT\s+([a-z_][a-z0-9_]*)\s+PRIMARY\s+KEY\b/giu,
  uniqueConstraints: /\bCONSTRAINT\s+([a-z_][a-z0-9_]*)\s+UNIQUE\b/giu,
} as const;

type MetadataKind = keyof typeof metadataPatterns;
type MetadataNames = Readonly<Record<MetadataKind, readonly string[]>>;

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function capturedName(match: RegExpMatchArray): string {
  const name = match[1];
  if (!name) throw new Error("Named migration metadata pattern did not capture a name.");
  return name;
}

function migrationMetadata(sql: string): MetadataNames {
  return Object.fromEntries(
    Object.entries(metadataPatterns).map(([kind, pattern]) => [
      kind,
      sorted([...sql.matchAll(pattern)].map(capturedName)),
    ])
  ) as unknown as MetadataNames;
}

function isDrizzleTable(value: unknown): value is Record<PropertyKey, unknown> {
  return (
    typeof value === "object" && value !== null && Symbol.for("drizzle:IsDrizzleTable") in value
  );
}

function requiredIndexName(index: IndexMetadata): string {
  if (!index.config.name) throw new Error("Drizzle schema contains an unnamed explicit index.");
  return index.config.name;
}

function schemaMetadata(
  modules: readonly Readonly<Record<string, unknown>>[],
  getTableConfig: GetTableConfig
): MetadataNames {
  const configs = modules.flatMap((schemaModule) =>
    Object.values(schemaModule).filter(isDrizzleTable).map(getTableConfig)
  );
  return {
    checks: sorted(configs.flatMap((config) => config.checks.map(({ name }) => name))),
    foreignKeys: sorted(
      configs.flatMap((config) => config.foreignKeys.map((foreignKey) => foreignKey.getName()))
    ),
    indexes: sorted(
      configs.flatMap((config) => config.indexes.map((index) => requiredIndexName(index)))
    ),
    primaryKeys: sorted(
      configs.flatMap((config) => config.primaryKeys.map((primaryKey) => primaryKey.getName()))
    ),
    uniqueConstraints: sorted(
      configs.flatMap((config) =>
        config.uniqueConstraints.map((constraint) => constraint.getName())
      )
    ),
  };
}

describe("Drizzle schema metadata", () => {
  it("matches every explicitly named migration constraint and index", async () => {
    const migrationPaths = [
      "packages/db/migrations/verifier/0001-durable-acceptance.sql",
      "packages/db/migrations/verifier/0002-worker-completion.sql",
      "packages/db/migrations/verifier/0003-lost-ack-fault.sql",
      "packages/db/migrations/verifier/0004-fault-target-integrity.sql",
      "packages/db/migrations/action/0001-action-foundation.sql",
      "packages/db/migrations/action/0002-run-scoped-reset.sql",
    ];
    const schemaPaths = ["packages/db/src/verifier/schema.ts", "packages/db/src/action/schema.ts"];

    const migrationSql = (
      await Promise.all(
        migrationPaths.map((path) => readFile(resolve(repositoryRoot, path), "utf8"))
      )
    ).join("\n");
    const schemaModules = await Promise.all(
      schemaPaths.map(
        async (path) =>
          (await import(pathToFileURL(resolve(repositoryRoot, path)).href)) as Readonly<
            Record<string, unknown>
          >
      )
    );
    const drizzleModulePath = dbRequire.resolve("drizzle-orm/pg-core");
    const drizzle = (await import(pathToFileURL(drizzleModulePath).href)) as unknown as {
      readonly getTableConfig: GetTableConfig;
    };

    expect(schemaMetadata(schemaModules, drizzle.getTableConfig)).toEqual(
      migrationMetadata(migrationSql)
    );
  });
});
