import { expect, test, type Page } from "@playwright/test";

async function loginAsAdmin(page: Page) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("admin@boardops.local");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("BoardOps@Fresh#2026!A7");
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 5_000 });
}

async function profileRequest<T>(page: Page, method: "GET" | "PUT", body?: unknown) {
  return page.evaluate(
    async ({ method, body }) => {
      const response = await fetch("/api/auth/profile", {
        method,
        credentials: "include",
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      return { status: response.status, payload };
    },
    { method, body },
  ) as Promise<{ status: number; payload: T }>;
}

test("Profile and Personalization persist self-service data securely", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "Open profile", exact: true }).click();
  await expect(page).toHaveURL(/\/profile(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "My Profile", exact: true })).toBeVisible();

  const baseline = await profileRequest<{
    success: boolean;
    data: {
      name: string;
      email: string;
      phone?: string;
      role: string;
      status: string;
      room?: string;
      gender?: string | null;
      emergencyContact?: string | null;
      theme?: string;
      language?: string;
      timezone?: string;
    };
  }>(page, "GET");
  expect(baseline.status).toBe(200);
  const original = baseline.payload.data;

  try {
    await page.getByRole("button", { name: "Edit Profile", exact: true }).click();
    const editor = page.locator('[data-slot="dialog-content"], [data-slot="sheet-content"]').filter({
      has: page.getByRole("heading", { name: "Edit Profile", exact: true }),
    });
    await expect(editor).toBeVisible();
    await editor.getByLabel("Full Name", { exact: true }).fill("BoardOps Admin Profile Probe");
    await editor.getByLabel("Phone", { exact: true }).fill("+919000000777");
    await editor.getByLabel("Room", { exact: true }).fill("PROFILE-PROBE");
    await editor.getByLabel("Emergency Contact", { exact: true }).fill("+919000008888");

    const saveResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/auth/profile"
        && response.request().method() === "PUT",
    );
    await editor.getByRole("button", { name: "Save Changes", exact: true }).click();
    await expect((await saveResponse).status()).toBe(200);
    await expect(page.getByRole("heading", { name: "BoardOps Admin Profile Probe", exact: true })).toBeVisible();
    await expect(page.getByText("+919000000777", { exact: true })).toBeVisible();
    await expect(page.getByText("PROFILE-PROBE", { exact: true })).toBeVisible();

    const persisted = await profileRequest<{ success: boolean; data: Record<string, unknown> }>(page, "GET");
    expect(persisted.status).toBe(200);
    expect(persisted.payload.data).toMatchObject({
      name: "BoardOps Admin Profile Probe",
      phone: "+919000000777",
      room: "PROFILE-PROBE",
      emergencyContact: "+919000008888",
      email: "admin@boardops.local",
      role: "ADMIN",
      status: "ACTIVE",
    });

    const privilegeProbe = await profileRequest<{ success: boolean; data: Record<string, unknown> }>(page, "PUT", {
      email: "attacker@boardops.local",
      role: "USER",
      status: "SUSPENDED",
    });
    expect(privilegeProbe.status).toBe(200);
    expect(privilegeProbe.payload.data).toMatchObject({
      email: "admin@boardops.local",
      role: "ADMIN",
      status: "ACTIVE",
    });

    const shortPhone = await profileRequest<{ success: boolean; error: string }>(page, "PUT", { phone: "1234567" });
    expect(shortPhone.status).toBe(400);
    expect(shortPhone.payload.error).toContain("8 to 32");

    const duplicatePhone = await profileRequest<{ success: boolean; error: string }>(page, "PUT", {
      phone: "+919123456789",
    });
    expect(duplicatePhone.status).toBe(409);
    expect(duplicatePhone.payload.error).toBe("This phone number is already in use");

    const invalidTheme = await profileRequest<{ success: boolean; error: string }>(page, "PUT", { theme: "neon" });
    expect(invalidTheme.status).toBe(400);
    expect(invalidTheme.payload.error).toBe("Invalid theme");

    const themeResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/auth/profile"
        && response.request().method() === "PUT",
    );
    await page.locator("main").getByRole("button", { name: "Dark", exact: true }).first().click();
    await expect((await themeResponse).status()).toBe(200);
    await expect.poll(async () => {
      const state = await profileRequest<{ success: boolean; data: { theme: string } }>(page, "GET");
      return state.payload.data.theme;
    }).toBe("dark");

    let avatarAuthorization: string | undefined;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/auth/avatar" && request.method() === "POST") {
        avatarAuthorization = request.headers()["authorization"];
      }
    });

    const avatarResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/auth/avatar"
        && response.request().method() === "POST",
    );
    await page.locator('input[type="file"][accept*="image/jpeg"]').setInputFiles({
      name: "profile-probe.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    const uploaded = await avatarResponse;
    expect(uploaded.status()).toBe(200);
    expect(avatarAuthorization).toBeUndefined();

    const avatarImage = await page.evaluate(async () => {
      const response = await fetch("/api/auth/avatar/image", { credentials: "include" });
      return {
        status: response.status,
        contentType: response.headers.get("content-type"),
        size: (await response.arrayBuffer()).byteLength,
      };
    });
    expect(avatarImage.status).toBe(200);
    expect(avatarImage.contentType).toContain("image/png");
    expect(avatarImage.size).toBeGreaterThan(0);
  } finally {
    await profileRequest(page, "PUT", {
      name: original.name,
      phone: original.phone ?? null,
      room: original.room ?? null,
      gender: original.gender ?? null,
      emergencyContact: original.emergencyContact ?? null,
      theme: original.theme ?? "system",
      language: original.language ?? "en",
      timezone: original.timezone ?? "Asia/Kolkata",
    });
  }
});
