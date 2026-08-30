import { expect, test } from "@playwright/test";

test("administrator User 360 resolves real runtime data instead of an endless skeleton", async ({ page }) => {
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

  // Use the real in-app navigation rather than replacing the document with a
  // direct goto. This exercises the same authenticated shell path a user takes
  // when opening User Management from the bottom navigation.
  const primaryNav = page.getByRole("navigation", { name: "Primary navigation" });
  const usersNav = primaryNav.getByRole("button", { name: "Users", exact: true });
  await expect(usersNav).toBeVisible();
  await usersNav.click();
  await expect(page).toHaveURL(/\/users(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByText("Riya Sen", { exact: true })).toBeVisible({ timeout: 8_000 });

  const riyaCard = page
    .getByText("Riya Sen", { exact: true })
    .locator("xpath=ancestor::*[.//button[@aria-label='View 360']][1]");
  const view360 = riyaCard.getByRole("button", { name: "View 360", exact: true });
  await expect(view360).toBeVisible();
  await view360.click();

  const dialog = page.getByRole("dialog", { name: "Resident 360° View" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Riya Sen", exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(dialog.getByText("riya@boardops.local", { exact: true })).toBeVisible();
  await expect(dialog.getByText("RES-0204", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Profile", { exact: true })).toBeVisible();

  const response = await page.evaluate(async () => {
    const r = await fetch("/api/users/usr_resident_riya_local/360", { credentials: "include" });
    return { status: r.status, body: await r.json() };
  });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({
    success: true,
    data: {
      profile: {
        id: "usr_resident_riya_local",
        name: "Riya Sen",
        institutionUserId: "RES-0204",
        institutionName: "BoardOps Institute",
        emailVerified: true,
      },
      fundAccount: null,
      mealStats: { currentMonthON: 0 },
      dataAvailability: {
        profile: true,
        loginHistory: true,
        fundAccount: false,
        meals: false,
        restrictions: false,
      },
    },
  });

  expect(failed360Responses).toEqual([]);
});
