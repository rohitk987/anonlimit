import { expect, test } from "@playwright/test";

test("Phase 5 preserves and exactly retries a use whose acknowledgement is lost", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle("AnonLimit — Safe Retry");
  await expect(
    page.getByRole("heading", { name: "Recover a lost acknowledgement", exact: true })
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
