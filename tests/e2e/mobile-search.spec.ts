import { expect, test } from "@playwright/test";

test("touch-only compact mobile users can open Search without shell overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();

  const shellGeometry = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(shellGeometry.documentWidth).toBeLessThanOrEqual(shellGeometry.viewportWidth + 2);

  // The golden top bar intentionally hides Search below the sm breakpoint, so
  // the drawer provides the required touch entry point instead of relying on a
  // hardware keyboard shortcut that phone users may not have.
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Open menu", exact: true }).click();

  const sidebar = page.locator("aside");
  await expect(sidebar).toHaveAttribute("aria-hidden", "false");
  await expect(sidebar.getByRole("button", { name: "Search BoardOps", exact: true })).toBeVisible();
  await sidebar.getByRole("button", { name: "Search BoardOps", exact: true }).click();
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");

  const commandDialog = page.locator('[data-slot="dialog-content"]').filter({
    has: page.getByPlaceholder("Search navigation and actions…"),
  });
  const commandInput = commandDialog.getByPlaceholder("Search navigation and actions…");
  await expect(commandDialog).toBeVisible();
  await expect(commandInput).toBeVisible();
  await commandInput.fill("users");
  await commandDialog.getByText("User Management", { exact: true }).click();

  await expect(page).toHaveURL(/\/users(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "User Management", exact: true })).toBeVisible();

  const routedGeometry = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(routedGeometry.documentWidth).toBeLessThanOrEqual(routedGeometry.viewportWidth + 2);
});
