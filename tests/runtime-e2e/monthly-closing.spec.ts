import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:8787";
const ADMIN_EMAIL = "admin@boardops.local";
const ADMIN_PASSWORD = "BoardOps@Fresh#2026!A7";
const RESIDENT_ID = "usr_resident_riya_local";
const RESIDENT_EMAIL = "riya@boardops.local";
const RESIDENT_PASSWORD = "BoardOps@Closing#2026!";
const MEAL_FORMULA_ID = "formula_meal_charges_local";

async function expectPermissionDenied(response: import("@playwright/test").APIResponse, permission: string) {
  expect(response.status()).toBe(403);
  await expect(response.json()).resolves.toMatchObject({
    success: false,
    error: "Permission denied",
    requiredPermission: permission,
  });
}

test("Monthly Closing fails closed without a compatible canonical formula, then publishes May exactly once", async ({ page }) => {
  test.setTimeout(70_000);

  await page.goto("/");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(ADMIN_EMAIL);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(ADMIN_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 5_000 });

  await page.getByRole("button", { name: "More navigation" }).click();
  const sidebar = page.getByRole("complementary");
  await expect(sidebar).toBeInViewport();
  await sidebar.getByRole("button", { name: "Monthly Closing", exact: true }).click();
  await expect(page).toHaveURL(/\/monthly-closing(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Monthly Closing", exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("Readiness Checklist", { exact: true })).toBeVisible({ timeout: 8_000 });

  // The screen defaults to July 2026 on the deterministic test date. Navigate
  // through the real month controls to the isolated May closing fixture.
  await page.getByRole("button", { name: "Previous month", exact: true }).click();
  await page.getByRole("button", { name: "Previous month", exact: true }).click();
  await expect(page.getByRole("button", { name: /Generate Bills & Close May 2026/u })).toBeVisible({ timeout: 8_000 });

  const result = await page.evaluate(async ({ formulaId }) => {
    const request = async (path: string, init?: RequestInit) => {
      const response = await fetch(path, {
        credentials: "include",
        headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
        ...init,
      });
      return { status: response.status, body: await response.json() };
    };

    const readinessBefore = await request("/api/billing-cycles/readiness?month=4&year=2026");
    const formulas = await request("/api/formulas");
    const canonicalMeal = formulas.body?.data?.find((formula: { id: string }) => formula.id === formulaId);
    const originalExpression = canonicalMeal?.expression as string | undefined;

    // The Formula Engine can parse this expression, but Monthly Closing cannot
    // resolve `unsupported_count` to an active meal type. This is the canonical
    // fail-closed proof for ACC-001: no fallback arithmetic is permitted.
    const incompatibleFormula = originalExpression
      ? await request(`/api/formulas/${formulaId}`, {
          method: "PATCH",
          body: JSON.stringify({
            expression: `${originalExpression} + unsupported_count`,
            changeNote: "Monthly Closing runtime fail-closed probe",
          }),
        })
      : null;
    const incompatibleReadiness = await request("/api/billing-cycles/readiness?month=4&year=2026");
    const blockedClose = await request("/api/billing-cycles", {
      method: "POST",
      body: JSON.stringify({ month: 4, year: 2026, dueDate: "2026-06-10" }),
    });
    const cyclesAfterBlocked = await request("/api/billing-cycles");
    const billsAfterBlocked = await request("/api/bills?month=4&year=2026");

    const restoredFormula = originalExpression
      ? await request(`/api/formulas/${formulaId}`, {
          method: "PATCH",
          body: JSON.stringify({
            expression: originalExpression,
            changeNote: "Restore canonical formula after Monthly Closing fail-closed probe",
          }),
        })
      : null;
    const readinessRestored = await request("/api/billing-cycles/readiness?month=4&year=2026");

    const close = await request("/api/billing-cycles", {
      method: "POST",
      body: JSON.stringify({ month: 4, year: 2026, dueDate: "2026-06-10" }),
    });
    const cyclesAfter = await request("/api/billing-cycles");
    const billsAfter = await request("/api/bills?month=4&year=2026");
    const retry = await request("/api/billing-cycles", {
      method: "POST",
      body: JSON.stringify({ month: 4, year: 2026, dueDate: "2026-06-11" }),
    });
    const cycleId = close.body?.data?.cycleId as string | undefined;
    const rollbackAfterPublication = cycleId
      ? await request(`/api/billing-cycles/${cycleId}/rollback`, {
          method: "POST",
          body: JSON.stringify({ reason: "Runtime should reject published rollback" }),
        })
      : null;
    const readinessAfter = await request("/api/billing-cycles/readiness?month=4&year=2026");
    const billsFinal = await request("/api/bills?month=4&year=2026");

    return {
      readinessBefore,
      canonicalMeal,
      incompatibleFormula,
      incompatibleReadiness,
      blockedClose,
      cyclesAfterBlocked,
      billsAfterBlocked,
      restoredFormula,
      readinessRestored,
      close,
      cyclesAfter,
      billsAfter,
      retry,
      rollbackAfterPublication,
      readinessAfter,
      billsFinal,
    };
  }, { formulaId: MEAL_FORMULA_ID });

  expect(result.readinessBefore.status).toBe(200);
  expect(result.readinessBefore.body).toMatchObject({ success: true, data: { canClose: true } });
  expect(result.readinessBefore.body.data.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ key: "period", status: "ready" }),
    expect.objectContaining({ key: "residents", status: "ready", count: 1 }),
    expect.objectContaining({ key: "meals", status: "ready", count: 4 }),
    expect.objectContaining({ key: "expenses", status: "ready", count: 0, amount: 0 }),
    expect.objectContaining({ key: "payments", status: "ready", count: 0 }),
    expect.objectContaining({ key: "formula", status: "ready" }),
    expect.objectContaining({ key: "variables", status: "ready", count: 5 }),
  ]));
  expect(result.readinessBefore.body.data.items.find((item: { key: string }) => item.key === "formula")?.detail)
    .toContain("formula.mealCharges v1 and formula.totalBill v1");

  expect(result.canonicalMeal).toMatchObject({ id: MEAL_FORMULA_ID, key: "formula.mealCharges", status: "ACTIVE" });
  expect(result.incompatibleFormula).toMatchObject({
    status: 200,
    body: { success: true, data: { id: MEAL_FORMULA_ID, version: 2 } },
  });
  expect(result.incompatibleReadiness.status).toBe(200);
  expect(result.incompatibleReadiness.body.data.canClose).toBe(false);
  expect(result.incompatibleReadiness.body.data.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ key: "formula", status: "error" }),
  ]));
  expect(result.blockedClose).toMatchObject({
    status: 422,
    body: { success: false, error: "Monthly closing readiness failed" },
  });
  expect(result.cyclesAfterBlocked.status).toBe(200);
  expect(result.cyclesAfterBlocked.body.data.some((cycle: { periodMonth: number; periodYear: number }) =>
    cycle.periodMonth === 4 && cycle.periodYear === 2026)).toBe(false);
  expect(result.billsAfterBlocked.status).toBe(200);
  expect(result.billsAfterBlocked.body.data).toHaveLength(0);

  expect(result.restoredFormula).toMatchObject({
    status: 200,
    body: { success: true, data: { id: MEAL_FORMULA_ID, version: 3 } },
  });
  expect(result.readinessRestored).toMatchObject({
    status: 200,
    body: { success: true, data: { canClose: true } },
  });

  expect(result.close.status).toBe(200);
  expect(result.close.body).toMatchObject({
    success: true,
    data: {
      success: true,
      status: "CLOSED",
      summary: {
        totalExpenses: 0,
        totalResidentMeals: 4,
        totalGuestMeals: 0,
        guestRevenue: 0,
        mealCharge: 210,
        billsGenerated: 1,
        outstandingDue: 4860,
      },
    },
  });

  expect(result.billsAfter.status).toBe(200);
  expect(result.billsAfter.body.data).toHaveLength(1);
  expect(result.billsAfter.body.data[0]).toMatchObject({
    periodMonth: 4,
    periodYear: 2026,
    mealCharges: 210,
    otherCharges: 4650,
    adjustments: 0,
    totalAmount: 4860,
    paidAmount: 0,
    dueAmount: 4860,
    // The due date is intentionally in the past relative to the deterministic
    // runtime date, so Billing Core immediately applies its canonical OVERDUE
    // transition when the bill is read after closing.
    status: "OVERDUE",
    dueDate: "2026-06-10T00:00:00.000Z",
    user: expect.objectContaining({ name: "Riya Sen" }),
  });

  const closedCycle = result.cyclesAfter.body.data.find((cycle: { periodMonth: number; periodYear: number }) =>
    cycle.periodMonth === 4 && cycle.periodYear === 2026,
  );
  expect(closedCycle).toMatchObject({
    status: "CLOSED",
    totalMeals: 4,
    totalGuestMeals: 0,
    mealCharge: 210,
    billsGenerated: 1,
    outstandingDue: 4860,
  });

  // A retry is idempotent. It returns the already-closed cycle and cannot
  // re-price the bill or replace its original due date.
  expect(result.retry.status).toBe(200);
  expect(result.retry.body).toMatchObject({
    success: true,
    data: { success: true, cycleId: result.close.body.data.cycleId, status: "CLOSED", summary: { billsGenerated: 1 } },
  });
  expect(result.billsFinal.body.data).toHaveLength(1);
  expect(result.billsFinal.body.data[0]).toMatchObject({
    totalAmount: 4860,
    dueDate: "2026-06-10T00:00:00.000Z",
  });

  expect(result.rollbackAfterPublication?.status).toBe(422);
  expect(result.rollbackAfterPublication?.body).toMatchObject({
    success: false,
    error: "Rollback is only allowed before immutable snapshot/bill publication",
  });

  expect(result.readinessAfter.status).toBe(200);
  expect(result.readinessAfter.body.data.canClose).toBe(false);
  expect(result.readinessAfter.body.data.existingCycle).toMatchObject({ status: "CLOSED" });
  expect(result.readinessAfter.body.data.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ key: "cycle", status: "error" }),
  ]));

  // Re-render the real UI after the API close to prove the golden surface can
  // consume the durable cycle/history contract rather than only testing JSON.
  await page.goto("/monthly-closing");
  await page.getByRole("button", { name: "Previous month", exact: true }).click();
  await page.getByRole("button", { name: "Previous month", exact: true }).click();
  await expect(page.getByText("Status:", { exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("Closed", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("This cycle is closed", { exact: true })).toBeVisible();
  await expect(page.getByText("RBAC policy missing for endpoint", { exact: true })).toHaveCount(0);
});

test("resident cannot read, close, or roll back institution Monthly Closing", async ({ browser }) => {
  test.setTimeout(50_000);

  const adminContext = await browser.newContext();
  const residentContext = await browser.newContext();
  try {
    const adminApi = adminContext.request;
    const residentApi = residentContext.request;

    const adminLogin = await adminApi.post(`${API}/api/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(adminLogin.ok()).toBeTruthy();

    const setResidentPassword = await adminApi.put(`${API}/api/users/${RESIDENT_ID}`, {
      data: { password: RESIDENT_PASSWORD },
    });
    expect(setResidentPassword.ok()).toBeTruthy();

    const residentLogin = await residentApi.post(`${API}/api/auth/login`, {
      data: { email: RESIDENT_EMAIL, password: RESIDENT_PASSWORD },
    });
    expect(residentLogin.ok()).toBeTruthy();

    await expectPermissionDenied(
      await residentApi.get(`${API}/api/billing-cycles`),
      "billing_cycles.read",
    );
    await expectPermissionDenied(
      await residentApi.get(`${API}/api/billing-cycles/readiness?month=4&year=2026`),
      "billing_cycles.read",
    );
    await expectPermissionDenied(
      await residentApi.post(`${API}/api/billing-cycles`, { data: { month: 4, year: 2026 } }),
      "billing_cycles.close",
    );
    await expectPermissionDenied(
      await residentApi.post(`${API}/api/billing-cycles/not-a-real-cycle/rollback`, {
        data: { reason: "RBAC must run before resource lookup" },
      }),
      "billing_cycles.rollback",
    );
  } finally {
    await residentContext.close();
    await adminContext.close();
  }
});
