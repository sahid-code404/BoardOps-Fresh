import { expect, test } from "@playwright/test";

test("Dashboard derives live KPIs from canonical D1 meals, expenses and activity", async ({ page }) => {
  test.setTimeout(45_000);

  await page.goto("/");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("admin@boardops.local");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("BoardOps@Fresh#2026!A7");
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 5_000 });

  const proof = await page.evaluate(async () => {
    const request = async (path: string) => {
      const response = await fetch(path, { credentials: "include" });
      return { status: response.status, body: await response.json() };
    };

    const dashboard = await request("/api/dashboard");
    const dashboardData = dashboard.body?.data;
    const today = dashboardData?.trend?.at(-1)?.date as string | undefined;
    const kitchen = today ? await request(`/api/kitchen?date=${encodeURIComponent(today)}`) : null;
    const expenses = await request("/api/expenses?limit=500");

    return { dashboard, kitchen, expenses, today };
  });

  expect(proof.dashboard.status).toBe(200);
  expect(proof.dashboard.body?.success).toBe(true);
  expect(proof.kitchen?.status).toBe(200);
  expect(proof.kitchen?.body?.success).toBe(true);
  expect(proof.expenses.status).toBe(200);
  expect(proof.expenses.body?.success).toBe(true);

  const dashboard = proof.dashboard.body.data as {
    todayMeals: Array<{ id: string; status: string; editableUntil: string }>;
    kpis: {
      totalUsers: number;
      pendingUsers: number;
      todayOnCount: number;
      todayOffCount: number;
      currentMealCharge: number;
      totalResidentMeals: number;
      totalExpenses: number;
      pendingBills: number;
    };
    trend: Array<{ date: string; on: number; off: number }>;
    expenseBreakdown: Array<{ category: string; amount: number }>;
    recentActivity: Array<{ id: string; action: string }>;
    permissions: string[];
    isAdmin: boolean;
  };
  const kitchen = proof.kitchen!.body.data as {
    counts: Array<{ id: string; on: number; off: number }>;
    monthTotals: { meals: number; guests: number; off: number };
  };
  const expenses = proof.expenses.body.data as Array<{ category: string; amount: number }>;

  const todayOn = kitchen.counts.reduce((sum, meal) => sum + meal.on, 0);
  const todayOff = kitchen.counts.reduce((sum, meal) => sum + meal.off, 0);
  const residentMeals = kitchen.monthTotals.meals - kitchen.monthTotals.guests;
  const expenseTotal = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const expenseByCategory = new Map<string, number>();
  for (const expense of expenses) {
    expenseByCategory.set(expense.category, (expenseByCategory.get(expense.category) ?? 0) + expense.amount);
  }

  expect(dashboard.todayMeals.length).toBe(kitchen.counts.length);
  expect(dashboard.todayMeals.length).toBeGreaterThan(0);
  expect(dashboard.todayMeals.every((meal) => Number.isFinite(Date.parse(meal.editableUntil)))).toBe(true);
  expect(dashboard.kpis.todayOnCount).toBe(todayOn);
  expect(dashboard.kpis.todayOffCount).toBe(todayOff);
  expect(dashboard.kpis.totalResidentMeals).toBe(residentMeals);
  expect(dashboard.kpis.totalExpenses).toBeCloseTo(expenseTotal, 8);
  expect(dashboard.kpis.totalUsers).toBeGreaterThan(0);
  expect(dashboard.kpis.pendingUsers).toBeGreaterThanOrEqual(0);
  expect(dashboard.kpis.pendingBills).toBeGreaterThanOrEqual(0);
  expect(Number.isFinite(dashboard.kpis.currentMealCharge)).toBe(true);
  expect(dashboard.kpis.currentMealCharge).toBeGreaterThanOrEqual(0);

  expect(dashboard.trend).toHaveLength(7);
  expect(dashboard.trend.at(-1)).toEqual({ date: proof.today, on: todayOn, off: todayOff });

  expect(dashboard.expenseBreakdown.length).toBe(expenseByCategory.size);
  for (const item of dashboard.expenseBreakdown) {
    expect(item.amount).toBeCloseTo(expenseByCategory.get(item.category) ?? Number.NaN, 8);
  }

  expect(dashboard.permissions).toContain("dashboard.read");
  expect(dashboard.isAdmin).toBe(true);
  expect(dashboard.recentActivity.length).toBeGreaterThan(0);

  await expect(page.getByText("Total Users", { exact: true })).toBeVisible();
  await expect(page.getByText("Expenses (Month)", { exact: true })).toBeVisible();
  await expect(page.getByText("Meal Charge", { exact: true })).toBeVisible();
  await expect(page.getByText("Recent Activity", { exact: true })).toBeVisible();
  await expect(page.getByText("Dashboard data unavailable", { exact: true })).toHaveCount(0);
});
