import { expect, test } from "@playwright/test";

test("Reports and Analytics preserve all five lazy report surfaces", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "More navigation" }).click();
  const sidebar = page.getByRole("complementary");
  await expect(sidebar).toBeInViewport();
  await sidebar.getByRole("button", { name: "Reports", exact: true }).click();

  await expect(page).toHaveURL(/\/reports(?:\?|$)/);
  const heading = page.getByRole("heading", { name: "Reports & Analytics", exact: true });
  await expect(heading).toBeVisible();
  await expect(page.getByText("Financial, meal, purchase, and resident reports with CSV export.", { exact: true })).toBeVisible();

  const reportNav = page.getByRole("tablist", { name: "Section navigation" });
  await expect(reportNav).toBeVisible();
  await expect(page.getByRole("tab", { name: "Financial", exact: true })).toHaveAttribute("aria-selected", "true");

  const centeredGeometry = await page.evaluate(() => {
    const tablist = document.querySelector('[role="tablist"][aria-label="Section navigation"]') as HTMLElement | null;
    const heading = Array.from(document.querySelectorAll("h1")).find((node) => node.textContent?.includes("Reports & Analytics")) as HTMLElement | undefined;
    const tabRect = tablist?.getBoundingClientRect();
    const iconRect = heading?.querySelector("svg")?.getBoundingClientRect();
    const headingTextNode = heading
      ? Array.from(heading.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes("Reports & Analytics"))
      : undefined;
    let textRect: DOMRect | undefined;
    if (headingTextNode) {
      const range = document.createRange();
      range.selectNodeContents(headingTextNode);
      textRect = range.getBoundingClientRect();
    }
    const headingContentCenter = iconRect && textRect
      ? (Math.min(iconRect.left, textRect.left) + Math.max(iconRect.right, textRect.right)) / 2
      : -1;
    return {
      viewportCenter: window.innerWidth / 2,
      tabCenter: tabRect ? tabRect.left + tabRect.width / 2 : -1,
      headingContentCenter,
    };
  });
  expect(Math.abs(centeredGeometry.tabCenter - centeredGeometry.viewportCenter)).toBeLessThanOrEqual(16);
  expect(Math.abs(centeredGeometry.headingContentCenter - centeredGeometry.viewportCenter)).toBeLessThanOrEqual(16);

  await expect(page.getByText("Total Expenses", { exact: true })).toBeVisible();
  await expect(page.getByText("₹5,100", { exact: true })).toBeVisible();
  await expect(page.getByText("Net Position", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Export Bills CSV/ })).toBeVisible();

  await page.getByRole("tab", { name: "Meals", exact: true }).click();
  await expect(page.getByText("Total Meals", { exact: true })).toBeVisible();
  await expect(page.getByText("Per-Meal Breakdown", { exact: true })).toBeVisible();
  await expect(page.getByText("Breakfast", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Purchases", exact: true }).click();
  await expect(page.getByText("Total Spend", { exact: true })).toBeVisible();
  await expect(page.getByText("Purchase Count", { exact: true })).toBeVisible();
  await expect(page.getByText("₹600", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Rice", { exact: true })).toBeVisible();
  await expect(page.getByText("Local Market", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Export CSV/ })).toBeVisible();

  await page.getByRole("tab", { name: "Outstanding", exact: true }).click();
  await expect(page.getByText("Total Outstanding", { exact: true })).toBeVisible();
  await expect(page.getByText("Arjun Rao", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Residents", exact: true }).click();
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
    await expect(page.getByRole("tablist", { name: "Section navigation" })).toBeVisible();
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
