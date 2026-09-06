import { z } from "zod";

type Source = Readonly<Record<string, unknown>>;
const integer = (min: number, max: number) =>
  z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(min).max(max));
const boolean = z.enum(["true", "false"]).transform((value) => value === "true");
const secret = z
  .string()
  .min(32)
  .max(256)
  .refine((value) => !/replace|placeholder|change.?me/i.test(value));
const httpUrl = z.url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    ["http:", "https:"].includes(url.protocol) &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
  );
});
const databaseUrl = z.url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    ["postgres:", "postgresql:"].includes(url.protocol) &&
    !!url.hostname &&
    !!url.username &&
    !!url.password &&
    !/replace|placeholder|change.?me/i.test(url.password)
  );
});
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const secretPath = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => value.startsWith("/") && !value.includes("\u0000"));
const common = {
  NODE_ENV: z.enum(["development", "test", "production"]),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]),
};
const apiSchema = z.object({
  ...common,
  API_PORT: integer(1, 65535),
  WEB_ORIGIN: httpUrl,
  DATABASE_URL_API: databaseUrl,
  DEMO_MODE: boolean,
  ACTION_SERVICE_URL: httpUrl,
  ACTION_SERVICE_TOKEN: secret,
  VERIFIER_LEDGER_HMAC_KEY: secret,
  VERIFIER_ACTION_HMAC_KEY: secret,
  OPAQUE_CRYPTO_PROVIDER: z.literal("simulated"),
  ISSUER_KEY_ID: identifier,
  ISSUER_PRIVATE_KEY_PATH: secretPath,
  ISSUER_PUBLIC_PARAMETERS_PATH: secretPath,
});
const workerSchema = z.object({
  ...common,
  DATABASE_URL_WORKER: databaseUrl,
  ACTION_SERVICE_URL: httpUrl,
  ACTION_SERVICE_TOKEN: secret,
  OUTBOX_POLL_MS: integer(100, 60000),
});
const actionSchema = z.object({
  ...common,
  ACTION_PORT: integer(1, 65535),
  DATABASE_URL_ACTION: databaseUrl,
  DEMO_MODE: boolean,
  ACTION_SERVICE_TOKEN: secret,
});
function parse<T>(schema: z.ZodType<T>, source: Source): T {
  const result = schema.safeParse(source);
  if (!result.success) throw new Error("CONFIGURATION_INVALID");
  return result.data;
}
export function parseApiEnv(source: Source) {
  const env = parse(apiSchema, source);
  return {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    port: env.API_PORT,
    webOrigin: env.WEB_ORIGIN,
    databaseUrl: env.DATABASE_URL_API,
    demoMode: env.DEMO_MODE,
    actionServiceUrl: env.ACTION_SERVICE_URL,
    actionServiceToken: env.ACTION_SERVICE_TOKEN,
    verifierLedgerHmacKey: env.VERIFIER_LEDGER_HMAC_KEY,
    verifierActionHmacKey: env.VERIFIER_ACTION_HMAC_KEY,
    opaqueCryptoProvider: env.OPAQUE_CRYPTO_PROVIDER,
    issuerKeyId: env.ISSUER_KEY_ID,
    issuerPrivateKeyPath: env.ISSUER_PRIVATE_KEY_PATH,
    issuerPublicParametersPath: env.ISSUER_PUBLIC_PARAMETERS_PATH,
  };
}
export function parseWorkerEnv(source: Source) {
  const env = parse(workerSchema, source);
  return {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL_WORKER,
    actionServiceUrl: env.ACTION_SERVICE_URL,
    actionServiceToken: env.ACTION_SERVICE_TOKEN,
    outboxPollMs: env.OUTBOX_POLL_MS,
  };
}
export function parseActionEnv(source: Source) {
  const env = parse(actionSchema, source);
  return {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    port: env.ACTION_PORT,
    databaseUrl: env.DATABASE_URL_ACTION,
    demoMode: env.DEMO_MODE,
    actionServiceToken: env.ACTION_SERVICE_TOKEN,
  };
}
export function getApiEnv() {
  return parseApiEnv(process.env);
}
/** Optional server-only AI configuration; local analysis needs no external service. */
export function parseInsightsAiEnv(source: Source): { apiKey: string; model: string } | undefined {
  const toggle = parse(
    z.object({ ANONLIMIT_AI_ENABLED: z.enum(["true", "false"]).default("false") }),
    source
  );
  if (toggle.ANONLIMIT_AI_ENABLED === "false") return undefined;
  const settings = parse(
    z.object({
      OPENAI_API_KEY: z
        .string()
        .trim()
        .min(20)
        .max(512)
        .regex(/^[A-Za-z0-9_-]+$/),
      ANONLIMIT_AI_MODEL: identifier,
    }),
    source
  );
  return { apiKey: settings.OPENAI_API_KEY, model: settings.ANONLIMIT_AI_MODEL };
}
export function getInsightsAiEnv() {
  return parseInsightsAiEnv(process.env);
}
export function getWorkerEnv() {
  return parseWorkerEnv(process.env);
}
export function getActionEnv() {
  return parseActionEnv(process.env);
}
export function parseMigrationEnv(source: Source) {
  const env = parse(
    z.object({
      DATABASE_URL_MIGRATION: databaseUrl,
      API_DB_PASSWORD: secret,
      WORKER_DB_PASSWORD: secret,
      ACTION_DB_PASSWORD: secret,
    }),
    source
  );
  return {
    databaseUrl: env.DATABASE_URL_MIGRATION,
    rolePasswords: {
      api: env.API_DB_PASSWORD,
      worker: env.WORKER_DB_PASSWORD,
      action: env.ACTION_DB_PASSWORD,
    },
  };
}
export function getMigrationEnv() {
  return parseMigrationEnv(process.env);
}
export function parseSeedEnv(source: Source) {
  const env = parse(
    z.object({ DATABASE_URL_MIGRATION: databaseUrl, ISSUER_KEY_ID: identifier }),
    source
  );
  return { databaseUrl: env.DATABASE_URL_MIGRATION, issuerKeyId: env.ISSUER_KEY_ID };
}
export function getSeedEnv() {
  return parseSeedEnv(process.env);
}
export type ApiEnv = ReturnType<typeof parseApiEnv>;
export type WorkerEnv = ReturnType<typeof parseWorkerEnv>;
export type ActionEnv = ReturnType<typeof parseActionEnv>;
export type MigrationEnv = ReturnType<typeof parseMigrationEnv>;
export type SeedEnv = ReturnType<typeof parseSeedEnv>;
