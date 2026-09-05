import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { evidenceReportSchema } from "@anonlimit/contracts";
import { assertNoForbiddenData } from "@anonlimit/testing";

const apiBase = process.env.PLAYWRIGHT_API_BASE_URL ?? "http://localhost:4000";

function databaseEvidence() {
  // A separate database connection checks the UI/API against both durable ledgers.
  const sql = `WITH active AS (SELECT demo_run_id FROM verifier.demo_runs WHERE status = 'ACTIVE'),
    uses AS (SELECT * FROM verifier.use_records WHERE demo_run_id = (SELECT demo_run_id FROM active)),
    actions AS (SELECT * FROM action_sim.action_results WHERE demo_run_id = (SELECT demo_run_id FROM active)),
    outbox AS (SELECT * FROM verifier.outbox_events WHERE use_id IN (SELECT use_id FROM uses))
    SELECT json_build_object(
      'uses', (SELECT count(*) FROM uses), 'actions', (SELECT count(*) FROM actions),
      'outbox', (SELECT count(*) FROM outbox),
      'receipts', (SELECT coalesce(json_agg(receipt->>'receiptId' ORDER BY receipt->>'receiptId'), '[]') FROM actions),
      'safePayloads', (SELECT coalesce(json_agg(safe_payload), '[]') FROM outbox),
      'safeRows', (SELECT coalesce(json_agg(e), '[]') FROM verifier.evidence_uses e WHERE demo_run_id = (SELECT demo_run_id FROM active))
    )`;
  const output = execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "sh",
      "-c",
      'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "$1"',
      "phase8-evidence",
      sql,
    ],
    { encoding: "utf8", timeout: 15_000 }
  );
  return JSON.parse(output.trim()) as {
    uses: number;
    actions: number;
    outbox: number;
    receipts: string[];
    safePayloads: unknown;
    safeRows: unknown;
  };
}

test.beforeEach(async ({ request }) => {
  expect((await request.post(`${apiBase}/v1/demo/reset`, { data: {} })).ok()).toBe(true);
});

