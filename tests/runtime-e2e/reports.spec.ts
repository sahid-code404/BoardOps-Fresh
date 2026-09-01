import { expect, test, type APIResponse, type Page } from "@playwright/test";

const API = "http://127.0.0.1:8787";
const ADMIN_EMAIL = "admin@boardops.local";
const ADMIN_PASSWORD = "BoardOps@Fresh#2026!A7";
const RESIDENT_ID = "usr_resident_riya_local";
const RESIDENT_EMAIL = "riya@boardops.local";
const RESIDENT_PASSWORD = "BoardOps@Reports#2026!";

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

test("Reports derive canonical D1 analytics, exports, and admin-only access", async ({ browser }) => {
  test.setTimeout(60_000);
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

    const financialResponse = await adminApi.get(`${API}/api/reports/financial?month=7&year=2026`);
    expect(financialResponse.status()).toBe(200);
    const financial = await json<{
      success: boolean;
      data: {
        period: { month: number; year: number };
        summary: Record<string, number>;
        expenseByCategory: Array<{ category: string; amount: number }>;
        comparison: { prevExpenses: number; prevDeposits: number; expenseChange: number; depositChange: number };
      };
    }>(financialResponse);
    expect(financial.success).toBe(true);
    expect(financial.data.period).toEqual({ month: 7, year: 2026 });
    expect(financial.data.summary.totalExpenses).toBe(4500);
    expect(financial.data.summary.totalDeposits).toBe(5000);
    expect(financial.data.summary.depositCount).toBe(1);
    expect(financial.data.summary.totalPurchases).toBe(0);
    expect(financial.data.summary.purchaseCount).toBe(0);
    expect(financial.data.summary.netPosition).toBe(500);
    expect(financial.data.expenseByCategory).toEqual([
      { category: "GROCERY", amount: 3000 },
      { category: "UTILITIES", amount: 1500 },
    ]);

    const mealsResponse = await adminApi.get(`${API}/api/reports/meals?month=4&year=2026`);
    expect(mealsResponse.status()).toBe(200);
    const meals = await json<{
      data: {
        summary: { totalMeals: number; totalGuests: number; totalOverrides: number; holidayCount: number; activeMealCount: number };
        perMeal: Array<{ mealName: string; on: number; total: number }>;
      };
    }>(mealsResponse);
    expect(meals.data.summary.totalMeals).toBe(4);
    expect(meals.data.summary.activeMealCount).toBeGreaterThanOrEqual(3);
    expect(meals.data.summary.holidayCount).toBe(0);
    expect(meals.data.perMeal).toHaveLength(meals.data.summary.activeMealCount);
    expect(meals.data.perMeal.map((meal) => meal.mealName)).toEqual(
      expect.arrayContaining(["breakfast", "lunch", "dinner"]),
    );

    const purchasesResponse = await adminApi.get(`${API}/api/reports/purchases?month=7&year=2026`);
    expect(purchasesResponse.status()).toBe(200);
    const purchases = await json<{
      data: { summary: { totalSpend: number; purchaseCount: number; itemCount: number; avgPurchaseValue: number }; topProducts: unknown[]; topCategories: unknown[]; vendorBreakdown: unknown[] };
    }>(purchasesResponse);
    expect(purchases.data.summary).toEqual({ totalSpend: 0, purchaseCount: 0, itemCount: 0, avgPurchaseValue: 0 });
    expect(purchases.data.topProducts).toEqual([]);
    expect(purchases.data.topCategories).toEqual([]);
    expect(purchases.data.vendorBreakdown).toEqual([]);

    const outstandingResponse = await adminApi.get(`${API}/api/reports/outstanding?month=6&year=2026`);
    expect(outstandingResponse.status()).toBe(200);
    const outstanding = await json<{
      data: {
        summary: { totalOutstanding: number; totalCurrentDue: number; totalPreviousDue: number; residentCount: number; billCount: number };
        rows: Array<{ userName: string; billNumber: string; dueAmount: number; previousDue: number }>;
      };
    }>(outstandingResponse);
    expect(outstanding.data.summary.totalCurrentDue).toBe(13500);
    expect(outstanding.data.summary.totalOutstanding).toBeGreaterThanOrEqual(13500);
    expect(outstanding.data.rows).toContainEqual(expect.objectContaining({
      userName: "Arjun Rao",
      billNumber: "bill_arjun_2026_07_local",
      dueAmount: 13500,
      previousDue: 0,
    }));

    const residentsResponse = await adminApi.get(`${API}/api/reports/residents`);
    expect(residentsResponse.status()).toBe(200);
    const residents = await json<{
      data: { summary: { residentCount: number; totalBalance: number; totalDue: number }; rows: Array<{ userId: string; userName: string; availableBalance: number; outstandingDue: number; financialStatus: string }> };
    }>(residentsResponse);
    expect(residents.data.summary.residentCount).toBeGreaterThanOrEqual(1);
    expect(residents.data.summary.totalBalance).toBeGreaterThanOrEqual(0);
    expect(residents.data.summary.totalDue).toBeGreaterThanOrEqual(0);
    expect(residents.data.rows).toContainEqual(expect.objectContaining({ userId: RESIDENT_ID, userName: "Riya Sen" }));
    expect(residents.data.rows.every((row) => row.availableBalance >= 0 && row.outstandingDue >= 0)).toBe(true);

    const expenseCsv = await adminApi.get(`${API}/api/reports/export?type=expenses&month=7&year=2026`);
    expect(expenseCsv.status()).toBe(200);
    expect(expenseCsv.headers()["content-type"]).toContain("text/csv");
    expect(expenseCsv.headers()["content-disposition"]).toContain("expenses-August-2026.csv");
    const expenseCsvText = await expenseCsv.text();
    expect(expenseCsvText).toContain("Date,Title,Category,Amount,Quantity,Unit,PaidTo,Status,CreatedBy");
    expect(expenseCsvText).toContain("Monthly groceries");
    expect(expenseCsvText).toContain("Electricity bill");

    const billCsv = await adminApi.get(`${API}/api/reports/export?type=bills&month=6&year=2026`);
    expect(billCsv.status()).toBe(200);
    expect(await billCsv.text()).toContain("bill_arjun_2026_07_local");

    const invalidPeriod = await adminApi.get(`${API}/api/reports/financial?month=12&year=2026`);
    expect(invalidPeriod.status()).toBe(400);
    const invalidExport = await adminApi.get(`${API}/api/reports/export?type=not-a-report&month=7&year=2026`);
    expect(invalidExport.status()).toBe(400);

    const setResidentPassword = await adminApi.put(`${API}/api/users/${RESIDENT_ID}`, {
      data: { password: RESIDENT_PASSWORD },
    });
    expect(setResidentPassword.ok()).toBeTruthy();
    const residentLogin = await residentApi.post(`${API}/api/auth/login`, {
      data: { email: RESIDENT_EMAIL, password: RESIDENT_PASSWORD },
    });
    expect(residentLogin.ok()).toBeTruthy();

    await expectPermissionDenied(
      await residentApi.get(`${API}/api/reports/financial?month=7&year=2026`),
      "reports.read",
    );
    await expectPermissionDenied(
      await residentApi.get(`${API}/api/reports/export?type=bills&month=6&year=2026`),
      "reports.export",
    );

    const page = await shellContext.newPage();
    await loginAdminShell(page);
    await page.getByRole("button", { name: "More navigation" }).click();
    const sidebar = page.getByRole("complementary");
    await expect(sidebar).toBeInViewport();
    await sidebar.getByRole("button", { name: "Reports", exact: true }).click();
    await expect(page).toHaveURL(/\/reports(?:\?|$)/, { timeout: 5_000 });
    await expect(page.getByRole("heading", { name: "Reports & Analytics", exact: true })).toBeVisible({ timeout: 8_000 });
    const reportsNow = new Date();
    const reportsCurrentKey = reportsNow.getFullYear() * 12 + reportsNow.getMonth();
    const august2026Key = 2026 * 12 + 7;
    for (let step = 0; step < Math.max(0, reportsCurrentKey - august2026Key); step += 1) {
      await page.getByRole("button", { name: "Previous month", exact: true }).click();
    }
    await expect(page.getByText("Total Expenses", { exact: true })).toBeVisible();
    await expect(page.getByText("₹4,500", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Export Bills CSV/ })).toBeVisible();
  } finally {
    await shellContext.close();
    await residentContext.close();
    await adminContext.close();
  }
});