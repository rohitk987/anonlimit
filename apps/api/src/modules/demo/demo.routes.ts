import { demoDropAckRequestSchema } from "@anonlimit/contracts";
import { serializePublicError } from "@anonlimit/observability";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ProtocolPublicError } from "../protocol/protocol-service.js";
import type { LostAckFaultController } from "./fault-controller.js";

async function requireJson(request: FastifyRequest): Promise<void> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new ProtocolPublicError("BAD_REQUEST");
}

export function registerDemoRoutes(
  app: FastifyInstance,
  faultController: LostAckFaultController
): void {
  app.post("/v1/demo/faults/drop-next-ack", { onRequest: requireJson }, async (request, reply) => {
    const parsed = demoDropAckRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new ProtocolPublicError("BAD_REQUEST");
    try {
      return await faultController.arm(parsed.data.operationId);
    } catch (error) {
      if (error instanceof ProtocolPublicError) throw error;
      app.log.error({ errorCode: "INTERNAL_ERROR" });
      return reply.code(500).send(
        serializePublicError({
          code: "INTERNAL_ERROR",
          traceId: request.id,
          usageDelta: 0,
          actionDelta: 0,
        })
      );
    }
  });
}
