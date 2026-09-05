import { expect, test } from "@playwright/test";

test("Phase 4 completes one wallet use and preserves the receipt on refresh", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("AnonLimit — First Complete Use");
  await expect(
    page.getByRole("heading", { name: "Complete one anonymous use", exact: true })
  ).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("API and database connected");

  await page.getByRole("button", { name: "Issue anonymous pass" }).click();
  await expect(page.getByText("Credential ready", { exact: true })).toBeVisible();
  await expect(page.getByText("3 of 3 uses available", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Use next slot" }).click();
  await expect(page.getByText("COMMITTED", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("2 of 3 uses available", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText("Credential ready", { exact: true })).toBeVisible();
  await expect(page.getByText("2 of 3 uses available", { exact: true })).toBeVisible();
  await expect(page.getByText("COMMITTED", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});
