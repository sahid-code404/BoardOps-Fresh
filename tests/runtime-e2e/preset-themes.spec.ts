import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:8787";
const ADMIN_EMAIL = "admin@boardops.local";
const ADMIN_PASSWORD = "BoardOps@Fresh#2026!A7";
const RESIDENT_EMAIL = "riya@boardops.local";
const RESIDENT_PASSWORD = "BoardOps@Settings#2026!";

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
  await page.goto("/");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(ADMIN_EMAIL);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(ADMIN_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 5_000 });
}

test("Preset Themes preview, persist publicly, reload, and remain administrator-controlled", async ({ page, browser }) => {
  test.setTimeout(90_000);
  await loginAsAdmin(page);

  // Use an explicit API session for setup/cleanup instead of borrowing the page
  // session. The browser portion below still performs the real golden UI save;
  // this merely keeps fixture management deterministic across proxy/cookie paths.
  const adminContext = await browser.newContext();
  const residentContext = await browser.newContext();
  const anonymousContext = await browser.newContext();
  const adminApi = adminContext.request;
  let original: Setting | null = null;

  try {
    const adminLogin = await adminApi.post(`${API}/api/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(adminLogin.ok()).toBeTruthy();

    const settingsBefore = await adminApi.get(`${API}/api/settings`);
    expect(settingsBefore.ok()).toBeTruthy();
    const settingsBeforeBody = await settingsBefore.json() as { success: boolean; data: Setting[] };
    original = settingsBeforeBody.data.find((entry) => entry.key === "ui.theme") ?? null;

    const primaryNav = page.getByRole("navigation", { name: "Primary navigation" });
    await primaryNav.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page).toHaveURL(/\/settings(?:\?|$)/, { timeout: 5_000 });
    await page.getByRole("tab", { name: "Appearance", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Preset Themes", exact: true })).toBeVisible({ timeout: 5_000 });
    const oceanButton = page.getByRole("button", { name: /Ocean/u });
    await expect(oceanButton).toBeVisible({ timeout: 5_000 });
    await oceanButton.click();

    await expect.poll(async () => page.evaluate(() => ({
      primary: document.documentElement.style.getPropertyValue("--primary").trim(),
      accent: document.documentElement.style.getPropertyValue("--accent").trim(),
    })), { timeout: 5_000 }).toEqual({ primary: OCEAN.primary, accent: OCEAN.accent });

    const saveResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/settings" && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Save Changes", exact: true }).click();
    expect((await saveResponse).status()).toBeLessThan(300);

    const authenticatedTheme = await adminApi.get(`${API}/api/theme`);
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

    const publicTheme = await anonymousContext.request.get(`${API}/api/theme`);
    expect(publicTheme.status()).toBe(200);
    await expect(publicTheme.json()).resolves.toMatchObject({
      success: true,
      data: {
        preset: OCEAN.preset,
        primary: OCEAN.primary,
        accent: OCEAN.accent,
      },
    });

    await page.reload();
    await expect(page).toHaveURL(/\/settings(?:\?|$)/, { timeout: 5_000 });
    await page.getByRole("tab", { name: "Appearance", exact: true }).click();
    await expect(page.getByRole("button", { name: /Ocean/u })).toHaveClass(/border-primary/u, { timeout: 5_000 });

    const residentLogin = await residentContext.request.post(`${API}/api/auth/login`, {
      data: { email: RESIDENT_EMAIL, password: RESIDENT_PASSWORD },
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
    });
    expect(residentWrite.status()).toBe(403);
    await expect(residentWrite.json()).resolves.toMatchObject({
      success: false,
      error: "Permission denied",
      requiredPermission: "settings.write",
    });
  } finally {
    if (original) {
      const restore = await adminApi.post(`${API}/api/settings`, { data: original });
      expect(restore.ok()).toBeTruthy();
    } else {
      const cleanup = await adminApi.delete(`${API}/api/settings/ui.theme`);
      expect(cleanup.status()).toBe(200);
    }

    await adminContext.close();
    await residentContext.close();
    await anonymousContext.close();
  }
});
