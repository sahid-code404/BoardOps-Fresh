import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:8787";
const ADMIN_EMAIL = "admin@boardops.local";
const ADMIN_PASSWORD = "BoardOps@Fresh#2026!A7";
const RESIDENT_EMAIL = "browser.expenses.resident@example.test";
const RESIDENT_PASSWORD = "BoardOps@Expenses#2026!";

test("Expenses renders real D1 data and preserves accounting history through replacement", async ({ page }) => {
  test.setTimeout(55_000);

  const failedExpenseResponses: Array<{ url: string; status: number }> = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/expenses") && response.status() >= 500) {
      failedExpenseResponses.push({ url: response.url(), status: response.status() });
    }
  });

  await page.goto("/");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(ADMIN_EMAIL);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(ADMIN_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 5_000 });

  // Expenses is a desktop sidebar destination rather than a primary bottom-nav item.
  await page.getByRole("button", { name: "Expenses", exact: true }).click();
  await expect(page).toHaveURL(/\/expenses(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByText("Monthly groceries", { exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("Electricity bill", { exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("₹3,000", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("₹1,500", { exact: true }).first()).toBeVisible();

  const result = await page.evaluate(async () => {
    const request = async (path: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
      const response = await fetch(path, {
        credentials: "include",
        ...init,
        headers,
      });
      return { status: response.status, body: await response.json() };
    };

    const seeded = await request("/api/expenses?month=7&year=2026&limit=500");

    const noKey = await request("/api/expenses", {
      method: "POST",
      body: JSON.stringify({
        title: "No key expense",
        category: "GENERAL",
        quantity: 1,
        unit: "piece",
        amount: 10,
        expenseDate: "2026-08-25T12:00:00.000Z",
      }),
    });

    const fractionalPaise = await request("/api/expenses", {
      method: "POST",
      headers: { "Idempotency-Key": "expenses-admin-e2e-fraction-v1" },
      body: JSON.stringify({
        title: "Fractional paise expense",
        category: "GENERAL",
        quantity: 1,
        unit: "piece",
        amount: 12.345,
        expenseDate: "2026-08-25T12:00:00.000Z",
      }),
    });

    const createKey = "expenses-admin-e2e-create-v1";
    const createPayload = {
      title: "Runtime groceries",
      category: "GROCERY",
      quantity: 2,
      unit: "box",
      amount: 123.45,
      description: "Runtime expense idempotency proof",
      expenseDate: "2026-08-25T12:00:00.000Z",
    };
    const created = await request("/api/expenses", {
      method: "POST",
      headers: { "Idempotency-Key": createKey },
      body: JSON.stringify(createPayload),
    });
    const replay = await request("/api/expenses", {
      method: "POST",
      headers: { "Idempotency-Key": createKey },
      body: JSON.stringify(createPayload),
    });

    const createdId = created.body?.data?.id as string;
    const replacement = await request(`/api/expenses/${createdId}`, {
      method: "PUT",
      headers: { "Idempotency-Key": "expenses-admin-e2e-replace-v1" },
      body: JSON.stringify({
        ...createPayload,
        title: "Runtime groceries corrected",
        amount: 222.22,
        description: "Replacement accounting proof",
      }),
    });
    const replacementId = replacement.body?.data?.id as string;
    const originalAfterReplacement = await request(`/api/expenses/${createdId}`);
    const approvedAfterReplacement = await request("/api/expenses?month=7&year=2026&limit=500");

    const deleteReversedDenied = await request(`/api/expenses/${createdId}`, {
      method: "DELETE",
      body: JSON.stringify({ reason: "Reversed history must remain immutable" }),
    });

    const deleted = await request(`/api/expenses/${replacementId}`, {
      method: "DELETE",
      body: JSON.stringify({ reason: "Runtime expense recovery test" }),
    });
    const deletionQueue = await request("/api/expenses?month=7&year=2026&includeDeleted=true&limit=500");
    const approvedAfterDelete = await request("/api/expenses?month=7&year=2026&limit=500");
    const restored = await request(`/api/expenses/${replacementId}/restore`, {
      method: "POST",
      body: "{}",
    });
    const approvedAfterRestore = await request("/api/expenses?month=7&year=2026&limit=500");

    const closedPeriod = await request("/api/expenses", {
      method: "POST",
      headers: { "Idempotency-Key": "expenses-admin-e2e-closed-v1" },
      body: JSON.stringify({
        title: "Closed July expense",
        category: "GENERAL",
        quantity: 1,
        unit: "piece",
        amount: 99.99,
        expenseDate: "2026-07-15T12:00:00.000Z",
      }),
    });

    return {
      seeded,
      noKey,
      fractionalPaise,
      created,
      replay,
      replacement,
      originalAfterReplacement,
      approvedAfterReplacement,
      deleteReversedDenied,
      deleted,
      deletionQueue,
      approvedAfterDelete,
      restored,
      approvedAfterRestore,
      closedPeriod,
    };
  });

  expect(result.seeded.status).toBe(200);
  expect(result.seeded.body.data).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "expense_grocery_aug_2026_local", title: "Monthly groceries", amount: 3000, status: "APPROVED" }),
      expect.objectContaining({ id: "expense_utilities_aug_2026_local", title: "Electricity bill", amount: 1500, status: "APPROVED" }),
    ]),
  );

  expect(result.noKey.status).toBe(400);
  expect(result.noKey.body).toMatchObject({ success: false, error: "Idempotency-Key header is required" });
  expect(result.fractionalPaise.status).toBe(422);
  expect(String(result.fractionalPaise.body.error)).toContain("at most two decimal places");

  expect(result.created.status).toBe(201);
  expect(result.created.body).toMatchObject({
    success: true,
    data: { title: "Runtime groceries", amount: 123.45, status: "APPROVED" },
  });
  expect(result.replay.status).toBe(200);
  expect(result.replay.body.data.id).toBe(result.created.body.data.id);
  expect(result.replay.body.data.amount).toBe(123.45);

  expect(result.replacement.status).toBe(200);
  expect(result.replacement.body.data.id).not.toBe(result.created.body.data.id);
  expect(result.replacement.body).toMatchObject({
    success: true,
    data: {
      title: "Runtime groceries corrected",
      amount: 222.22,
      status: "APPROVED",
      replacesExpenseId: result.created.body.data.id,
    },
  });
  expect(result.originalAfterReplacement.body).toMatchObject({
    success: true,
    data: {
      id: result.created.body.data.id,
      status: "REVERSED",
      replacedByExpenseId: result.replacement.body.data.id,
    },
  });
  expect(result.approvedAfterReplacement.body.data.some((row: { id: string }) => row.id === result.created.body.data.id)).toBe(false);
  expect(result.approvedAfterReplacement.body.data.some((row: { id: string }) => row.id === result.replacement.body.data.id)).toBe(true);

  expect(result.deleteReversedDenied.status).toBe(422);
  expect(String(result.deleteReversedDenied.body.error)).toContain("history cannot be deleted");

  expect(result.deleted.status).toBe(200);
  expect(result.deleted.body).toMatchObject({
    success: true,
    data: { id: result.replacement.body.data.id, status: "DELETED", deletionReason: "Runtime expense recovery test" },
  });
  expect(result.deletionQueue.status).toBe(200);
  expect(result.deletionQueue.body.data).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: result.replacement.body.data.id, status: "DELETED", deletionReason: "Runtime expense recovery test" }),
    ]),
  );
  expect(result.approvedAfterDelete.body.data.some((row: { id: string }) => row.id === result.replacement.body.data.id)).toBe(false);

  expect(result.restored.status).toBe(200);
  expect(result.restored.body).toMatchObject({
    success: true,
    data: { id: result.replacement.body.data.id, status: "APPROVED", deletedAt: null },
  });
  expect(result.approvedAfterRestore.body.data.some((row: { id: string }) => row.id === result.replacement.body.data.id)).toBe(true);

  expect(result.closedPeriod.status).toBe(422);
  expect(String(result.closedPeriod.body.error)).toContain("2026-07 is not open");
  expect(failedExpenseResponses).toEqual([]);
});

