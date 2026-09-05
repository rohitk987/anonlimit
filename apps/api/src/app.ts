import { randomUUID } from "node:crypto";
import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { type ApiEnv } from "@anonlimit/config/server";
import { healthResponseSchema } from "@anonlimit/contracts/health";
import { createSafeLogger, serializePublicError } from "@anonlimit/observability";
import {
  ProtocolPublicError,
  registerProtocolRoutes,
  type ProtocolService,
} from "./modules/protocol/index.js";
import { registerDemoRoutes } from "./modules/demo/demo.routes.js";
import type { LostAckFaultController } from "./modules/demo/fault-controller.js";

function ownCode(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, "code");
  return descriptor && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

export function createApp(
  config: ApiEnv,
  checkDatabase: () => Promise<void>,
  protocolService?: ProtocolService,
  faultController?: LostAckFaultController
): FastifyInstance {
  const logger: FastifyBaseLogger = createSafeLogger(config.logLevel);
  const app = Fastify({
    loggerInstance: logger,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 16384,
    requestIdHeader: false,
    genReqId: () => randomUUID(),
  });
  void app.register(cors, {
    origin: config.webOrigin,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Idempotency-Key"],
    credentials: false,
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
  app.setErrorHandler((error, request, reply) => {
    const fastifyCode = ownCode(error);
    if (
      fastifyCode === "FST_ERR_CTP_BODY_TOO_LARGE" ||
      fastifyCode === "FST_ERR_CTP_INVALID_MEDIA_TYPE" ||
      fastifyCode === "FST_ERR_CTP_INVALID_JSON_BODY"
    )
      return reply.code(400).send(
        serializePublicError({
          code: "BAD_REQUEST",
          traceId: request.id,
          usageDelta: 0,
          actionDelta: 0,
        })
      );
    if (error instanceof ProtocolPublicError)
      return reply.code(error.statusCode).send(
        serializePublicError({
          code: error.code,
          traceId: request.id,
          usageDelta: 0,
          actionDelta: 0,
        })
      );
    app.log.error({ errorCode: "INTERNAL_ERROR" });
    return reply.code(500).send({ code: "INTERNAL_ERROR" });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ code: "NOT_FOUND" }));
  app.get("/health/live", () =>
    healthResponseSchema.parse({ status: "ok", service: "api", phase: 1 })
  );
  app.get("/health/ready", async (_request, reply) => {
    try {
      await checkDatabase();
      return healthResponseSchema.parse({ status: "ok", service: "api", phase: 1 });
    } catch {
      app.log.warn({ errorCode: "DATABASE_UNAVAILABLE" });
      return reply
        .code(503)
        .send(healthResponseSchema.parse({ status: "unavailable", service: "api", phase: 1 }));
    }
  });
  const enabledFaultController = config.demoMode ? faultController : undefined;
  if (protocolService) registerProtocolRoutes(app, protocolService, enabledFaultController);
  if (config.demoMode && faultController) registerDemoRoutes(app, faultController);
  return app;
}
