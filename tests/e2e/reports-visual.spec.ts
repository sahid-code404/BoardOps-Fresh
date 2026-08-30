import { expect, test } from "@playwright/test";

test("Reports and Analytics preserve all five lazy report surfaces", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "More navigation" }).click();
  const sidebar = page.getByRole("complementary");
  await expect(sidebar).toBeInViewport();
  await sidebar.getByRole("button", { name: "Reports", exact: true }).click();

  await expect(page).toHaveURL(/\/reports(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Reports & Analytics", exact: true })).toBeVisible();
  await expect(page.getByText("Financial, meal, purchase, and resident reports with CSV export.", { exact: true })).toBeVisible();
  await expect(page.getByText("Total Expenses", { exact: true })).toBeVisible();
  await expect(page.getByText("₹4,500", { exact: true })).toBeVisible();
  await expect(page.getByText("Net Position", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Export Bills CSV/ })).toBeVisible();

  await page.getByRole("button", { name: "Meals", exact: true }).click();
  await expect(page.getByText("Total Meals", { exact: true })).toBeVisible();
  await expect(page.getByText("Per-Meal Breakdown", { exact: true })).toBeVisible();
  await expect(page.getByText("Breakfast", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Purchases", exact: true }).click();
  await expect(page.getByText("Total Spend", { exact: true })).toBeVisible();
  await expect(page.getByText("Purchase Count", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Export CSV/ })).toBeVisible();

  await page.getByRole("button", { name: "Outstanding", exact: true }).click();
  await expect(page.getByText("Total Outstanding", { exact: true })).toBeVisible();
  await expect(page.getByText("Arjun Rao", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Residents", exact: true }).click();
  await expect(page.getByText("Residents", { exact: true })).toBeVisible();
  await expect(page.getByText("Riya Sen", { exact: true })).toBeVisible();
  await expect(page.getByText("OVERDUE", { exact: true })).toBeVisible();

  const health = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    mainText: (document.querySelector("main")?.textContent || "").trim().length,
  }));
  expect(health.scrollWidth).toBeLessThanOrEqual(health.width + 2);
  expect(health.mainText).toBeGreaterThan(80);
});

for (const profile of [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const) {
  test(`Reports stays layout-safe on ${profile.name}`, async ({ page }) => {
    await page.setViewportSize({ width: profile.width, height: profile.height });
    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: "Reports & Analytics", exact: true })).toBeVisible();
    await expect(page.getByText("Total Expenses", { exact: true })).toBeVisible();
    const geometry = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      mainHeight: document.querySelector("main")?.getBoundingClientRect().height ?? 0,
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 2);
    expect(geometry.mainHeight).toBeGreaterThan(100);
  });
}