test("Resident can read approved expenses but cannot mutate accounting evidence", async ({ browser }) => {
  test.setTimeout(45_000);

  const adminContext = await browser.newContext();
  const residentContext = await browser.newContext();

  try {
    const adminApi = adminContext.request;
    const residentApi = residentContext.request;

    const adminLogin = await adminApi.post(`${API}/api/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(adminLogin.ok()).toBeTruthy();

    const registration = await residentApi.post(`${API}/api/auth/register`, {
      data: {
        name: "Expenses Resident",
        institutionName: "BoardOps Institute",
        institutionUserId: "RES-EXPENSES-E2E",
        email: RESIDENT_EMAIL,
        phone: "+919876540620",
        password: RESIDENT_PASSWORD,
        confirmPassword: RESIDENT_PASSWORD,
        room: "EXP-620",
        gender: "OTHER",
        consents: { rules: true, privacy: true, terms: true },
      },
    });
    expect(registration.ok()).toBeTruthy();
    const registrationBody = await registration.json() as {
      success: boolean;
      data: { userId: string; email: string };
    };

    const verify = await residentApi.post(`${API}/api/auth/verify-email`, {
      data: { email: RESIDENT_EMAIL, otp: "424242" },
    });
    expect(verify.ok()).toBeTruthy();

    const approveResident = await adminApi.patch(`${API}/api/users/${registrationBody.data.userId}`, {
      data: { action: "APPROVE", reason: "Expenses resident runtime verification" },
    });
    expect(approveResident.ok()).toBeTruthy();

    const residentLogin = await residentApi.post(`${API}/api/auth/login`, {
      data: { email: RESIDENT_EMAIL, password: RESIDENT_PASSWORD },
    });
    expect(residentLogin.ok()).toBeTruthy();

    const read = await residentApi.get(`${API}/api/expenses?month=7&year=2026&limit=500`);
    expect(read.ok()).toBeTruthy();
    const readBody = await read.json() as { success: boolean; data: Array<{ id: string; status: string }> };
    expect(readBody.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "expense_grocery_aug_2026_local", status: "APPROVED" }),
        expect.objectContaining({ id: "expense_utilities_aug_2026_local", status: "APPROVED" }),
      ]),
    );

    const deniedCreate = await residentApi.post(`${API}/api/expenses`, {
      headers: { "Idempotency-Key": "expenses-resident-denied-create-v1" },
      data: {
        title: "Resident must not create",
        category: "GENERAL",
        quantity: 1,
        unit: "piece",
        amount: 50,
        expenseDate: "2026-08-25T12:00:00.000Z",
      },
    });
    expect(deniedCreate.status()).toBe(403);
    await expect(deniedCreate.json()).resolves.toMatchObject({
      success: false,
      error: "Permission denied",
      requiredPermission: "expenses.create",
    });

    const deniedReplace = await residentApi.put(`${API}/api/expenses/expense_grocery_aug_2026_local`, {
      headers: { "Idempotency-Key": "expenses-resident-denied-replace-v1" },
      data: {
        title: "Resident replacement",
        category: "GROCERY",
        quantity: 1,
        unit: "box",
        amount: 1,
        expenseDate: "2026-08-25T12:00:00.000Z",
      },
    });
    expect(deniedReplace.status()).toBe(403);
    await expect(deniedReplace.json()).resolves.toMatchObject({
      success: false,
      error: "Permission denied",
      requiredPermission: "expenses.replace",
    });

    const deniedDelete = await residentApi.delete(`${API}/api/expenses/expense_grocery_aug_2026_local`);
    expect(deniedDelete.status()).toBe(403);
    await expect(deniedDelete.json()).resolves.toMatchObject({
      success: false,
      error: "Permission denied",
      requiredPermission: "expenses.delete",
    });

    const deniedRestore = await residentApi.post(`${API}/api/expenses/expense_grocery_aug_2026_local/restore`, {
      data: {},
    });
    expect(deniedRestore.status()).toBe(403);
    await expect(deniedRestore.json()).resolves.toMatchObject({
      success: false,
      error: "Permission denied",
      requiredPermission: "expenses.restore",
    });
  } finally {
    await residentContext.close();
    await adminContext.close();
  }
});