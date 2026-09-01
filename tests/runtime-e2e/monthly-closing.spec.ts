import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:8787";
const ADMIN_EMAIL = "admin@boardops.local";
const ADMIN_PASSWORD = "BoardOps@Fresh#2026!A7";
const RESIDENT_ID = "usr_resident_riya_local";
const RESIDENT_EMAIL = "riya@boardops.local";
const RESIDENT_PASSWORD = "BoardOps@Closing#2026!";

async function expectPermissionDenied(response: import("@playwright/test").APIResponse, permission: string) {
  expect(response.status()).toBe(403);
  await expect(response.json()).resolves.toMatchObject({ success: false, error: "Permission denied", requiredPermission: permission });
}

async function navigateFromLatestClosableToMay2026(page: import("@playwright/test").Page) {
  const now = new Date();
  const latestClosableKey = now.getFullYear() * 12 + now.getMonth() - 1;
  const may2026Key = 2026 * 12 + 4;
  for (let step = 0; step < Math.max(0, latestClosableKey - may2026Key); step += 1) {
    await page.getByRole("button", { name: "Previous month", exact: true }).click();
  }
}

test("Monthly Closing uses fixed prices and publishes May exactly once with no Variable or Formula API", async ({ page }) => {
  test.setTimeout(70_000);
  await page.goto("/");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(ADMIN_EMAIL);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(ADMIN_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 5_000 });

  await page.getByRole("button", { name: "More navigation" }).click();
  const sidebar = page.getByRole("complementary");
  await sidebar.getByRole("button", { name: "Monthly Closing", exact: true }).click();
  await expect(page).toHaveURL(/\/monthly-closing(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByText("Readiness Checklist", { exact: true })).toBeVisible({ timeout: 8_000 });
  await navigateFromLatestClosableToMay2026(page);

  const result = await page.evaluate(async () => {
    const request = async (path: string, init?: RequestInit) => {
      const response = await fetch(path, {
        credentials: "include",
        headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
        ...init,
      });
      const body = await response.json().catch(() => null);
      return { status: response.status, body };
    };
    const readinessBefore = await request("/api/billing-cycles/readiness?month=4&year=2026");
    const variables = await request("/api/variables");
    const formulas = await request("/api/formulas");
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
    return { readinessBefore, variables, formulas, close, cyclesAfter, billsAfter, retry, rollbackAfterPublication, readinessAfter, billsFinal };
  });

  expect(result.variables.status).toBe(404);
  expect(result.formulas.status).toBe(404);
  expect(result.readinessBefore).toMatchObject({ status: 200, body: { success: true, data: { canClose: true } } });
  expect(result.readinessBefore.body.data.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ key: "period", status: "ready" }),
    expect.objectContaining({ key: "residents", status: "ready", count: 1 }),
    expect.objectContaining({ key: "meals", status: "ready", count: 4 }),
    expect.objectContaining({ key: "expenses", status: "ready", count: 0, amount: 0 }),
    expect.objectContaining({ key: "payments", status: "ready", count: 0 }),
    expect.objectContaining({ key: "pricing", status: "ready" }),
  ]));
  expect(result.readinessBefore.body.data.items.some((item: { key: string }) => item.key === "formula")).toBe(false);
  expect(result.readinessBefore.body.data.items.some((item: { key: string }) => item.key === "variables")).toBe(false);

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
    status: "OVERDUE",
    dueDate: "2026-06-10T00:00:00.000Z",
    user: expect.objectContaining({ name: "Riya Sen" }),
  });

  const closedCycle = result.cyclesAfter.body.data.find((cycle: { periodMonth: number; periodYear: number }) =>
    cycle.periodMonth === 4 && cycle.periodYear === 2026,
  );
  expect(closedCycle).toMatchObject({ status: "CLOSED", totalMeals: 4, totalGuestMeals: 0, mealCharge: 210, billsGenerated: 1, outstandingDue: 4860 });
  expect(result.retry).toMatchObject({ status: 200, body: { success: true, data: { status: "CLOSED", summary: { billsGenerated: 1 } } } });
  expect(result.billsFinal.body.data).toHaveLength(1);
  expect(result.billsFinal.body.data[0]).toMatchObject({ totalAmount: 4860, dueDate: "2026-06-10T00:00:00.000Z" });
  expect(result.rollbackAfterPublication?.status).toBe(422);
  expect(result.readinessAfter.body.data.canClose).toBe(false);
  expect(result.readinessAfter.body.data.existingCycle).toMatchObject({ status: "CLOSED" });

  await page.goto("/monthly-closing");
  await navigateFromLatestClosableToMay2026(page);
  await expect(page.getByText("Closed", { exact: true }).first()).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("This cycle is closed", { exact: true })).toBeVisible();
});

test("resident cannot read, close, or roll back institution Monthly Closing", async ({ browser }) => {
  test.setTimeout(50_000);
  const adminContext = await browser.newContext();
  const residentContext = await browser.newContext();
  try {
    const adminApi = adminContext.request;
    const residentApi = residentContext.request;
    expect((await adminApi.post(`${API}/api/auth/login`, { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } })).ok()).toBeTruthy();
    expect((await adminApi.put(`${API}/api/users/${RESIDENT_ID}`, { data: { password: RESIDENT_PASSWORD } })).ok()).toBeTruthy();
    expect((await residentApi.post(`${API}/api/auth/login`, { data: { email: RESIDENT_EMAIL, password: RESIDENT_PASSWORD } })).ok()).toBeTruthy();
    await expectPermissionDenied(await residentApi.get(`${API}/api/billing-cycles`), "billing_cycles.read");
    await expectPermissionDenied(await residentApi.get(`${API}/api/billing-cycles/readiness?month=4&year=2026`), "billing_cycles.read");
    await expectPermissionDenied(await residentApi.post(`${API}/api/billing-cycles`, { data: { month: 4, year: 2026 } }), "billing_cycles.close");
    await expectPermissionDenied(await residentApi.post(`${API}/api/billing-cycles/not-a-real-cycle/rollback`, { data: { reason: "RBAC must run before resource lookup" } }), "billing_cycles.rollback");
  } finally {
    await residentContext.close(); await adminContext.close();
  }
});
