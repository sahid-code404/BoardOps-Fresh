import { expect, test } from "@playwright/test";

test("Profile and Personalization preserve the golden self-service surface", async ({ page }) => {
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "My Profile", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "BoardOps Admin", exact: true })).toBeVisible();
  await expect(page.getByText("admin@boardops.local", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload avatar", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit Profile", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Change Password/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Active Sessions/ })).toBeVisible();
  await expect(page.getByText("Contact", { exact: true })).toBeVisible();
  await expect(page.getByText("Preferences", { exact: true })).toBeVisible();
  await expect(page.locator("main").getByRole("button", { name: "Light", exact: true }).first()).toBeVisible();
  await expect(page.locator("main").getByRole("button", { name: "Dark", exact: true }).first()).toBeVisible();
  await expect(page.locator("main").getByRole("button", { name: "System", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign Out", exact: true }).last()).toBeVisible();

  await page.getByRole("button", { name: "Edit Profile", exact: true }).click();
  const editor = page.locator('[data-slot="dialog-content"], [data-slot="sheet-content"]').filter({
    has: page.getByRole("heading", { name: "Edit Profile", exact: true }),
  });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("Full Name", { exact: true })).toBeVisible();
  await expect(editor.getByLabel("Phone", { exact: true })).toBeVisible();
  await expect(editor.getByLabel("Room", { exact: true })).toBeVisible();
  await expect(editor.getByLabel("Emergency Contact", { exact: true })).toBeVisible();
  await expect(editor.getByText("Theme", { exact: true })).toBeVisible();
  await expect(editor.getByText("Language", { exact: true })).toBeVisible();
  await expect(editor.getByText("Timezone", { exact: true })).toBeVisible();
  await expect(editor.getByRole("button", { name: "Save Changes", exact: true })).toBeVisible();

  const health = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    mainText: (document.querySelector("main")?.textContent || "").trim().length,
  }));
  expect(health.scrollWidth).toBeLessThanOrEqual(health.width + 2);
  expect(health.mainText).toBeGreaterThan(100);
});

for (const profile of [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const) {
  test(`Profile stays layout-safe on ${profile.name}`, async ({ page }) => {
    await page.setViewportSize({ width: profile.width, height: profile.height });
    await page.goto("/profile");
    await expect(page.getByRole("heading", { name: "My Profile", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "BoardOps Admin", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit Profile", exact: true })).toBeVisible();
    await expect(page.getByText("Preferences", { exact: true })).toBeVisible();

    const geometry = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      mainHeight: document.querySelector("main")?.getBoundingClientRect().height ?? 0,
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 2);
    expect(geometry.mainHeight).toBeGreaterThan(100);
  });
}
