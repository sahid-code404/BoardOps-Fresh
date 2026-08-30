import { expect, test } from "@playwright/test";

test("Settings, Policies, Appearance, and Calendar preserve the golden Settings hub", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings & Policies", exact: true })).toBeVisible();

  const main = page.locator("main");
  for (const label of ["Institution", "Policies", "Appearance", "Calendar"] as const) {
    await expect(main.getByRole("tab", { name: label, exact: true }).first()).toBeVisible();
  }

  // Institution/system-settings surface remains recognizable even when the visual
  // fixture deliberately has no arbitrary Setting rows.
  await expect(page.getByRole("button", { name: "Add Setting", exact: true })).toBeVisible();
  await expect(page.getByText("No settings in this category yet.", { exact: true })).toBeVisible();

  await main.getByRole("tab", { name: "Policies", exact: true }).click();
  await expect(page.getByText("Institution Profile", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Institution Name", { exact: true })).toHaveValue("BoardOps Residence");
  await expect(page.getByText("Meal Policies", { exact: true })).toBeVisible();
  await expect(page.getByText("Payment Policies", { exact: true })).toBeVisible();
  await expect(page.getByText("Meal → Allow Late Change", { exact: true })).toBeVisible();
  await expect(page.getByText("Payment → Require Reference", { exact: true })).toBeVisible();

  await main.getByRole("tab", { name: "Appearance", exact: true }).click();
  await expect(page.getByText(/Appearance|Theme|Glass/i).first()).toBeVisible();

  await main.getByRole("tab", { name: "Calendar", exact: true }).click();
  await expect(page.getByText("No holidays configured", { exact: true })).toBeVisible();
  await expect(page.getByText("Add holidays, festivals, or maintenance windows to automatically manage meal availability.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add Holiday", exact: true }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add Holiday", exact: true })).toBeVisible();
  await expect(page.getByText("Holidays with meals disabled automatically prevent meal booking for the affected dates.", { exact: true })).toBeVisible();
  await expect(page.getByText("Disable meals during this period", { exact: true })).toBeVisible();

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
  test(`Settings hub stays layout-safe on ${profile.name}`, async ({ page }) => {
    await page.setViewportSize({ width: profile.width, height: profile.height });
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings & Policies", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add Setting", exact: true })).toBeVisible();

    const main = page.locator("main");
    await main.getByRole("tab", { name: "Policies", exact: true }).click();
    await expect(page.getByText("Institution Profile", { exact: true })).toBeVisible();
    await main.getByRole("tab", { name: "Calendar", exact: true }).click();
    await expect(page.getByText("No holidays configured", { exact: true })).toBeVisible();

    const geometry = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      mainHeight: document.querySelector("main")?.getBoundingClientRect().height ?? 0,
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 2);
    expect(geometry.mainHeight).toBeGreaterThan(100);
  });
}
