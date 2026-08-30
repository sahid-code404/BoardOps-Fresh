import { expect, test, type APIResponse, type Page } from "@playwright/test";

const API = "http://127.0.0.1:8787";
const ADMIN_EMAIL = "admin@boardops.local";
const ADMIN_PASSWORD = "BoardOps@Fresh#2026!A7";
const RESIDENT_ID = "usr_resident_riya_local";
const RESIDENT_EMAIL = "riya@boardops.local";
const RESIDENT_PASSWORD = "BoardOps@Settings#2026!";

async function json<T>(response: APIResponse): Promise<T> {
  return response.json() as Promise<T>;
}

async function expectPermissionDenied(response: APIResponse, permission: string) {
  expect(response.status()).toBe(403);
  await expect(response.json()).resolves.toMatchObject({
    success: false,
    error: "Permission denied",
    requiredPermission: permission,
  });
}

async function loginAdminShell(page: Page) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(ADMIN_EMAIL);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(ADMIN_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 5_000 });
}

test("Settings, Policies, and Holidays are validated, scoped, audited, and fail closed", async ({ browser }) => {
  test.setTimeout(75_000);
  const adminContext = await browser.newContext();
  const residentContext = await browser.newContext();
  const shellContext = await browser.newContext();

  try {
    const adminApi = adminContext.request;
    const residentApi = residentContext.request;
    const adminLogin = await adminApi.post(`${API}/api/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(adminLogin.ok()).toBeTruthy();

    const institutionResponse = await adminApi.get(`${API}/api/institution`);
    expect(institutionResponse.status()).toBe(200);
    const institution = await json<{
      success: boolean;
      data: {
        id: string;
        name: string;
        type: string;
        address: string | null;
        contactEmail: string | null;
        contactPhone: string | null;
        currency: string;
        timezone: string;
      };
    }>(institutionResponse);
    expect(institution.data).toMatchObject({
      id: "inst_boardops_local",
      name: "BoardOps Institute",
      type: "HOSTEL",
      address: "Bengaluru, Karnataka",
      contactEmail: "office@boardops.local",
      contactPhone: "+918000000000",
      currency: "INR",
      timezone: "Asia/Kolkata",
    });

    const currencyRewrite = await adminApi.put(`${API}/api/institution`, { data: { currency: "USD" } });
    expect(currencyRewrite.status()).toBe(409);
    await expect(currencyRewrite.json()).resolves.toMatchObject({
      success: false,
      error: "Currency cannot be changed after financial history exists",
    });

    const rename = await adminApi.put(`${API}/api/institution`, {
      data: { name: "BoardOps Institute Runtime" },
    });
    expect(rename.status()).toBe(200);
    expect((await json<{ data: { name: string } }>(rename)).data.name).toBe("BoardOps Institute Runtime");
    const restoreInstitution = await adminApi.put(`${API}/api/institution`, {
      data: { name: "BoardOps Institute" },
    });
    expect(restoreInstitution.status()).toBe(200);

    const settingsResponse = await adminApi.get(`${API}/api/settings`);
    expect(settingsResponse.status()).toBe(200);
    const settings = await json<{ data: Array<{ id: string; key: string; value: string; type: string; isPublic: boolean }> }>(settingsResponse);
    expect(settings.data).toHaveLength(4);
    expect(settings.data).toContainEqual(expect.objectContaining({
      key: "security.administratorNote",
      isPublic: false,
    }));

    const createSetting = await adminApi.post(`${API}/api/settings`, {
      data: {
        key: "general.runtimeCheckpoint",
        value: "v1",
        category: "GENERAL",
        type: "TEXT",
        description: "Runtime-only setting lifecycle proof",
        isPublic: false,
      },
    });
    expect(createSetting.status()).toBe(201);
    const createdSetting = await json<{ data: { id: string; key: string; value: string } }>(createSetting);
    expect(createdSetting.data.key).toBe("general.runtimeCheckpoint");
    expect(createdSetting.data.value).toBe("v1");

    const updateSetting = await adminApi.post(`${API}/api/settings`, {
      data: {
        key: "general.runtimeCheckpoint",
        value: "v2",
        category: "GENERAL",
        type: "TEXT",
        description: "Runtime-only setting lifecycle proof",
        isPublic: false,
      },
    });
    expect(updateSetting.status()).toBe(200);
    const updatedSetting = await json<{ data: { id: string; value: string } }>(updateSetting);
    expect(updatedSetting.data.id).toBe(createdSetting.data.id);
    expect(updatedSetting.data.value).toBe("v2");

    const invalidJson = await adminApi.post(`${API}/api/settings`, {
      data: {
        key: "general.runtimeInvalidJson",
        value: "{broken",
        category: "GENERAL",
        type: "JSON",
        isPublic: false,
      },
    });
    expect(invalidJson.status()).toBe(400);

    const policiesResponse = await adminApi.get(`${API}/api/policies`);
    expect(policiesResponse.status()).toBe(200);
    const policies = await json<{
      data: { categories: Array<{ category: string; label: string; policies: Array<{ key: string; value: string; type: string }> }> };
    }>(policiesResponse);
    expect(policies.data.categories).toContainEqual(expect.objectContaining({ category: "MEAL", label: "Meal Policies" }));
    expect(policies.data.categories).toContainEqual(expect.objectContaining({ category: "PAYMENT", label: "Payment Policies" }));

    const updatePolicy = await adminApi.put(`${API}/api/policies`, {
      data: { key: "policy.meal.allowLateChange", value: "true" },
    });
    expect(updatePolicy.status()).toBe(200);
    expect((await json<{ data: { value: string } }>(updatePolicy)).data.value).toBe("true");
    const invalidPolicyNumber = await adminApi.put(`${API}/api/policies`, {
      data: { key: "policy.meal.cutoffGraceMinutes", value: "not-a-number" },
    });
    expect(invalidPolicyNumber.status()).toBe(400);
    const restorePolicy = await adminApi.put(`${API}/api/policies`, {
      data: { key: "policy.meal.allowLateChange", value: "false" },
    });
    expect(restorePolicy.status()).toBe(200);

    const seededHolidaysResponse = await adminApi.get(`${API}/api/holidays?status=ACTIVE`);
    expect(seededHolidaysResponse.status()).toBe(200);
    const seededHolidays = await json<{ data: Array<{ id: string; name: string; mealsDisabled: boolean; status: string }> }>(seededHolidaysResponse);
    expect(seededHolidays.data).toHaveLength(2);
    expect(seededHolidays.data).toContainEqual(expect.objectContaining({
      id: "holiday_foundation_local",
      name: "Foundation Day",
      mealsDisabled: true,
      status: "ACTIVE",
    }));

    const createHoliday = await adminApi.post(`${API}/api/holidays`, {
      data: {
        name: "Runtime meal block",
        description: "Created by the serial real-D1 test",
        type: "MAINTENANCE",
        startDate: "2026-09-25",
        endDate: "2026-09-25",
        mealsDisabled: true,
      },
    });
    expect(createHoliday.status()).toBe(201);
    const runtimeHoliday = await json<{ data: { id: string; name: string; status: string } }>(createHoliday);
    expect(runtimeHoliday.data.status).toBe("ACTIVE");

    const invalidHoliday = await adminApi.post(`${API}/api/holidays`, {
      data: {
        name: "Invalid date range",
        type: "HOLIDAY",
        startDate: "2026-09-26",
        endDate: "2026-09-25",
        mealsDisabled: true,
      },
    });
    expect(invalidHoliday.status()).toBe(400);

    const patchHoliday = await adminApi.patch(`${API}/api/holidays/${runtimeHoliday.data.id}`, {
      data: { description: "Updated runtime holiday" },
    });
    expect(patchHoliday.status()).toBe(200);
    await expect(patchHoliday.json()).resolves.toMatchObject({
      success: true,
      data: { description: "Updated runtime holiday" },
    });

    // The holiday rule is enforced at D1, so current and future meal-write routes
    // cannot bypass it. Existing Kitchen guest creation and admin TURN_ON prove the
    // user-visible API fails closed with a conflict instead of writing meal evidence.
    const blockedGuest = await adminApi.post(`${API}/api/kitchen`, {
      data: { mealId: "meal_breakfast_local", serviceDate: "2026-09-25", guestCount: 1 },
    });
    expect(blockedGuest.status()).toBe(409);
    await expect(blockedGuest.json()).resolves.toMatchObject({
      success: false,
      error: "Meal booking is disabled for this holiday",
    });

    const blockedOverride = await adminApi.post(`${API}/api/meals/override`, {
      data: {
        mealId: "meal_breakfast_local",
        userId: RESIDENT_ID,
        serviceDate: "2026-09-25",
        action: "TURN_ON",
        reason: "Runtime holiday boundary proof",
      },
    });
    expect(blockedOverride.status()).toBe(409);

    const archiveHoliday = await adminApi.delete(`${API}/api/holidays/${runtimeHoliday.data.id}`);
    expect(archiveHoliday.status()).toBe(200);
    await expect(archiveHoliday.json()).resolves.toMatchObject({
      success: true,
      data: { id: runtimeHoliday.data.id, status: "ARCHIVED" },
    });
    const archivedHolidays = await adminApi.get(`${API}/api/holidays?status=ARCHIVED`);
    expect(archivedHolidays.status()).toBe(200);
    expect((await json<{ data: Array<{ id: string }> }>(archivedHolidays)).data).toContainEqual(
      expect.objectContaining({ id: runtimeHoliday.data.id }),
    );

    const deleteSetting = await adminApi.delete(`${API}/api/settings/general.runtimeCheckpoint`);
    expect(deleteSetting.status()).toBe(200);

    const setResidentPassword = await adminApi.put(`${API}/api/users/${RESIDENT_ID}`, {
      data: { password: RESIDENT_PASSWORD },
    });
    expect(setResidentPassword.ok()).toBeTruthy();
    const residentLogin = await residentApi.post(`${API}/api/auth/login`, {
      data: { email: RESIDENT_EMAIL, password: RESIDENT_PASSWORD },
    });
    expect(residentLogin.ok()).toBeTruthy();

    const residentSettings = await residentApi.get(`${API}/api/settings`);
    expect(residentSettings.status()).toBe(200);
    const residentSettingsData = await json<{ data: Array<{ key: string; isPublic: boolean }> }>(residentSettings);
    expect(residentSettingsData.data).toHaveLength(3);
    expect(residentSettingsData.data.every((setting) => setting.isPublic)).toBe(true);
    expect(residentSettingsData.data.some((setting) => setting.key === "security.administratorNote")).toBe(false);
    expect((await residentApi.get(`${API}/api/institution`)).status()).toBe(200);
    expect((await residentApi.get(`${API}/api/policies`)).status()).toBe(200);
    expect((await residentApi.get(`${API}/api/holidays?status=ACTIVE`)).status()).toBe(200);

    await expectPermissionDenied(
      await residentApi.post(`${API}/api/settings`, {
        data: { key: "general.denied", value: "x", category: "GENERAL", type: "TEXT", isPublic: false },
      }),
      "settings.write",
    );
    await expectPermissionDenied(
      await residentApi.delete(`${API}/api/settings/ui.dateFormat`),
      "settings.delete",
    );
    await expectPermissionDenied(
      await residentApi.put(`${API}/api/institution`, { data: { name: "Denied" } }),
      "institution.update",
    );
    await expectPermissionDenied(
      await residentApi.put(`${API}/api/policies`, { data: { key: "policy.meal.allowLateChange", value: "true" } }),
      "policies.update",
    );
    await expectPermissionDenied(
      await residentApi.post(`${API}/api/holidays`, {
        data: { name: "Denied", type: "HOLIDAY", startDate: "2026-10-01", endDate: "2026-10-01", mealsDisabled: true },
      }),
      "holidays.create",
    );
    await expectPermissionDenied(
      await residentApi.patch(`${API}/api/holidays/holiday_foundation_local`, { data: { name: "Denied" } }),
      "holidays.update",
    );
    await expectPermissionDenied(
      await residentApi.delete(`${API}/api/holidays/holiday_foundation_local`),
      "holidays.archive",
    );

    const page = await shellContext.newPage();
    await loginAdminShell(page);
    await page.getByRole("button", { name: "More navigation" }).click();
    const sidebar = page.getByRole("complementary");
    await expect(sidebar).toBeInViewport();
    await sidebar.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page).toHaveURL(/\/settings(?:\?|$)/, { timeout: 5_000 });
    await expect(page.getByRole("heading", { name: "Settings & Policies", exact: true })).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole("button", { name: "Add Setting", exact: true })).toBeVisible();

    const main = page.locator("main");
    await main.getByRole("tab", { name: "Policies", exact: true }).click();
    await expect(page.getByText("Institution Profile", { exact: true })).toBeVisible();
    await expect(page.getByDisplayValue("BoardOps Institute")).toBeVisible();
    await expect(page.getByText("Meal Policies", { exact: true })).toBeVisible();
    await expect(page.getByText("Payment Policies", { exact: true })).toBeVisible();

    await main.getByRole("tab", { name: "Calendar", exact: true }).click();
    await expect(page.getByRole("button", { name: "Add Holiday", exact: true }).first()).toBeVisible();
    await expect(page.getByText("Foundation Day", { exact: true })).toBeVisible();
    await expect(page.getByText("Dining hall maintenance", { exact: true })).toBeVisible();
    await expect(page.getByText("Meals Disabled", { exact: true })).toBeVisible();
  } finally {
    await shellContext.close();
    await residentContext.close();
    await adminContext.close();
  }
});
