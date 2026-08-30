import { expect, test } from "@playwright/test";

test("visual Formula Engine renders deterministic Variables and Formula versions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 5_000 });

  await page.getByRole("button", { name: "More navigation" }).click();
  const sidebar = page.getByRole("complementary");
  await expect(sidebar).toBeInViewport();
  await sidebar.getByRole("button", { name: "Formula Engine", exact: true }).click();

  await expect(page).toHaveURL(/\/formula-engine(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Formula Engine", exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("button", { name: "Variables", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Formulas", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Variable", exact: true })).toBeVisible();

  await expect(page.getByText("Total", { exact: true })).toBeVisible();
  await expect(page.getByText("System", { exact: true })).toBeVisible();
  await expect(page.getByText("Custom", { exact: true })).toBeVisible();
  await expect(page.getByText("Categories", { exact: true })).toBeVisible();
  await expect(page.getByText("Monthly Room Rent", { exact: true })).toBeVisible();
  await expect(page.getByText("Cleaning Charges", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Formulas", exact: true }).click();
  await expect(page.getByText("Total Formulas", { exact: true })).toBeVisible();
  await expect(page.getByText("Variables Available", { exact: true })).toBeVisible();
  await expect(page.getByText("Meal Charges", { exact: true })).toBeVisible();
  await expect(page.getByText("formula.mealCharges", { exact: true })).toBeVisible();
  await expect(page.getByText("Total Bill", { exact: true })).toBeVisible();
  await expect(page.getByText("Due Amount", { exact: true })).toBeVisible();
  await expect(page.getByText("Late Fee", { exact: true })).toBeVisible();
  await expect(page.getByText("No formulas found", { exact: true })).toHaveCount(0);
});
