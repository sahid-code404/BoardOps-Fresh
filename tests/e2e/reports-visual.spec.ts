import { expect, test } from "@playwright/test";

test("Reports and Analytics preserve all five lazy report surfaces", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "More navigation" }).click();
  const sidebar = page.getByRole("complementary");
  await expect(sidebar).toBeInViewport();
  await sidebar.getByRole("button", { name: "Reports", exact: true }).click();

  await expect(page).toHaveURL(/\/reports(?:\?|$)/);
  const main = page.locator("main");
  const heading = main.getByRole("heading", { name: "Reports & Analytics", exact: true });
  await expect(heading).toBeVisible();
  await expect(main.getByText("Financial, meal, purchase, and resident reports with CSV export.", { exact: true })).toBeVisible();

  const reportNav = main.getByRole("tablist", { name: "Section navigation" });
  await expect(reportNav).toBeVisible();
  await expect(main.getByRole("tab", { name: "Financial", exact: true })).toHaveAttribute("aria-selected", "true");

  const headingBox = await heading.boundingBox();
  const reportNavBox = await reportNav.boundingBox();
  const viewport = page.viewportSize();
  expect(headingBox).not.toBeNull();
  expect(reportNavBox).not.toBeNull();
  expect(viewport).not.toBeNull();

  const viewportCenter = viewport!.width / 2;
  const headingCenter = headingBox!.x + headingBox!.width / 2;
  const reportNavCenter = reportNavBox!.x + reportNavBox!.width / 2;
  expect(Math.abs(reportNavCenter - viewportCenter)).toBeLessThanOrEqual(16);
  expect(Math.abs(headingCenter - reportNavCenter)).toBeLessThanOrEqual(16);
  await expect(heading).toHaveCSS("justify-content", "center");

  await expect(main.getByText("Total Expenses", { exact: true })).toBeVisible();
  await expect(main.getByText("₹5,100", { exact: true })).toBeVisible();
  await expect(main.getByText("Net Position", { exact: true })).toBeVisible();
  await expect(main.getByRole("button", { name: /Export Bills CSV/ })).toBeVisible();

  await main.getByRole("tab", { name: "Meals", exact: true }).click();
  await expect(main.getByText("Total Meals", { exact: true })).toBeVisible();
  await expect(main.getByText("Per-Meal Breakdown", { exact: true })).toBeVisible();
  await expect(main.getByText("Breakfast", { exact: true })).toBeVisible();

  await main.getByRole("tab", { name: "Purchases", exact: true }).click();
  await expect(main.getByText("Total Spend", { exact: true })).toBeVisible();
  await expect(main.getByText("Purchase Count", { exact: true })).toBeVisible();
  await expect(main.getByText("₹600", { exact: true }).first()).toBeVisible();
  await expect(main.getByText("Rice", { exact: true })).toBeVisible();
  await expect(main.getByText("Local Market", { exact: true })).toBeVisible();
  await expect(main.getByRole("button", { name: /Export CSV/ })).toBeVisible();

  await main.getByRole("tab", { name: "Outstanding", exact: true }).click();
  await expect(main.getByText("Total Outstanding", { exact: true })).toBeVisible();
  await expect(main.getByText("Arjun Rao", { exact: true })).toBeVisible();

  await main.getByRole("tab", { name: "Residents", exact: true }).click();
  await expect(main.getByText("Residents", { exact: true })).toBeVisible();
  await expect(main.getByText("Riya Sen", { exact: true })).toBeVisible();
  await expect(main.getByText("OVERDUE", { exact: true })).toBeVisible();

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
    const main = page.locator("main");
    await expect(main.getByRole("heading", { name: "Reports & Analytics", exact: true })).toBeVisible();
    await expect(main.getByRole("tablist", { name: "Section navigation" })).toBeVisible();
    await expect(main.getByText("Total Expenses", { exact: true })).toBeVisible();
    const geometry = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      mainHeight: document.querySelector("main")?.getBoundingClientRect().height ?? 0,
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 2);
    expect(geometry.mainHeight).toBeGreaterThan(100);
  });
}
