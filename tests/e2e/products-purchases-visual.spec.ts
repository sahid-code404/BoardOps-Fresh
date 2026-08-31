import { expect, test } from "@playwright/test";

test("Expenses hub exposes the expenses-only surface and hides retired procurement tabs", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/expenses");
  const main = page.locator("main");

  await expect(page.getByRole("heading", { name: "Expenses", exact: true })).toBeVisible();
  await expect(main.getByRole("button", { name: "Add Expense", exact: true })).toBeVisible();
  await expect(main.getByText("Total Entries", { exact: true })).toBeVisible();

  // Purchases and Products were intentionally removed from the Expenses UX.
  await expect(main.getByRole("tab", { name: "Expenses", exact: true })).toHaveCount(0);
  await expect(main.getByRole("tab", { name: "Purchases", exact: true })).toHaveCount(0);
  await expect(main.getByRole("tab", { name: "Products", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Purchases & Shopping", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Product Catalog", exact: true })).toHaveCount(0);

  const health = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    mainHeight: document.querySelector("main")?.getBoundingClientRect().height ?? 0,
  }));
  expect(health.scrollWidth).toBeLessThanOrEqual(health.viewportWidth + 2);
  expect(health.mainHeight).toBeGreaterThan(100);
  expect(pageErrors).toEqual([]);
});
