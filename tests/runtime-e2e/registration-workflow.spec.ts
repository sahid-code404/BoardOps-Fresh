import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:8787";
const ADMIN_EMAIL = "admin@boardops.local";
const ADMIN_PASSWORD = "BoardOps@Fresh#2026!A7";
const EMAIL = "browser.phase04@example.test";
const PASSWORD = "BoardOps@Browser#2026!E1";

test("registration UI survives verification, review, resubmit and approval", async ({ page, browser }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Register", exact: true }).click();

  await page.getByLabel("Full Name", { exact: true }).fill("Browser Phase Four");
  await page.getByLabel("Institution User ID", { exact: true }).fill("RES-BROWSER-P04");
  await page.getByLabel("Mobile Number", { exact: true }).fill("+919876540104");
  await page.getByLabel("Personal Email", { exact: true }).fill(EMAIL);
  await page.getByLabel("Room Number", { exact: true }).fill("E-401");
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm Password", { exact: true }).fill(PASSWORD);

  const consents = page.getByRole("checkbox");
  await expect(consents).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) await consents.nth(index).check();

  await page.getByRole("button", { name: /Create account/u }).click();
  await expect(page.getByText("Verify your email", { exact: true })).toBeVisible();
  await expect(page.getByText(EMAIL, { exact: true })).toBeVisible();

  const otpInput = page.locator('[data-slot="input-otp"]');
  await expect(otpInput).toBeVisible();
  await otpInput.fill("424242");
  await page.getByRole("button", { name: "Verify Email", exact: true }).click();

  await expect(page.getByText("Registration received", { exact: true })).toBeVisible();
  await expect(page.getByText("Email verified", { exact: true })).toBeVisible();

  const adminContext = await browser.newContext();
  try {
    const adminApi = adminContext.request;
    const login = await adminApi.post(`${API}/api/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(login.ok()).toBeTruthy();

    const users = await adminApi.get(`${API}/api/users`, { params: { q: EMAIL } });
    expect(users.ok()).toBeTruthy();
    const usersBody = await users.json() as { success: boolean; data: Array<{ id: string; email: string; status: string; emailVerified: boolean }> };
    const applicant = usersBody.data.find((user) => user.email === EMAIL);
    expect(applicant).toMatchObject({ status: "PENDING", emailVerified: true });
    expect(applicant?.id).toBeTruthy();

    const requestChanges = await adminApi.patch(`${API}/api/users/${applicant!.id}/request-changes`, {
      data: {
        fields: ["room"],
        reason: "Please correct the room assignment before approval",
      },
    });
    expect(requestChanges.ok()).toBeTruthy();

    await expect(page.getByText("Changes requested", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Room Number", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Update & Resubmit", exact: true }).click();

    const roomInput = page.getByLabel("Room Number", { exact: true });
    await roomInput.fill("E-402");
    await page.getByRole("button", { name: "Submit updated registration", exact: true }).click();
    await expect(page.getByText("In review", { exact: true })).toBeVisible({ timeout: 10_000 });

    const approve = await adminApi.patch(`${API}/api/users/${applicant!.id}`, {
      data: { action: "APPROVE", reason: "Browser Phase 04 verification" },
    });
    expect(approve.ok()).toBeTruthy();

    await expect(page.getByText("You're approved!", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Continue to sign in", exact: true })).toBeVisible();
  } finally {
    await adminContext.close();
  }
});
