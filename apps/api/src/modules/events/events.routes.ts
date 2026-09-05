import { eventStreamQuerySchema } from "@anonlimit/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { EventStreamController } from "./events-controller.js";
import { ProtocolPublicError } from "../protocol/protocol-service.js";

function cursor(request: FastifyRequest): number {
  const query = eventStreamQuerySchema.safeParse(request.query);
  if (!query.success) throw new ProtocolPublicError("BAD_REQUEST");
  const header = request.headers["last-event-id"];
  const headerValue = Array.isArray(header) ? undefined : header;
  const queryValue = query.data.after;
  const selected = queryValue ?? headerValue;
  if (selected === undefined) return 0;
  const parsed = Number(selected);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new ProtocolPublicError("BAD_REQUEST");
  return parsed;
}

export function registerEventRoutes(app: FastifyInstance, controller: EventStreamController): void {
  app.get("/v1/demo/events/stream", async (request, reply) => {
    const events = await controller.read(cursor(request));
    return reply
      .code(200)
      .header("Content-Type", "text/event-stream; charset=utf-8")
      .header("Cache-Control", "no-cache")
      .header("X-Content-Type-Options", "nosniff")
      .send(controller.format(events));
  });
}
