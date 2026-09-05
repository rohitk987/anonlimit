import { expect, test } from "@playwright/test";
test("foundation shows actual readiness and honestly unavailable product flow", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle("AnonLimit — Foundation");
  await expect(page.getByRole("heading", { name: "Repository foundation" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("API and database connected");
  await expect(page.getByText("Foundation only · Product workflow unavailable")).toBeVisible();
  await page.getByRole("button", { name: "Check connection" }).click();
  await expect(page.getByRole("status")).toHaveText("API and database connected");
  await page.screenshot({ path: "test-results/foundation-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Repository foundation" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await page.screenshot({ path: "test-results/foundation-mobile.png", fullPage: true });
  await page.route("**/health/ready", (route) => route.abort());
  await page.getByRole("button", { name: "Check connection" }).click();
  await expect(page.getByRole("status")).toHaveText("API unavailable — check local services");
  await page.unroute("**/health/ready");
  await page.getByRole("button", { name: "Check connection" }).click();
  await expect(page.getByRole("status")).toHaveText("API and database connected");
});
