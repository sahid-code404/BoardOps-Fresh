import { expect, test } from "@playwright/test";

test("real local runtime loads the complete administrator shell", async ({ page }) => {
  const failedApiResponses: string[] = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/") && response.status() >= 400) {
      failedApiResponses.push(`${response.status()} ${url.pathname}`);
    }
  });

  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Password", exact: true })).toBeVisible();

  await page.getByRole("textbox", { name: "Email", exact: true }).fill("admin@boardops.local");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("BoardOps@Fresh#2026!A7");
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 5_000 });

  // Essential account identity is available independently of dashboard-domain
  // data, so a slow/failed KPI request can never leave the administrator with
  // an anonymous shell.
  await expect(page.getByText("Signed in administrator", { exact: true })).toBeVisible();
  await expect(page.getByText("BoardOps Admin", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("admin@boardops.local", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("ACTIVE", { exact: true })).toBeVisible();
  await expect(page.getByText("Total Users", { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByLabel("Loading dashboard data")).toHaveCount(0, { timeout: 5_000 });

  // Golden-master glass/background prerequisites must be installed in the real
  // runtime, not only in the fixture build.
  await expect(page.locator(".mesh-bg")).toHaveCount(1);
  await expect(page.locator("html")).toHaveAttribute("data-glass-mode", "on");
  await expect(page.locator("html")).toHaveAttribute("data-blur-intensity", "normal");
  await expect(page.locator("html")).toHaveAttribute("data-transparency", "medium");

  const mesh = await page.locator(".mesh-bg").evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      backgroundImage: style.backgroundImage,
      width: rect.width,
      height: rect.height,
    };
  });
  expect(mesh.backgroundImage).not.toBe("none");
  expect(mesh.width).toBeGreaterThan(300);
  expect(mesh.height).toBeGreaterThan(300);

  await page.getByRole("button", { name: "View profile", exact: true }).click();
  await expect(page).toHaveURL(/\/profile(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "My Profile", exact: true })).toBeVisible();
  await expect(page.getByText("BoardOps Admin", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("admin@boardops.local", { exact: true }).first()).toBeVisible();

  expect(failedApiResponses).toEqual([]);
});
