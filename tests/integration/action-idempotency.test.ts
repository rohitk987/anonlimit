import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseActionEnv } from "@anonlimit/config/server";
import { createActionDatabase } from "../../packages/db/src/action.js";
import { createApp } from "../../apps/action-simulator/src/app.js";
import { startPhase3Postgres, type Phase3Postgres } from "../helpers/phase3-postgres.js";

const TOKEN = "phase4-action-token-" + "x".repeat(48);
const config = parseActionEnv({
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  ACTION_PORT: "4100",
  DATABASE_URL_ACTION: "postgresql://action_service:phase3-action-password@localhost/db",
  ACTION_SERVICE_TOKEN: TOKEN,
});

describe.sequential("Phase 4 Action Simulator boundary", () => {
  let database: Phase3Postgres | undefined;
  let actionDatabase: ReturnType<typeof createActionDatabase> | undefined;
  let app: Awaited<ReturnType<typeof createApp>> | undefined;

  beforeAll(async () => {
    database = await startPhase3Postgres();
    await database.migrate();
    await database.pool.query("TRUNCATE action_sim.action_results");
    actionDatabase = createActionDatabase(database.connectionStringFor("action_service"));
    app = createApp(config, actionDatabase);
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await actionDatabase?.close();
    await database?.stop();
  }, 30_000);

  it("commits once, replays the same receipt, and rejects changed content", async () => {
    if (!app) throw new Error("ACTION_APP_UNAVAILABLE");
    const request = {
      demoRunId: "00000000-0000-4000-8000-000000000001",
      actionKey: "hmac-sha256:" + "a".repeat(64),
      useId: "00000000-0000-4000-8000-000000000001",
      intentDigest: "sha256:" + "b".repeat(64),
      payloadDigest: "sha256:" + "c".repeat(64),
      action: { type: "REDEEM_DEMO_BENEFIT", payload: { benefitCode: "HACKATHON" } },
    };
    const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
    const first = await app.inject({
      method: "POST",
      url: "/internal/v1/actions",
      headers,
      payload: request,
    });
    const replay = await app.inject({
      method: "POST",
      url: "/internal/v1/actions",
      headers,
      payload: request,
    });
    const conflict = await app.inject({
      method: "POST",
      url: "/internal/v1/actions",
      headers,
      payload: { ...request, payloadDigest: "sha256:" + "d".repeat(64) },
    });
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().receipt).toEqual(first.json().receipt);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({ code: "ACTION_INTEGRITY_CONFLICT" });
    const count = await database?.pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM action_sim.action_results"
    );
    expect(count?.rows[0]?.count).toBe(1);
  });

  it("requires the internal service token", async () => {
    if (!app) throw new Error("ACTION_APP_UNAVAILABLE");
    const response = await app.inject({ method: "GET", url: "/internal/v1/evidence" });
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain(TOKEN);
  });
});
