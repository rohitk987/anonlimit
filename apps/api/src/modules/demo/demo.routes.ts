import {
  demoBoundaryProbeRequestSchema,
  demoDropAckRequestSchema,
  demoLinkabilityRequestSchema,
  demoResetRequestSchema,
} from "@anonlimit/contracts";
import { serializePublicError } from "@anonlimit/observability";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ProtocolPublicError } from "../protocol/protocol-service.js";
import type { LostAckFaultController } from "./fault-controller.js";
import type { DemoResetController } from "./reset-demo.js";
import type { EvidenceController } from "../evidence/evidence-controller.js";
import { registerEventRoutes } from "../events/events.routes.js";
import type { EventStreamController } from "../events/events-controller.js";
import type { DemoBoundaryController } from "./boundary-controller.js";

async function requireJson(request: FastifyRequest): Promise<void> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new ProtocolPublicError("BAD_REQUEST");
}

export function registerDemoRoutes(
  app: FastifyInstance,
  faultController?: LostAckFaultController,
  resetController?: DemoResetController,
  evidenceController?: EvidenceController,
  eventController?: EventStreamController,
  boundaryController?: DemoBoundaryController
): void {
  if (faultController) {
    app.post(
      "/v1/demo/faults/drop-next-ack",
      { onRequest: requireJson },
      async (request, reply) => {
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
      }
    );
  }

  if (resetController) {
    app.post("/v1/demo/reset", { onRequest: requireJson }, async (request) => {
      const parsed = demoResetRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new ProtocolPublicError("BAD_REQUEST");
      return resetController.reset(request.id);
    });
  }

  if (evidenceController) {
    app.get("/v1/demo/evidence", async (_request, reply) => {
      reply.header("Cache-Control", "no-store");
      return evidenceController.getEvidence();
    });
    app.post(
      "/v1/demo/linkability-test",
      { onRequest: requireJson, bodyLimit: 1_048_576 },
      async (request) => {
        const parsed = demoLinkabilityRequestSchema.safeParse(request.body);
        if (!parsed.success) throw new ProtocolPublicError("BAD_REQUEST");
        return evidenceController.runLinkability(parsed.data, request.id);
      }
    );
  }

  if (boundaryController) {
    app.post("/v1/demo/attempt-fourth-use", { onRequest: requireJson }, async (request, reply) => {
      if (!demoBoundaryProbeRequestSchema.safeParse(request.body).success)
        throw new ProtocolPublicError("BAD_REQUEST");
      const result = await boundaryController.attemptFourthUse(request.id);
      return reply.code(result.statusCode).send(result.body);
    });
  }

  if (eventController) registerEventRoutes(app, eventController);
}
