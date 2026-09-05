import { randomUUID } from "node:crypto";
import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance } from "fastify";

import { type ActionEnv } from "@anonlimit/config/server";
import { healthResponseSchema } from "@anonlimit/contracts/health";
import { createSafeLogger } from "@anonlimit/observability";

export function createApp(config: ActionEnv, checkDatabase: () => Promise<void>): FastifyInstance {
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
  app.setErrorHandler((_error, _request, reply) => {
    app.log.error({ errorCode: "INTERNAL_ERROR" });
    return reply.code(500).send({ code: "INTERNAL_ERROR" });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ code: "NOT_FOUND" }));
  app.get("/health/live", () =>
    healthResponseSchema.parse({ status: "ok", service: "action-simulator", phase: 1 })
  );
  app.get("/health/ready", async (_request, reply) => {
    try {
      await checkDatabase();
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
  return app;
}
