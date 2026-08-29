import { expect, test, type Page } from "@playwright/test";

async function openView(page: Page, view: string, expectedTitle: string) {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`/?view=${view}`);
  await expect(page.getByRole("heading", { name: expectedTitle, exact: true })).toBeVisible();
  await page.waitForTimeout(350);
  expect(pageErrors).toEqual([]);
}

test("plain visual-mode root cold-loads with visible dashboard content", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(page.getByText("Total Users", { exact: true })).toBeVisible();
  await expect(page.getByText("Meals ON Today", { exact: true })).toBeVisible();
});

test("admin dashboard golden-master shell renders", async ({ page }) => {
  await openView(page, "dashboard", "Dashboard");
  await expect(page.getByText("Admin Console", { exact: true })).toBeVisible();
  await expect(page.getByText("Total Users", { exact: true })).toBeVisible();
  await expect(page.getByText("Meals ON Today", { exact: true })).toBeVisible();
});

test("meal configuration renders from visual fixtures", async ({ page }) => {
  await openView(page, "meals", "Meal Configuration");
  await expect(page.getByText("Breakfast", { exact: true }).first()).toBeVisible();
});

test("resident meal schedule renders without backend", async ({ page }) => {
  await openView(page, "user-meals", "Meals");
  await expect(page.getByText("Breakfast", { exact: true }).first()).toBeVisible();
});

test("user management renders deterministic residents", async ({ page }) => {
  await openView(page, "users", "User Management");
  await expect(page.getByText("Riya Sen", { exact: true })).toBeVisible();
});

test("notifications and profile render in fixture mode", async ({ page }) => {
  await openView(page, "notifications", "Notifications & Announcements");
  await expect(page.getByText("Monthly statement is ready", { exact: true })).toBeVisible();
  await page.goto("/?view=profile");
  await expect(page.getByRole("heading", { name: "My Profile", exact: true })).toBeVisible();
  await expect(page.getByText("Aarav Sharma", { exact: true }).first()).toBeVisible();
});

test("mobile shell keeps the dashboard usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openView(page, "dashboard", "Dashboard");
  await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
});
