import { expect, test } from "@playwright/test";

const EMAIL = "admin@boardops.local";
const PASSWORD = "BoardOps@Fresh#2026!A7";

test("validated account theme is reapplied after browser-local preference disagrees", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(EMAIL);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(PASSWORD);
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();

  const saved = await page.evaluate(async () => {
    const response = await fetch("/api/auth/profile", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: "dark" }),
    });
    return response.ok;
  });
  expect(saved).toBe(true);

  // Deliberately create the mismatch that previously produced a light page
  // while Profile/TopBar reported the server-saved Dark preference.
  await page.evaluate(() => window.localStorage.setItem("theme", "light"));
  await page.reload();

  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.locator("html")).toHaveClass(/\bdark\b/, { timeout: 5_000 });

  // Restore the deterministic seed preference so later/manual local sessions
  // start from the normal system setting.
  await page.evaluate(async () => {
    await fetch("/api/auth/profile", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: "system" }),
    });
  });
});
