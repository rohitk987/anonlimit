import { expect, test } from "@playwright/test";
test("Phase 3 shows actual readiness and honestly unavailable browser flow", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("AnonLimit — Durable Acceptance");
  await expect(
    page.getByRole("heading", { name: "Durable acceptance", exact: true })
  ).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("API and database connected");
  await expect(
    page.getByText("Backend acceptance ready · Browser workflow unavailable")
  ).toBeVisible();
  await page.getByRole("button", { name: "Check connection" }).click();
  await expect(page.getByRole("status")).toHaveText("API and database connected");
  await page.screenshot({ path: "test-results/phase3-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Durable acceptance", exact: true })
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await page.screenshot({ path: "test-results/phase3-mobile.png", fullPage: true });
  await page.route("**/health/ready", (route) => route.abort());
  await page.getByRole("button", { name: "Check connection" }).click();
  await expect(page.getByRole("status")).toHaveText("API unavailable — check local services");
  await page.unroute("**/health/ready");
  await page.getByRole("button", { name: "Check connection" }).click();
  await expect(page.getByRole("status")).toHaveText("API and database connected");
});
