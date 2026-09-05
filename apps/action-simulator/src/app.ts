import { randomUUID } from "node:crypto";
import Fastify, {
  LogController,
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";

import { type ActionEnv } from "@anonlimit/config/server";
import { ActionIntegrityConflictError, type ActionDatabase } from "@anonlimit/db/action";
import { internalActionRequestSchema, internalActionResponseSchema } from "@anonlimit/contracts";
import { healthResponseSchema } from "@anonlimit/contracts/health";
import { createSafeLogger } from "@anonlimit/observability";

function bearerToken(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return null;
  const match = /^Bearer ([^\s]+)$/u.exec(value ?? "");
  return match?.[1] ?? null;
}

function ownCode(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, "code");
  return descriptor && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

async function requireJson(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType === "application/json") return;
  await reply.code(400).send({ code: "BAD_REQUEST" });
}

export function createApp(
  config: ActionEnv,
  databaseOrCheck: ActionDatabase | (() => Promise<void>)
): FastifyInstance {
  const database: ActionDatabase =
    typeof databaseOrCheck === "function"
      ? {
          check: databaseOrCheck,
          close: async () => undefined,
          commitAction: async () => {
            throw new Error("DATABASE_UNAVAILABLE");
          },
        }
      : databaseOrCheck;
  const logger: FastifyBaseLogger = createSafeLogger(config.logLevel);
  const app = Fastify({
    loggerInstance: logger,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 16384,
    requestIdHeader: false,
    genReqId: () => randomUUID(),
  });

  app.addHook("onResponse", async (request, reply) => {
    app.log.info({
      method: request.method,
      route: request.routeOptions.url ?? "unmatched",
      traceId: request.id,
      statusCode: reply.statusCode,
      durationMs: reply.elapsedTime,
    });
  });
  app.setErrorHandler((error, _request, reply) => {
    const code = ownCode(error);
    if (
      code === "FST_ERR_CTP_BODY_TOO_LARGE" ||
      code === "FST_ERR_CTP_INVALID_MEDIA_TYPE" ||
      code === "FST_ERR_CTP_INVALID_JSON_BODY"
    )
      return reply.code(400).send({ code: "BAD_REQUEST" });
    app.log.error({ errorCode: "INTERNAL_ERROR" });
    return reply.code(500).send({ code: "INTERNAL_ERROR" });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ code: "NOT_FOUND" }));
  app.get("/health/live", () =>
    healthResponseSchema.parse({ status: "ok", service: "action-simulator", phase: 1 })
  );
  app.get("/health/ready", async (_request, reply) => {
    try {
      await database.check();
      return healthResponseSchema.parse({ status: "ok", service: "action-simulator", phase: 1 });
    } catch {
      app.log.warn({ errorCode: "DATABASE_UNAVAILABLE" });
      return reply.code(503).send(
        healthResponseSchema.parse({
          status: "unavailable",
          service: "action-simulator",
          phase: 1,
        })
      );
    }
  });
  app.post("/internal/v1/actions", { onRequest: requireJson }, async (request, reply) => {
    if (bearerToken(request.headers.authorization) !== config.actionServiceToken)
      return reply.code(401).send({ code: "UNAUTHORIZED" });
    const parsed = internalActionRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "BAD_REQUEST" });
    try {
      const result = await database.commitAction(parsed.data);
      return reply
        .code(result.replayed ? 200 : 201)
        .send(internalActionResponseSchema.parse(result));
    } catch (error) {
      if (
        error instanceof ActionIntegrityConflictError ||
        (error &&
          typeof error === "object" &&
          "name" in error &&
          error.name === "ActionIntegrityConflictError")
      )
        return reply.code(409).send({ code: "ACTION_INTEGRITY_CONFLICT" });
      app.log.error({ errorCode: "INTERNAL_ERROR" });
      return reply.code(500).send({ code: "INTERNAL_ERROR" });
    }
  });
  app.get("/internal/v1/evidence", async (request, reply) => {
    if (bearerToken(request.headers.authorization) !== config.actionServiceToken)
      return reply.code(401).send({ code: "UNAUTHORIZED" });
    if (!database.getEvidence) return reply.code(503).send({ code: "SERVICE_UNAVAILABLE" });
    try {
      return reply.code(200).send(await database.getEvidence());
    } catch {
      return reply.code(500).send({ code: "INTERNAL_ERROR" });
    }
  });
  return app;
}
