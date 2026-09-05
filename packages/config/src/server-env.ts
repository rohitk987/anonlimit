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
    actionServiceToken: env.ACTION_SERVICE_TOKEN,
  };
}
export function getApiEnv() {
  return parseApiEnv(process.env);
}
export function getWorkerEnv() {
  return parseWorkerEnv(process.env);
}
export function getActionEnv() {
  return parseActionEnv(process.env);
}
export function getMigrationEnv() {
  const env = parse(z.object({ DATABASE_URL_MIGRATION: databaseUrl }), process.env);
  return { databaseUrl: env.DATABASE_URL_MIGRATION };
}
export type ApiEnv = ReturnType<typeof parseApiEnv>;
export type WorkerEnv = ReturnType<typeof parseWorkerEnv>;
export type ActionEnv = ReturnType<typeof parseActionEnv>;
