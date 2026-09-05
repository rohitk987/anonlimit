import pino, { type DestinationStream, type LevelWithSilent } from "pino";

const codes = new Set([
  "CONFIGURATION_INVALID",
  "DATABASE_UNAVAILABLE",
  "STARTUP_FAILED",
  "INTERNAL_ERROR",
  "SHUTDOWN_FAILED",
]);
export function sanitizeLog(value: unknown): Record<string, string | number> {
  if (!value || typeof value !== "object") return {};
  const safe: Record<string, string | number> = {};
  if (
    "method" in value &&
    typeof value.method === "string" &&
    /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(value.method)
  )
    safe.method = value.method;
  if (
    "route" in value &&
    typeof value.route === "string" &&
    ["/health/live", "/health/ready", "unmatched"].includes(value.route)
  )
    safe.route = value.route;
  if (
    "traceId" in value &&
    typeof value.traceId === "string" &&
    /^[0-9a-f-]{36}$/.test(value.traceId)
  )
    safe.traceId = value.traceId;
  if (
    "statusCode" in value &&
    typeof value.statusCode === "number" &&
    Number.isInteger(value.statusCode) &&
    value.statusCode >= 100 &&
    value.statusCode <= 599
  )
    safe.statusCode = value.statusCode;
  if (
    "durationMs" in value &&
    typeof value.durationMs === "number" &&
    Number.isFinite(value.durationMs) &&
    value.durationMs >= 0
  )
    safe.durationMs = value.durationMs;
  if ("errorCode" in value && typeof value.errorCode === "string" && codes.has(value.errorCode))
    safe.errorCode = value.errorCode;
  return safe;
}
type LogMethod = (...args: unknown[]) => void;
export interface SafeLogger {
  level: string;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
  fatal: LogMethod;
  debug: LogMethod;
  trace: LogMethod;
  silent: LogMethod;
  child(bindings: unknown, options?: unknown): SafeLogger;
}

export function createSafeLogger(
  level: LevelWithSilent,
  destination?: DestinationStream
): SafeLogger {
  const options: pino.LoggerOptions = { level, base: null };
  const sink = destination ? pino(options, destination) : pino(options);
  function scoped(bindings: Record<string, string | number>): SafeLogger {
    const write =
      (severity: pino.Level): LogMethod =>
      (...args) => {
        sink[severity]({ ...bindings, ...sanitizeLog(args[0]) });
      };
    return {
      get level() {
        return sink.level;
      },
      set level(value: string) {
        if (!["fatal", "error", "warn", "info", "debug", "trace", "silent"].includes(value))
          throw new Error("INVALID_LOG_LEVEL");
        sink.level = value;
      },
      info: write("info"),
      warn: write("warn"),
      error: write("error"),
      fatal: write("fatal"),
      debug: write("debug"),
      trace: write("trace"),
      silent: () => undefined,
      child: (fields) => scoped({ ...bindings, ...sanitizeLog(fields) }),
    };
  }
  return scoped({});
}
