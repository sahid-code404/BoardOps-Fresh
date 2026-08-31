import { expect, test } from "@playwright/test";

test("administrator User 360 renders canonical resident finance, meal and restriction domains", async ({ page }) => {
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
        availableBalance: expect.any(Number),
        pendingDeposits: expect.any(Number),
        refundPending: expect.any(Number),
        outstandingDue: expect.any(Number),
        previousDue: expect.any(Number),
        financialStatus: expect.any(String),
        totalDeposited: expect.any(Number),
        totalBilled: expect.any(Number),
        totalRefunded: expect.any(Number),
        ledgerEntryCount: expect.any(Number),
      },
      restrictions: {
        canBookMeals: expect.any(Boolean),
        financialStatus: expect.any(String),
        availableBalance: expect.any(Number),
        requiredBalance: expect.any(Number),
        hasExemption: expect.any(Boolean),
      },
      activeRestrictions: expect.any(Array),
      recentBills: expect.any(Array),
      recentPayments: expect.any(Array),
      recentRefunds: expect.any(Array),
      ledger: expect.any(Array),
      mealStats: { currentMonthON: expect.any(Number) },
      dataAvailability: {
        profile: true,
        loginHistory: true,
        fundAccount: true,
        bills: true,
        payments: true,
        refunds: true,
        ledger: true,
        meals: true,
        restrictions: true,
      },
    },
  });

  const riya = riyaResponse.body.data as {
    fundAccount: { availableBalance: number };
    restrictions: {
      canBookMeals: boolean;
      financialStatus: string;
      availableBalance: number;
      restrictionReason: string | null;
    };
    activeRestrictions: Array<{ reason: string }>;
    recentBills: Array<{ status: string }>;
    recentPayments: Array<{ status: string }>;
    recentRefunds: Array<{ status: string }>;
    ledger: Array<{ description: string }>;
    mealStats: { currentMonthON: number };
  };
  expect(riya.restrictions.availableBalance).toBe(riya.fundAccount.availableBalance);
  expect(riya.mealStats.currentMonthON).toBeGreaterThanOrEqual(0);

  await expect(dialog.getByText("Resident Fund Account", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Available Balance", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Meals This Month", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Meal Booking", { exact: true })).toBeVisible();
  await expect(dialog.getByText(riya.restrictions.canBookMeals ? "Enabled" : "Restricted", { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText("Profile", { exact: true })).toBeVisible();
  await expect(dialog.getByText("+919123456789", { exact: true })).toBeVisible();
  await expect(dialog.getByText("BoardOps Institute", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Recent Sign-ins", { exact: true })).toBeVisible();

  await dialog.getByRole("tab", { name: "Bills", exact: true }).click();
  if (riya.recentBills.length === 0) {
    await expect(dialog.getByText("No bills yet", { exact: true })).toBeVisible();
  } else {
    await expect(dialog.getByText(riya.recentBills[0]!.status, { exact: true }).first()).toBeVisible();
  }

  await dialog.getByRole("tab", { name: "Payments", exact: true }).click();
  await expect(dialog.getByText("Recent Payments", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Recent Refunds", { exact: true })).toBeVisible();
  if (riya.recentPayments.length === 0) {
    await expect(dialog.getByText("No payments yet.", { exact: true })).toBeVisible();
  } else {
    await expect(dialog.getByText(riya.recentPayments[0]!.status, { exact: true }).first()).toBeVisible();
  }
  if (riya.recentRefunds.length === 0) {
    await expect(dialog.getByText("No refunds yet.", { exact: true })).toBeVisible();
  } else {
    await expect(dialog.getByText(riya.recentRefunds[0]!.status, { exact: true }).first()).toBeVisible();
  }

  await dialog.getByRole("tab", { name: "Ledger", exact: true }).click();
  if (riya.ledger.length === 0) {
    await expect(dialog.getByText("No ledger entries yet", { exact: true })).toBeVisible();
  } else {
    await expect(dialog.getByText(riya.ledger[0]!.description, { exact: true }).first()).toBeVisible();
  }

  await dialog.getByRole("tab", { name: "Restrictions", exact: true }).click();
  await expect(dialog.getByText("Current Status", { exact: true })).toBeVisible();
  await expect(dialog.getByText(riya.restrictions.financialStatus, { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText("Can Book Meals", { exact: true })).toBeVisible();
  if (riya.activeRestrictions.length === 0) {
    await expect(dialog.getByText("No active restrictions.", { exact: true })).toBeVisible();
  } else {
    await expect(dialog.getByText(riya.activeRestrictions[0]!.reason, { exact: true }).first()).toBeVisible();
  }

  // Arjun owns durable seeded historical finance evidence. Earlier shared-D1
  // lifecycle tests are allowed to change mutable statuses, so this checkpoint
  // proves the composite remains connected to canonical evidence by identity
  // and amount rather than assuming untouched seed state.
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
        availableBalance: expect.any(Number),
        pendingDeposits: expect.any(Number),
        refundPending: expect.any(Number),
        outstandingDue: expect.any(Number),
        previousDue: expect.any(Number),
        financialStatus: expect.any(String),
        totalDeposited: expect.any(Number),
        totalBilled: expect.any(Number),
        totalRefunded: expect.any(Number),
        ledgerEntryCount: expect.any(Number),
      },
      restrictions: {
        canBookMeals: expect.any(Boolean),
        financialStatus: expect.any(String),
        availableBalance: expect.any(Number),
        requiredBalance: expect.any(Number),
        hasExemption: expect.any(Boolean),
      },
      mealStats: { currentMonthON: expect.any(Number) },
      dataAvailability: {
        fundAccount: true,
        bills: true,
        payments: true,
        refunds: true,
        ledger: true,
        meals: true,
        restrictions: true,
      },
    },
  });
  expect(arjunResponse.body.data.restrictions.availableBalance).toBe(
    arjunResponse.body.data.fundAccount.availableBalance,
  );
  expect(arjunResponse.body.data.recentBills).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "bill_arjun_2026_07_local",
        periodMonth: 6,
        periodYear: 2026,
        totalAmount: 18500,
      }),
    ]),
  );
  expect(arjunResponse.body.data.recentPayments).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "bill_arjun_2026_07_local:migrated-paid-balance",
        amount: 5000,
        status: "APPROVED",
      }),
    ]),
  );
  expect(arjunResponse.body.data.ledger).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "BILL_SETTLEMENT" }),
      expect.objectContaining({ type: "DEPOSIT" }),
    ]),
  );

  expect(failed360Responses).toEqual([]);
});
