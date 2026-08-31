import { expect, test } from "@playwright/test";

test("administrator User 360 renders canonical resident finance and meal domains", async ({ page }) => {
  const failed360Responses: string[] = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (/^\/api\/users\/[^/]+\/360$/u.test(url.pathname) && response.status() >= 400) {
      failed360Responses.push(`${response.status()} ${url.pathname}`);
    }
  });

  await page.goto("/");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("admin@boardops.local");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("BoardOps@Fresh#2026!A7");
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 5_000 });

  const primaryNav = page.getByRole("navigation", { name: "Primary navigation" });
  await primaryNav.getByRole("button", { name: "Users", exact: true }).click();
  await expect(page).toHaveURL(/\/users(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByText("Riya Sen", { exact: true })).toBeVisible({ timeout: 8_000 });

  const riyaCard = page
    .getByText("Riya Sen", { exact: true })
    .locator("xpath=ancestor::*[.//button[@aria-label='View 360']][1]");
  await riyaCard.getByRole("button", { name: "View 360", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Resident 360° View" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Riya Sen", exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(dialog.getByText("riya@boardops.local", { exact: true })).toBeVisible();
  await expect(dialog.getByText("RES-0204", { exact: true }).first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close User 360", exact: true })).toHaveCount(1);

  const content = dialog.getByTestId("user-360-tab-content");
  await expect(content).toBeVisible();
  const presentation = await content.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      opacity: Number.parseFloat(style.opacity || "1"),
      height: rect.height,
      textLength: (element.textContent || "").trim().length,
    };
  });
  expect(presentation.opacity).toBeGreaterThan(0.99);
  expect(presentation.height).toBeGreaterThan(120);
  expect(presentation.textLength).toBeGreaterThan(80);

  await expect(dialog.getByText("Resident Fund Account", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Available Balance", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Meals This Month", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Profile", { exact: true })).toBeVisible();
  await expect(dialog.getByText("+919123456789", { exact: true })).toBeVisible();
  await expect(dialog.getByText("BoardOps Institute", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Recent Sign-ins", { exact: true })).toBeVisible();

  await dialog.getByRole("tab", { name: "Bills", exact: true }).click();
  await expect(dialog.getByText("No bills yet", { exact: true })).toBeVisible();

  await dialog.getByRole("tab", { name: "Payments", exact: true }).click();
  await expect(dialog.getByText("Recent Payments", { exact: true })).toBeVisible();
  await expect(dialog.getByText("No payments yet", { exact: true })).toBeVisible();
  await expect(dialog.getByText("No refunds yet", { exact: true })).toBeVisible();

  await dialog.getByRole("tab", { name: "Ledger", exact: true }).click();
  await expect(dialog.getByText("No ledger entries yet", { exact: true })).toBeVisible();

  await dialog.getByRole("tab", { name: "Restrictions", exact: true }).click();
  await expect(dialog.getByText("Restriction evaluation", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Restriction evaluation is not available in the current D1 schema.", { exact: true })).toBeVisible();

  const riyaResponse = await page.evaluate(async () => {
    const r = await fetch("/api/users/usr_resident_riya_local/360", { credentials: "include" });
    return { status: r.status, body: await r.json() };
  });
  expect(riyaResponse.status).toBe(200);
  expect(riyaResponse.body).toMatchObject({
    success: true,
    data: {
      contractVersion: 2,
      profile: {
        id: "usr_resident_riya_local",
        name: "Riya Sen",
        institutionUserId: "RES-0204",
        institutionName: "BoardOps Institute",
        emailVerified: true,
      },
      fundAccount: {
        availableBalance: 0,
        pendingDeposits: 0,
        refundPending: 0,
        outstandingDue: 0,
        previousDue: 0,
        financialStatus: "HEALTHY",
        totalDeposited: 0,
        totalBilled: 0,
        totalRefunded: 0,
        ledgerEntryCount: 0,
      },
      restrictions: null,
      recentBills: [],
      recentPayments: [],
      recentRefunds: [],
      ledger: [],
      dataAvailability: {
        profile: true,
        loginHistory: true,
        fundAccount: true,
        bills: true,
        payments: true,
        refunds: true,
        ledger: true,
        meals: true,
        restrictions: false,
      },
    },
  });
  expect(riyaResponse.body.data.mealStats.currentMonthON).toBeGreaterThanOrEqual(2);

  // Arjun owns the deterministic historical finance fixtures. This proves the
  // same composite endpoint is reading real canonical Bills + Payments and not
  // simply changing availability flags for a resident with empty finance data.
  const arjunResponse = await page.evaluate(async () => {
    const r = await fetch("/api/users/usr_resident_arjun_local/360", { credentials: "include" });
    return { status: r.status, body: await r.json() };
  });
  expect(arjunResponse.status).toBe(200);
  expect(arjunResponse.body).toMatchObject({
    success: true,
    data: {
      contractVersion: 2,
      profile: {
        id: "usr_resident_arjun_local",
        name: "Arjun Rao",
        status: "INACTIVE",
      },
      fundAccount: {
        availableBalance: 0,
        pendingDeposits: 2500,
        refundPending: 0,
        outstandingDue: 13500,
        previousDue: 13500,
        financialStatus: "OVERDUE",
        totalDeposited: 5000,
        totalBilled: 18500,
        totalRefunded: 0,
        ledgerEntryCount: 2,
      },
      restrictions: null,
      mealStats: { currentMonthON: 0 },
      dataAvailability: {
        fundAccount: true,
        bills: true,
        payments: true,
        refunds: true,
        ledger: true,
        meals: true,
        restrictions: false,
      },
    },
  });
  expect(arjunResponse.body.data.recentBills).toEqual([
    expect.objectContaining({
      id: "bill_arjun_2026_07_local",
      periodMonth: 6,
      periodYear: 2026,
      totalAmount: 18500,
      paidAmount: 5000,
      dueAmount: 13500,
      previousDue: 0,
      status: "PARTIALLY_PAID",
    }),
  ]);
  expect(arjunResponse.body.data.recentPayments).toEqual([
    expect.objectContaining({
      id: "payment_arjun_pending_local",
      amount: 2500,
      status: "PENDING",
    }),
    expect.objectContaining({
      id: "bill_arjun_2026_07_local:migrated-paid-balance",
      amount: 5000,
      status: "APPROVED",
    }),
  ]);
  expect(arjunResponse.body.data.ledger).toHaveLength(2);
  expect(arjunResponse.body.data.ledger.map((entry: { type: string }) => entry.type).sort()).toEqual([
    "BILL_SETTLEMENT",
    "DEPOSIT",
  ]);

  expect(failed360Responses).toEqual([]);
});
