import { expect, test } from "@playwright/test";

test("Expenses procurement hub exposes purchases and product catalog surfaces", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/expenses");
  const main = page.locator("main");

  await expect(main.getByRole("tab", { name: "Expenses", exact: true })).toBeVisible();
  await expect(main.getByRole("tab", { name: "Purchases", exact: true })).toBeVisible();
  await expect(main.getByRole("tab", { name: "Products", exact: true })).toBeVisible();

  await main.getByRole("tab", { name: "Purchases", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Purchases & Shopping", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New Purchase", exact: true })).toBeVisible();
  await expect(page.getByText("Local Market", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("₹600", { exact: true }).first()).toBeVisible();

  await main.getByRole("tab", { name: "Products", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Product Catalog", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Manage Units", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Product", exact: true })).toBeVisible();
  await expect(page.getByText("Rice", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Cooking Oil", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Eggs", { exact: true }).first()).toBeVisible();

  const health = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    mainHeight: document.querySelector("main")?.getBoundingClientRect().height ?? 0,
  }));
  expect(health.scrollWidth).toBeLessThanOrEqual(health.viewportWidth + 2);
  expect(health.mainHeight).toBeGreaterThan(100);
  expect(pageErrors).toEqual([]);
});
