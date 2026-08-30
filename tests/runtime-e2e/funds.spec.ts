import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:8787";
const ADMIN_EMAIL = "admin@boardops.local";
const ADMIN_PASSWORD = "BoardOps@Fresh#2026!A7";
const RESIDENT_EMAIL = "browser.funds.resident@example.test";
const RESIDENT_PASSWORD = "BoardOps@Funds#2026!";

test("Funds renders canonical August accounting totals from real D1", async ({ page }) => {
  test.setTimeout(40_000);

  const failedFundsResponses: Array<{ url: string; status: number }> = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/funds") && response.status() >= 500) {
      failedFundsResponses.push({ url: response.url(), status: response.status() });
    }
  });

  await page.goto("/");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(ADMIN_EMAIL);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(ADMIN_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 5_000 });

  // Funds is a secondary finance route, so use canonical route navigation after
  // the authenticated shell has restored rather than depending on one sidebar breakpoint.
  await page.goto("/funds");
  await expect(page).toHaveURL(/\/funds(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByText("Total Deposit", { exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("Remaining Fund", { exact: true })).toBeVisible();
  await expect(page.getByText("Total Deficit", { exact: true })).toBeVisible();
  await expect(page.getByText("Riya Sen", { exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("Room B-204", { exact: true })).toBeVisible();
  await expect(page.getByText("₹4,500", { exact: true }).first()).toBeVisible({ timeout: 8_000 });

  const result = await page.evaluate(async () => {
    const response = await fetch("/api/funds?month=7&year=2026", { credentials: "include" });
    return { status: response.status, body: await response.json() };
  });

  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({
    success: true,
    data: {
      totalDeposit: 5000,
      totalExpenses: 4500,
      remainingFund: 500,
      totalRefunded: 0,
      month: 7,
      year: 2026,
    },
  });
  expect(result.body.data.users).toEqual([
    expect.objectContaining({
      userId: "usr_resident_riya_local",
      name: "Riya Sen",
      email: "riya@boardops.local",
      room: "B-204",
      billTotal: 0,
      deposit: 0,
      needToPay: 0,
      deficit: 4500,
      hasBills: false,
    }),
  ]);
  expect(failedFundsResponses).toEqual([]);
});

test("Funds remains administrator-only under permission RBAC", async ({ browser }) => {
  test.setTimeout(45_000);

  const adminContext = await browser.newContext();
  const residentContext = await browser.newContext();
  let residentUserId: string | null = null;

  try {
    const adminApi = adminContext.request;
    const residentApi = residentContext.request;

    const adminLogin = await adminApi.post(`${API}/api/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(adminLogin.ok()).toBeTruthy();

    const registration = await residentApi.post(`${API}/api/auth/register`, {
      data: {
        name: "Funds Resident",
        institutionName: "BoardOps Institute",
        institutionUserId: "RES-FUNDS-E2E",
        email: RESIDENT_EMAIL,
        phone: "+919876540621",
        password: RESIDENT_PASSWORD,
        confirmPassword: RESIDENT_PASSWORD,
        room: "FND-621",
        gender: "OTHER",
        consents: { rules: true, privacy: true, terms: true },
      },
    });
    expect(registration.ok()).toBeTruthy();
    const registrationBody = await registration.json() as {
      success: boolean;
      data: { userId: string; email: string };
    };
    residentUserId = registrationBody.data.userId;

    const verify = await residentApi.post(`${API}/api/auth/verify-email`, {
      data: { email: RESIDENT_EMAIL, otp: "424242" },
    });
    expect(verify.ok()).toBeTruthy();

    const approveResident = await adminApi.patch(`${API}/api/users/${residentUserId}`, {
      data: { action: "APPROVE", reason: "Funds resident runtime verification" },
    });
    expect(approveResident.ok()).toBeTruthy();

    const residentLogin = await residentApi.post(`${API}/api/auth/login`, {
      data: { email: RESIDENT_EMAIL, password: RESIDENT_PASSWORD },
    });
    expect(residentLogin.ok()).toBeTruthy();

    const denied = await residentApi.get(`${API}/api/funds?month=7&year=2026`);
    expect(denied.status()).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({
      success: false,
      error: "Permission denied",
      requiredPermission: "funds.read",
    });
  } finally {
    // Runtime tests share one clean D1 reset. Return the temporary approved
    // resident to an inactive state so later kitchen/billing counts remain deterministic.
    if (residentUserId) {
      await adminContext.request.patch(`${API}/api/users/${residentUserId}`, {
        data: { action: "DEACTIVATE", reason: "Funds runtime test cleanup" },
      }).catch(() => undefined);
    }
    await residentContext.close();
    await adminContext.close();
  }
});
