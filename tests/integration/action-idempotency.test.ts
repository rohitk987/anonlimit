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
  DEMO_MODE: "true",
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

  it("resets only the selected run, stays idempotent, and blocks later effects", async () => {
    if (!app || !database) throw new Error("ACTION_APP_UNAVAILABLE");
    const selectedRunId = "00000000-0000-4000-8000-000000000101";
    const otherRunId = "00000000-0000-4000-8000-000000000102";
    const actionFor = (demoRunId: string, suffix: string, digestCharacter: string) => ({
      demoRunId,
      actionKey: `hmac-sha256:${suffix.repeat(64)}`,
      useId: `00000000-0000-4000-8000-0000000001${digestCharacter}1`,
      intentDigest: `sha256:${"b".repeat(64)}`,
      payloadDigest: `sha256:${digestCharacter.repeat(64)}`,
      action: { type: "REDEEM_DEMO_BENEFIT", payload: { benefitCode: "HACKATHON" } },
    });
    const selectedAction = actionFor(selectedRunId, "d", "4");
    const otherAction = actionFor(otherRunId, "e", "5");
    const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

    expect(
      (
        await app.inject({
          method: "POST",
          url: "/internal/v1/actions",
          headers,
          payload: selectedAction,
        })
      ).statusCode
    ).toBe(201);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/internal/v1/actions",
          headers,
          payload: otherAction,
        })
      ).statusCode
    ).toBe(201);

    const unauthorized = await app.inject({
      method: "POST",
      url: "/internal/v1/demo/reset",
      headers: { "content-type": "application/json" },
      payload: { demoRunId: selectedRunId },
    });
    const unscoped = await app.inject({
      method: "POST",
      url: "/internal/v1/demo/reset",
      headers,
      payload: { demoRunId: selectedRunId, allRuns: true },
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(unscoped.statusCode).toBe(400);

    const firstReset = await app.inject({
      method: "POST",
      url: "/internal/v1/demo/reset",
      headers,
      payload: { demoRunId: selectedRunId },
    });
    const replayedReset = await app.inject({
      method: "POST",
      url: "/internal/v1/demo/reset",
      headers,
      payload: { demoRunId: selectedRunId },
    });
    expect(firstReset.statusCode).toBe(200);
    expect(replayedReset.statusCode).toBe(200);
    expect(replayedReset.json()).toEqual(firstReset.json());
    expect(firstReset.json()).toMatchObject({ demoRunId: selectedRunId });

    const counts = await database.pool.query<{ demo_run_id: string; count: number }>(
      `SELECT demo_run_id::text, count(*)::int AS count
       FROM action_sim.action_results
       WHERE demo_run_id IN ($1, $2)
       GROUP BY demo_run_id
       ORDER BY demo_run_id`,
      [selectedRunId, otherRunId]
    );
    expect(counts.rows).toEqual([{ demo_run_id: otherRunId, count: 1 }]);

    const laterCommit = await app.inject({
      method: "POST",
      url: "/internal/v1/actions",
      headers,
      payload: selectedAction,
    });
    expect(laterCommit.statusCode).toBe(410);
    expect(laterCommit.json()).toEqual({ code: "DEMO_RUN_RESET" });

    const otherLaterCommit = await app.inject({
      method: "POST",
      url: "/internal/v1/actions",
      headers,
      payload: actionFor(otherRunId, "f", "6"),
    });
    expect(otherLaterCommit.statusCode).toBe(201);
    const tombstones = await database.pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM action_sim.reset_demo_runs WHERE demo_run_id = $1",
      [selectedRunId]
    );
    expect(tombstones.rows[0]?.count).toBe(1);
  });

  it("serializes reset against concurrent commits for the same run", async () => {
    if (!app || !database) throw new Error("ACTION_APP_UNAVAILABLE");
    const actionApp = app;
    const demoRunId = "00000000-0000-4000-8000-000000000201";
    const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
    const commits = Array.from({ length: 8 }, (_, index) =>
      actionApp.inject({
        method: "POST",
        url: "/internal/v1/actions",
        headers,
        payload: {
          demoRunId,
          actionKey: `hmac-sha256:${index.toString(16).repeat(64)}`,
          useId: `00000000-0000-4000-8000-0000000002${index.toString().padStart(2, "0")}`,
          intentDigest: `sha256:${"7".repeat(64)}`,
          payloadDigest: `sha256:${"8".repeat(64)}`,
          action: { type: "REDEEM_DEMO_BENEFIT", payload: { benefitCode: "HACKATHON" } },
        },
      })
    );
    const reset = actionApp.inject({
      method: "POST",
      url: "/internal/v1/demo/reset",
      headers,
      payload: { demoRunId },
    });
    const responses = await Promise.all([...commits, reset]);
    expect(responses.at(-1)?.statusCode).toBe(200);
    expect(responses.slice(0, -1).every(({ statusCode }) => [201, 410].includes(statusCode))).toBe(
      true
    );
    const count = await database.pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM action_sim.action_results WHERE demo_run_id = $1",
      [demoRunId]
    );
    expect(count.rows[0]?.count).toBe(0);
  });
});
