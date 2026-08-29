import { expect, test, type Page } from "@playwright/test";

async function openRoute(page: Page, path: string, expectedTitle: string) {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(path);
  await expect(page.getByRole("heading", { name: expectedTitle, exact: true })).toBeVisible();
  await page.waitForTimeout(350);
  expect(new URL(page.url()).pathname).toBe(path);
  expect(pageErrors).toEqual([]);
}

const ADMIN_ROUTES = [
  ["/dashboard", "Dashboard"],
  ["/meals", "Meal Configuration"],
  ["/user-meals", "Meals"],
  ["/kitchen", "Meal Counts"],
  ["/billing", "Billing & Closing"],
  ["/payments", "Payments & Wallet"],
  ["/expenses", "Expenses & Procurement"],
  ["/funds", "Funds Overview"],
  ["/monthly-closing", "Monthly Closing"],
  ["/formula-engine", "Formula Engine"],
  ["/users", "User Management"],
  ["/notifications", "Notifications & Announcements"],
  ["/settings", "Settings & Policies"],
  ["/system", "System (Audit & Tasks)"],
  ["/profile", "My Profile"],
] as const;

test("plain visual-mode root canonicalizes to the dashboard route", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(page.getByText("Total Users", { exact: true })).toBeVisible();
  await expect(page.getByText("Meals ON Today", { exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/dashboard");
});

test("authentication panel remains visible on a cold unauthenticated render", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/dashboard?auth=1");
  await expect(page.getByText("Operations Suite", { exact: true })).toBeVisible();
  await expect(page.locator("form").getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
});

for (const [path, title] of ADMIN_ROUTES) {
  test(`admin route ${path} renders without a page error`, async ({ page }) => {
    await openRoute(page, path, title);
  });
}

test("dashboard fixture content renders", async ({ page }) => {
  await openRoute(page, "/dashboard", "Dashboard");
  await expect(page.getByText("Admin Console", { exact: true })).toBeVisible();
  await expect(page.getByText("Total Users", { exact: true })).toBeVisible();
  await expect(page.getByText("Meals ON Today", { exact: true })).toBeVisible();
});

test("meal configuration renders from visual fixtures", async ({ page }) => {
  await openRoute(page, "/meals", "Meal Configuration");
  await expect(page.getByText("Breakfast", { exact: true }).first()).toBeVisible();
});

test("resident meal schedule renders without backend", async ({ page }) => {
  await openRoute(page, "/user-meals", "Meals");
  await expect(page.getByText("Breakfast", { exact: true }).first()).toBeVisible();
});

test("user management renders deterministic residents", async ({ page }) => {
  await openRoute(page, "/users", "User Management");
  await expect(page.getByText("Riya Sen", { exact: true })).toBeVisible();
});

test("notifications and profile render in fixture mode", async ({ page }) => {
  await openRoute(page, "/notifications", "Notifications & Announcements");
  await expect(page.getByText("Monthly statement is ready", { exact: true })).toBeVisible();
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "My Profile", exact: true })).toBeVisible();
  await expect(page.getByText("Aarav Sharma", { exact: true }).first()).toBeVisible();
});

test("legacy query navigation is canonicalized to a real route", async ({ page }) => {
  await page.goto("/?view=users");
  await expect(page.getByRole("heading", { name: "User Management", exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/users");
  expect(new URL(page.url()).searchParams.has("view")).toBe(false);
});

test("normal navigation preloads the route chunk instead of flashing a lazy skeleton", async ({ page }) => {
  await openRoute(page, "/dashboard", "Dashboard");
  await page.getByLabel("Primary navigation").getByRole("button", { name: "Payments", exact: true }).click();
  await expect(page.getByLabel("Loading section")).toHaveCount(0);
  await expect(page).toHaveURL(/\/payments(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Payments & Wallet", exact: true })).toBeVisible();
});

test("More navigation opens a usable sidebar", async ({ page }) => {
  await openRoute(page, "/dashboard", "Dashboard");
  await page.getByRole("button", { name: "More navigation" }).click();
  const sidebar = page.getByRole("complementary");
  await expect(sidebar).toBeInViewport();
  await sidebar.getByRole("button", { name: "Meal Configuration", exact: true }).click();
  await expect(page).toHaveURL(/\/meals(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Meal Configuration", exact: true })).toBeVisible();
});

test("browser back restores the previous BoardOps route", async ({ page }) => {
  await openRoute(page, "/dashboard", "Dashboard");
  await page.getByLabel("Primary navigation").getByRole("button", { name: "Users", exact: true }).click();
  await expect(page).toHaveURL(/\/users(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "User Management", exact: true })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
});

test("mobile shell keeps the routed dashboard usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRoute(page, "/dashboard", "Dashboard");
  await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
});
