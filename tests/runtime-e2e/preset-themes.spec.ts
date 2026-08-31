import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:8787";
const ADMIN_EMAIL = "admin@boardops.local";
const ADMIN_PASSWORD = "BoardOps@Fresh#2026!A7";
const RESIDENT_EMAIL = "riya@boardops.local";
const RESIDENT_PASSWORD = "BoardOps@Settings#2026!";
const UI_TIMEOUT = 5_000;
const API_TIMEOUT = 5_000;

const OCEAN = {
  primary: "#06b6d4",
  primaryForeground: "#ffffff",
  accent: "#3b82f6",
  radius: "1.25rem",
  preset: "ocean",
  glassMode: "on",
  blurIntensity: "normal",
  transparency: "medium",
};

type Setting = {
  key: string;
  value: string;
  category: string;
  type: string;
  description: string | null;
  isPublic: boolean;
};

async function loginAsAdmin(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 10_000 });
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(ADMIN_EMAIL, { timeout: UI_TIMEOUT });
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(ADMIN_PASSWORD, { timeout: UI_TIMEOUT });
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click({ timeout: UI_TIMEOUT });
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: UI_TIMEOUT });
}

test("Preset Themes preview, persist publicly, reload, and remain administrator-controlled", async ({ page, browser }) => {
  test.setTimeout(60_000);

  await test.step("authenticate administrator browser", async () => {
    await loginAsAdmin(page);
  });

  const adminContext = await browser.newContext();
  const residentContext = await browser.newContext();
  const anonymousContext = await browser.newContext();
  const adminApi = adminContext.request;
  let original: Setting | null = null;

  try {
    await test.step("capture the original global theme", async () => {
      const adminLogin = await adminApi.post(`${API}/api/auth/login`, {
        data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
        timeout: API_TIMEOUT,
      });
      expect(adminLogin.ok()).toBeTruthy();

      const settingsBefore = await adminApi.get(`${API}/api/settings`, { timeout: API_TIMEOUT });
      expect(settingsBefore.ok()).toBeTruthy();
      const settingsBeforeBody = await settingsBefore.json() as { success: boolean; data: Setting[] };
      original = settingsBeforeBody.data.find((entry) => entry.key === "ui.theme") ?? null;
    });

    await test.step("open Appearance and live-preview Ocean", async () => {
      // Navigation itself is covered by the authenticated-shell suite; this
      // checkpoint goes directly to the owning Settings surface so a shell
      // animation cannot hide a Preset Themes persistence failure.
      await page.goto("/settings", { waitUntil: "domcontentloaded", timeout: 10_000 });
      await expect(page).toHaveURL(/\/settings(?:\?|$)/, { timeout: UI_TIMEOUT });

      const appearanceTab = page.getByRole("tab", { name: "Appearance", exact: true });
      await expect(appearanceTab).toBeVisible({ timeout: UI_TIMEOUT });
      await appearanceTab.click({ timeout: UI_TIMEOUT });

      await expect(page.getByRole("heading", { name: "Preset Themes", exact: true })).toBeVisible({ timeout: UI_TIMEOUT });
      const oceanButton = page.getByRole("button", { name: /Ocean/u });
      await expect(oceanButton).toBeVisible({ timeout: UI_TIMEOUT });
      await oceanButton.click({ timeout: UI_TIMEOUT });

      await expect.poll(async () => page.evaluate(() => ({
        primary: document.documentElement.style.getPropertyValue("--primary").trim(),
        accent: document.documentElement.style.getPropertyValue("--accent").trim(),
      })), { timeout: UI_TIMEOUT }).toEqual({ primary: OCEAN.primary, accent: OCEAN.accent });
    });

    await test.step("save Ocean through the golden UI", async () => {
      const saveResponse = page.waitForResponse(
        (response) => new URL(response.url()).pathname === "/api/settings" && response.request().method() === "POST",
        { timeout: 10_000 },
      );
      await page.getByRole("button", { name: "Save Changes", exact: true }).click({ timeout: UI_TIMEOUT });
      expect((await saveResponse).status()).toBeLessThan(300);
    });

    await test.step("read the persisted theme through authenticated and public contracts", async () => {
      const authenticatedTheme = await adminApi.get(`${API}/api/theme`, { timeout: API_TIMEOUT });
      expect(authenticatedTheme.status()).toBe(200);
      await expect(authenticatedTheme.json()).resolves.toMatchObject({
        success: true,
        data: {
          preset: OCEAN.preset,
          primary: OCEAN.primary,
          accent: OCEAN.accent,
          radius: OCEAN.radius,
        },
      });

      const publicTheme = await anonymousContext.request.get(`${API}/api/theme`, { timeout: API_TIMEOUT });
      expect(publicTheme.status()).toBe(200);
      await expect(publicTheme.json()).resolves.toMatchObject({
        success: true,
        data: {
          preset: OCEAN.preset,
          primary: OCEAN.primary,
          accent: OCEAN.accent,
        },
      });
    });

    await test.step("fresh-load Settings and recover the saved Ocean selection", async () => {
      await page.goto("/settings", { waitUntil: "domcontentloaded", timeout: 10_000 });
      await expect(page).toHaveURL(/\/settings(?:\?|$)/, { timeout: UI_TIMEOUT });

      const appearanceTab = page.getByRole("tab", { name: "Appearance", exact: true });
      await expect(appearanceTab).toBeVisible({ timeout: UI_TIMEOUT });
      await appearanceTab.click({ timeout: UI_TIMEOUT });
      await expect(page.getByRole("button", { name: /Ocean/u })).toHaveClass(/border-primary/u, { timeout: UI_TIMEOUT });
    });

    await test.step("deny a resident global theme overwrite", async () => {
      const residentLogin = await residentContext.request.post(`${API}/api/auth/login`, {
        data: { email: RESIDENT_EMAIL, password: RESIDENT_PASSWORD },
        timeout: API_TIMEOUT,
      });
      expect(residentLogin.ok()).toBeTruthy();

      const residentWrite = await residentContext.request.post(`${API}/api/settings`, {
        data: {
          key: "ui.theme",
          value: JSON.stringify({ ...OCEAN, preset: "sunset", primary: "#f97316", accent: "#ec4899" }),
          category: "UI",
          type: "JSON",
          description: "Unauthorized theme overwrite probe",
          isPublic: true,
        },
        timeout: API_TIMEOUT,
      });
      expect(residentWrite.status()).toBe(403);
      await expect(residentWrite.json()).resolves.toMatchObject({
        success: false,
        error: "Permission denied",
        requiredPermission: "settings.write",
      });
    });
  } finally {
    if (original) {
      const restore = await adminApi.post(`${API}/api/settings`, { data: original, timeout: API_TIMEOUT });
      expect(restore.ok()).toBeTruthy();
    } else {
      const cleanup = await adminApi.delete(`${API}/api/settings/ui.theme`, { timeout: API_TIMEOUT });
      expect(cleanup.status()).toBe(200);
    }

    await adminContext.close();
    await residentContext.close();
    await anonymousContext.close();
  }
});