for (const rehearsal of [1, 2]) {
  test(`Phase 8 complete real P0 rehearsal ${rehearsal} finishes with all invariants PASS`, async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(180_000);
    const started = Date.now();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await expect(page.getByTestId("connection")).toHaveText("API and database connected");
    await page.getByRole("button", { name: "Reset demo run" }).click();
    await expect(page.getByTestId("metric-committedUses")).toHaveText("0");
    await expect(page.getByTestId("metric-externalActions")).toHaveText("0");
    expect(databaseEvidence()).toMatchObject({ uses: 0, actions: 0, outbox: 0, receipts: [] });
    await expect(page.getByText("02 / HOLDER WALLET · LOCAL ONLY")).toBeVisible();
    await expect(page.getByTestId("assumptions")).toBeVisible();

    // Drive issuance with a real keyboard focus and activation.
    const issue = page.getByRole("button", { name: "Issue anonymous pass" });
    await issue.focus();
    await expect(issue).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText("3 of 3 uses available", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Use next slot" }).click();
    await expect(page.getByTestId("operation-status")).toHaveText(
      "NEW ACCEPTANCE · RECEIPT STORED"
    );
    await expect(page.getByTestId("operation-status")).toHaveAttribute("data-tone", "acceptance");
    await expect(page.getByTestId("metric-externalActions")).toHaveText("1");

    const wire: string[] = [];
    page.on("request", (outgoing) => {
      if (
        outgoing.method() === "POST" &&
        new URL(outgoing.url()).pathname === "/v1/verifier/presentations"
      )
        wire.push(outgoing.postData() ?? "");
    });
    await page.getByRole("button", { name: "Drop next acknowledgement" }).click();
    await expect(page.getByTestId("operation-status")).toHaveText(
      "FAULT ARMED · NEXT ACKNOWLEDGEMENT"
    );
    await page.getByRole("button", { name: "Use next slot" }).click();
    await expect(page.getByTestId("operation-status")).toContainText("OUTCOME UNKNOWN", {
      timeout: 20_000,
    });
    await expect(page.getByTestId("operation-status")).toHaveAttribute("data-tone", "unknown");
    await expect(page.getByTestId("metric-externalActions")).toHaveText("2");
    const beforeRetry = databaseEvidence();
    expect(beforeRetry).toMatchObject({ uses: 2, actions: 2, outbox: 2 });
    await page.reload();
    await expect(page.getByTestId("operation-status")).toContainText("OUTCOME UNKNOWN");
    await expect(page.getByText("2 of 3 uses available", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Use next slot" })).toBeDisabled();
    await page.getByRole("button", { name: "Retry last request" }).click();
    await expect(page.getByTestId("operation-status")).toHaveText(
      "RETRY MATCHED · RECEIPT RECOVERED"
    );
    await expect(page.getByTestId("operation-status")).toHaveAttribute("data-tone", "retry");
    expect(wire).toHaveLength(2);
    expect(wire[1]).toBe(wire[0]);
    expect(databaseEvidence()).toEqual(beforeRetry);
    expect(beforeRetry.receipts).toContain(await page.getByTestId("wallet-receipt").textContent());
    await expect(page.getByTestId("metric-retryUsageDelta")).toHaveText("0");
    await expect(page.getByTestId("metric-retryActionDelta")).toHaveText("0");

    await page.getByRole("button", { name: "Use next slot" }).click();
    await expect(page.getByText("0 of 3 uses available", { exact: true })).toBeVisible();
    await expect(page.getByTestId("metric-externalActions")).toHaveText("3");
    const beforeRejection = databaseEvidence();
    expect(beforeRejection).toMatchObject({ uses: 3, actions: 3, outbox: 3 });
    await page.getByRole("button", { name: "Attempt fourth use" }).click();
    await expect(page.getByTestId("operation-status")).toHaveText(
      "FOURTH USE REJECTED · NO ACCEPTANCE"
    );
    await expect(page.getByTestId("operation-status")).toHaveAttribute("data-tone", "rejection");
    expect(databaseEvidence()).toEqual(beforeRejection);
    await page.getByRole("button", { name: "Run privacy audit" }).click();
    await expect(page.getByTestId("evidence-overall")).toContainText("PASS", { timeout: 20_000 });
    const response = await request.get(`${apiBase}/v1/demo/evidence`);
    expect(response.ok()).toBe(true);
    const evidence = evidenceReportSchema.parse(await response.json());
    expect(evidence.overall).toBe("PASS");
    expect(Object.values(evidence.checks).every((check) => check.status === "PASS")).toBe(true);
    expect(evidence.counts).toMatchObject({
      committedUses: 3,
      externalActions: 3,
      retryUsageDelta: 0,
      retryActionDelta: 0,
      failedAttemptUses: 0,
    });
    expect(evidence.uses.map((use) => use.receiptId).sort()).toEqual(beforeRejection.receipts);
    expect(evidence.linkability.pairs.filter((pair) => pair.result === "UNLINKABLE")).toHaveLength(
      3
    );
    expect(evidence.linkability.pairs.filter((pair) => pair.result === "SAME_USE")).toHaveLength(1);
    const safeEvents = await (await request.get(`${apiBase}/v1/demo/events/stream`)).text();
    const privateMarkers = wire
      .map((body) => JSON.parse(body) as { opaqueProof: string; nullifier: string })
      .flatMap((body) => [body.opaqueProof, body.nullifier]);
    assertNoForbiddenData(
      [evidence, beforeRejection.safePayloads, beforeRejection.safeRows, safeEvents],
      { markers: privateMarkers }
    );
    await expect(page.getByTestId("protocol-trace")).toContainText("Retry");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    expect(errors).toEqual([]);
    const elapsedMs = Date.now() - started;
    expect(elapsedMs).toBeLessThan(180_000);
    await testInfo.attach("rehearsal-evidence", {
      body: JSON.stringify({ elapsedMs, evidence }),
      contentType: "application/json",
    });
    await page.screenshot({ path: testInfo.outputPath("demo-lab.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
  });
}

test("Phase 5 preserves and exactly retries a use whose acknowledgement is lost", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle("AnonLimit — Demo Lab");
  await expect(
    page.getByRole("heading", { name: "Three uses. Zero identity.", exact: true })
  ).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("API and database connected");

  await page.getByRole("button", { name: "Issue anonymous pass" }).click();
  await expect(page.getByText("Credential ready", { exact: true })).toBeVisible();
  await expect(page.getByText("3 of 3 uses available", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Use next slot" }).click();
  await expect(page.getByText("COMMITTED", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("NEW ACCEPTANCE · RECEIPT STORED", { exact: true })).toBeVisible();
  await expect(page.getByText("2 of 3 uses available", { exact: true })).toBeVisible();

  const presentationRequests: { readonly body: string; readonly idempotencyKey: string }[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/v1/verifier/presentations"
    ) {
      presentationRequests.push({
        body: request.postData() ?? "",
        idempotencyKey: request.headers()["idempotency-key"] ?? "",
      });
    }
  });

  await page.getByRole("button", { name: "Drop next acknowledgement" }).click();
  await expect(page.getByText("FAULT ARMED · NEXT ACKNOWLEDGEMENT", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Use next slot" }).click();
  await expect(
    page.getByText("ACKNOWLEDGEMENT DROPPED · OUTCOME UNKNOWN", { exact: true })
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("OUTCOME_UNKNOWN", { exact: true })).toBeVisible();
  await expect(page.getByText("2 of 3 uses available", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use next slot" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Retry last request" })).toBeEnabled();
  expect(presentationRequests).toHaveLength(1);

  await page.reload();
  await expect(
    page.getByText("ACKNOWLEDGEMENT DROPPED · OUTCOME UNKNOWN", { exact: true })
  ).toBeVisible();
  await expect(page.getByText("OUTCOME_UNKNOWN", { exact: true })).toBeVisible();
  await expect(page.getByText("2 of 3 uses available", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry last request" })).toBeEnabled();

  await page.getByRole("button", { name: "Retry last request" }).click();
  await expect(page.getByText("RETRY MATCHED · RECEIPT RECOVERED", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("COMMITTED", { exact: true })).toBeVisible();
  await expect(page.getByText("1 of 3 uses available", { exact: true })).toBeVisible();
  expect(presentationRequests).toHaveLength(2);
  expect(presentationRequests[1]).toEqual(presentationRequests[0]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});

test("an exact resend can be the first request accepted by the verifier", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText("API and database connected");
  await page.getByRole("button", { name: "Issue anonymous pass" }).click();
  await expect(page.getByText("3 of 3 uses available", { exact: true })).toBeVisible();

  const presentationRequests: { readonly body: string; readonly idempotencyKey: string }[] = [];
  await page.route("**/v1/verifier/presentations", async (route) => {
    const request = route.request();
    presentationRequests.push({
      body: request.postData() ?? "",
      idempotencyKey: request.headers()["idempotency-key"] ?? "",
    });
    if (presentationRequests.length === 1) await route.abort("failed");
    else await route.continue();
  });

  await page.getByRole("button", { name: "Use next slot" }).click();
  await expect(page.getByText("RESPONSE LOST · OUTCOME UNKNOWN", { exact: true })).toBeVisible();
  await expect(page.getByText("3 of 3 uses available", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Retry last request" }).click();
  await expect(
    page.getByText("STORED REQUEST ACCEPTED · RECEIPT STORED", { exact: true })
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("2 of 3 uses available", { exact: true })).toBeVisible();
  expect(presentationRequests).toHaveLength(2);
  expect(presentationRequests[1]).toEqual(presentationRequests[0]);
});

test("an unaccepted expired request rebuilds a proof for the same reserved slot", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText("API and database connected");
  await page.getByRole("button", { name: "Issue anonymous pass" }).click();

  const presentationBodies: string[] = [];
  await page.route("**/v1/verifier/presentations", async (route) => {
    const body = route.request().postData() ?? "";
    presentationBodies.push(body);
    if (presentationBodies.length === 1) {
      await route.abort("failed");
      return;
    }
    if (presentationBodies.length === 2) {
      await route.fulfill({
        status: 410,
        headers: {
          "Access-Control-Allow-Origin": "http://localhost:5173",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code: "CHALLENGE_EXPIRED",
          traceId: "00000000-0000-4000-8000-000000000099",
          usageDelta: 0,
          actionDelta: 0,
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: "Use next slot" }).click();
  await expect(page.getByText("RESPONSE LOST · OUTCOME UNKNOWN", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry last request" }).click();
  await expect(
    page.getByText("STORED REQUEST ACCEPTED · RECEIPT STORED", { exact: true })
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("2 of 3 uses available", { exact: true })).toBeVisible();

  expect(presentationBodies).toHaveLength(3);
  expect(presentationBodies[1]).toBe(presentationBodies[0]);
  const original = JSON.parse(presentationBodies[0] ?? "null") as Record<string, unknown>;
  const refreshed = JSON.parse(presentationBodies[2] ?? "null") as Record<string, unknown>;
  expect(refreshed.operationId).toBe(original.operationId);
  expect(refreshed.nullifier).toBe(original.nullifier);
  expect(refreshed.action).toEqual(original.action);
  expect(refreshed.challengeId).not.toBe(original.challengeId);
});
