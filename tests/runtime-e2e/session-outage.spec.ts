import { expect, test } from "@playwright/test";

const EMAIL = "admin@boardops.local";
const PASSWORD = "BoardOps@Fresh#2026!A7";

test("temporary session-service failure does not throw the user back to login", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(EMAIL);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(PASSWORD);
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();

  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ success: false, error: "temporary test outage" }),
    });
  });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Unable to verify your session", exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole("button", { name: "Try Again", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Email", exact: true })).toHaveCount(0);

  const persistedHint = await page.evaluate(() => window.localStorage.getItem("boardops-auth"));
  expect(persistedHint).toContain("cookie-session");

  await page.unroute("**/api/auth/me");
  await page.getByRole("button", { name: "Try Again", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("Total Users", { exact: true })).toBeVisible();
});
