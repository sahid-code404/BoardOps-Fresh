import { expect, test } from "@playwright/test";

test("administrator User 360 renders visible real data and explicit unavailable domains", async ({ page }) => {
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
  await expect(dialog.getByText("RES-0204", { exact: true })).toBeVisible();
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

  await expect(dialog.getByText("Profile", { exact: true })).toBeVisible();
  await expect(dialog.getByText("+919123456789", { exact: true })).toBeVisible();
  await expect(dialog.getByText("BoardOps Institute", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Recent Sign-ins", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Resident Fund Account", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Not available in this phase", { exact: true }).first()).toBeVisible();

  await dialog.getByRole("tab", { name: "Bills", exact: true }).click();
  await expect(dialog.getByText("Billing history", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Bills are not available in the current D1 schema yet.", { exact: true })).toBeVisible();

  await dialog.getByRole("tab", { name: "Payments", exact: true }).click();
  await expect(dialog.getByText("Payments & refunds", { exact: true })).toBeVisible();

  await dialog.getByRole("tab", { name: "Ledger", exact: true }).click();
  await expect(dialog.getByText("Resident ledger", { exact: true })).toBeVisible();

  await dialog.getByRole("tab", { name: "Restrictions", exact: true }).click();
  await expect(dialog.getByText("Restriction evaluation", { exact: true })).toBeVisible();

  const response = await page.evaluate(async () => {
    const r = await fetch("/api/users/usr_resident_riya_local/360", { credentials: "include" });
    return { status: r.status, body: await r.json() };
  });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({
    success: true,
    data: {
      contractVersion: 1,
      profile: {
        id: "usr_resident_riya_local",
        name: "Riya Sen",
        institutionUserId: "RES-0204",
        institutionName: "BoardOps Institute",
        emailVerified: true,
      },
      fundAccount: null,
      restrictions: null,
      mealStats: null,
      recentBills: [],
      recentPayments: [],
      recentRefunds: [],
      ledger: [],
      dataAvailability: {
        profile: true,
        loginHistory: true,
        fundAccount: false,
        bills: false,
        payments: false,
        refunds: false,
        ledger: false,
        meals: false,
        restrictions: false,
      },
    },
  });

  expect(failed360Responses).toEqual([]);
});
