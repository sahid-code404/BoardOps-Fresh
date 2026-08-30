import { expect, test } from "@playwright/test";

test("visual Monthly Closing preserves readiness and immutable-close contract", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 5_000 });

  await page.getByRole("button", { name: "More navigation" }).click();
  const sidebar = page.getByRole("complementary");
  await expect(sidebar).toBeInViewport();
  await sidebar.getByRole("button", { name: "Monthly Closing", exact: true }).click();

  await expect(page).toHaveURL(/\/monthly-closing(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Monthly Closing", exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("Readiness Checklist", { exact: true })).toBeVisible({ timeout: 5_000 });

  await expect(page.getByText("Meal entries locked", { exact: true })).toBeVisible();
  await expect(page.getByText("Expenses reviewed", { exact: true })).toBeVisible();
  await expect(page.getByText("Billing formula valid", { exact: true })).toBeVisible();
  await expect(page.getByText("Resident accounts ready", { exact: true })).toBeVisible();
  await expect(page.getByText("Resolve errors before closing", { exact: true })).toHaveCount(0);

  const closeButton = page.getByRole("button", { name: /^Close [A-Z][a-z]+ \d{4}$/u });
  await expect(closeButton).toBeVisible();
  await closeButton.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: /^Close [A-Z][a-z]+ \d{4}$/u })).toBeVisible();
  await expect(dialog.getByText(/freeze all data into an immutable snapshot/u)).toBeVisible();
  await expect(dialog.getByText(/execute the formula engine, generate bills, and settle resident fund accounts/u)).toBeVisible();
  await expect(dialog.getByText("Expenses", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Residents", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/Due Date \(optional/u)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Execute Closing", exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
