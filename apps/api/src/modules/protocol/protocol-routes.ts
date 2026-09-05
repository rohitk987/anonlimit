import {
  challengeRequestSchema,
  idempotencyHeaderSchema,
  issuanceRequestSchema,
  operationPathSchema,
  policyPathSchema,
  presentationSchema,
  type PublicErrorCode,
} from "@anonlimit/contracts";
import { serializePublicError } from "@anonlimit/observability";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  ProtocolPublicError,
  type ProtocolResponse,
  type ProtocolService,
} from "./protocol-service.js";
import type { LostAckFaultController } from "../demo/fault-controller.js";

interface RuntimeSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

function parse<T>(schema: RuntimeSchema<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ProtocolPublicError("BAD_REQUEST");
  return result.data;
}

function publicFailure(error: unknown): {
  readonly code: PublicErrorCode;
  readonly status: number;
} {
  return error instanceof ProtocolPublicError
    ? { code: error.code, status: error.statusCode }
    : { code: "INTERNAL_ERROR", status: 500 };
}

async function respond<T>(
  app: FastifyInstance,
  reply: FastifyReply,
  traceId: string,
  operation: () => Promise<ProtocolResponse<T>>,
  dropAfterResult?: (result: ProtocolResponse<T>) => Promise<boolean>
): Promise<FastifyReply> {
  try {
    const result = await operation();
    if (dropAfterResult && (await dropAfterResult(result))) {
      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": "2",
        Connection: "close",
      });
      // A partial body proves the server began an acknowledgement while preventing the browser
      // network stack from transparently replaying a request whose response had no bytes at all.
      reply.raw.end("{");
      return reply;
    }
    return reply.code(result.statusCode).send(result.body);
  } catch (error) {
    const failure = publicFailure(error);
    if (failure.code === "INTERNAL_ERROR") app.log.error({ errorCode: failure.code });
    else app.log.warn({ errorCode: failure.code });
    return reply.code(failure.status).send(
      serializePublicError({
        code: failure.code,
        traceId,
        usageDelta: 0,
        actionDelta: 0,
      })
    );
  }
}

async function requireJson(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType === "application/json") return;
  await reply.code(400).send(
    serializePublicError({
      code: "BAD_REQUEST",
      traceId: request.id,
      usageDelta: 0,
      actionDelta: 0,
    })
  );
}

/** Registers the public protocol surface. App-wide limits and CORS stay in app.ts. */
export function registerProtocolRoutes(
  app: FastifyInstance,
  service: ProtocolService,
  faultController?: LostAckFaultController
): void {
  app.get("/v1/policies/:id/versions/:version", (request, reply) =>
    respond(app, reply, request.id, () =>
      service.getPolicy(parse(policyPathSchema, request.params))
    )
  );

  app.get("/v1/verifier/uses/:useId", (request, reply) =>
    respond(app, reply, request.id, () =>
      service.getUseStatus(parse(operationPathSchema, request.params).useId)
    )
  );

  app.post("/v1/issuer/credentials", { onRequest: requireJson }, (request, reply) =>
    respond(app, reply, request.id, () =>
      service.issueCredential(parse(issuanceRequestSchema, request.body), request.id)
    )
  );

  app.post("/v1/verifier/challenges", { onRequest: requireJson }, (request, reply) =>
    respond(app, reply, request.id, () =>
      service.createChallenge(parse(challengeRequestSchema, request.body))
    )
  );

  app.post("/v1/verifier/presentations", { onRequest: requireJson }, (request, reply) =>
    respond(
      app,
      reply,
      request.id,
      async () => {
        const presentation = parse(presentationSchema, request.body);
        const operationId = parse(idempotencyHeaderSchema, request.headers["idempotency-key"]);
        if (operationId !== presentation.operationId) throw new ProtocolPublicError("BAD_REQUEST");
        return service.present(presentation, request.id);
      },
      faultController
        ? (result) => {
            const presentation = parse(presentationSchema, request.body);
            return faultController.consumeAfterDurableResult({
              operationId: presentation.operationId,
              traceId: request.id,
              response: result.body,
            });
          }
        : undefined
    )
  );
}
