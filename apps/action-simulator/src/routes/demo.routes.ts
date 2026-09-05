import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  internalDemoResetRequestSchema,
  internalDemoResetResponseSchema,
} from "@anonlimit/contracts/internal-action";
import type { ActionDatabase } from "@anonlimit/db/action";

function bearerToken(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return null;
  const match = /^Bearer ([^\s]+)$/u.exec(value ?? "");
  return match?.[1] ?? null;
}

async function requireJson(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType === "application/json") return;
  await reply.code(400).send({ code: "BAD_REQUEST" });
}

export function registerDemoRoutes(
  app: FastifyInstance,
  actionServiceToken: string,
  database: ActionDatabase
): void {
  app.post("/internal/v1/demo/reset", { onRequest: requireJson }, async (request, reply) => {
    if (bearerToken(request.headers.authorization) !== actionServiceToken)
      return reply.code(401).send({ code: "UNAUTHORIZED" });
    const parsed = internalDemoResetRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "BAD_REQUEST" });
    const result = await database.resetDemoRun(parsed.data);
    return reply.code(200).send(internalDemoResetResponseSchema.parse(result));
  });
}
