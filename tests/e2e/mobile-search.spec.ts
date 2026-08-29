import { expect, test } from "@playwright/test";

test("touch-only mobile users can open the command palette from the drawer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();

  // The top-bar Search control is intentionally hidden below the sm breakpoint,
  // so the drawer must provide the documented touch entry point.
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Open menu", exact: true }).click();

  const sidebar = page.locator("aside");
  await expect(sidebar).toHaveAttribute("aria-hidden", "false");
  await sidebar.getByRole("button", { name: "Search BoardOps", exact: true }).click();
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");

  const commandInput = page.getByPlaceholder("Search navigation and actions…");
  await expect(commandInput).toBeVisible();
  await commandInput.fill("users");
  await page
    .locator('[data-slot="dialog-content"]')
    .getByText("User Management", { exact: true })
    .click();

  await expect(page).toHaveURL(/\/users(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "User Management", exact: true })).toBeVisible();
});
