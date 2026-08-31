import { expect, test } from "@playwright/test";

const PRESETS = ["Violet", "Ocean", "Sunset", "Forest", "Rose", "Midnight", "Graphite", "Emerald"];

test("Preset Themes preserves the complete golden appearance surface", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("tab", { name: "Appearance", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Appearance", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Preset Themes", exact: true })).toBeVisible();
  for (const preset of PRESETS) {
    await expect(page.getByRole("button", { name: new RegExp(`^${preset}`) })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Custom Colors", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Corner Radius", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Live Preview", exact: true })).toBeVisible();

  const ocean = page.getByRole("button", { name: /^Ocean/u });
  await ocean.click();
  await expect(ocean).toHaveClass(/border-primary/u);
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save Changes", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Save & Apply", exact: true })).toBeEnabled();

  const health = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    primary: document.documentElement.style.getPropertyValue("--primary").trim(),
    accent: document.documentElement.style.getPropertyValue("--accent").trim(),
  }));
  expect(health.scrollWidth).toBeLessThanOrEqual(health.width + 2);
  expect(health.primary).toBe("#06b6d4");
  expect(health.accent).toBe("#3b82f6");
});
