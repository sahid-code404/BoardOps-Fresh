import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:8787";
const ADMIN_EMAIL = "admin@boardops.local";
const ADMIN_PASSWORD = "BoardOps@Fresh#2026!A7";
const ADMIN_ID = "usr_admin_local";
const EMAIL = "browser.phase04@example.test";
const UPDATED_EMAIL = "browser.phase04.updated@example.test";
const PASSWORD = "BoardOps@Browser#2026!E1";
const REJECT_EMAIL = "browser.phase04.rejected@example.test";
const REJECT_PASSWORD = "BoardOps@Rejected#2026!R1";

async function registerAndVerify(
  page: Page,
  applicant: {
    name: string;
    institutionUserId: string;
    phone: string;
    email: string;
    room: string;
    password: string;
  },
) {
  await page.goto("/");
  await page.getByRole("tab", { name: "Register", exact: true }).click();
  await page.getByLabel("Full Name", { exact: true }).fill(applicant.name);
  await page.getByLabel("Institution User ID", { exact: true }).fill(applicant.institutionUserId);
  await page.getByLabel("Mobile Number", { exact: true }).fill(applicant.phone);
  await page.getByLabel("Personal Email", { exact: true }).fill(applicant.email);
  await page.getByLabel("Room Number", { exact: true }).fill(applicant.room);
  await page.getByLabel("Password", { exact: true }).fill(applicant.password);
  await page.getByLabel("Confirm Password", { exact: true }).fill(applicant.password);

  const consents = page.getByRole("checkbox");
  await expect(consents).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) await consents.nth(index).check();

  await page.getByRole("button", { name: /Create account/u }).click();
  await expect(page.getByText("Verify your email", { exact: true })).toBeVisible();
  await expect(page.getByText(applicant.email, { exact: true })).toBeVisible();

  const otpInput = page.locator('[data-slot="input-otp"]');
  await expect(otpInput).toBeVisible();
  await otpInput.fill("424242");
  await page.getByRole("button", { name: "Verify Email", exact: true }).click();

  await expect(page.getByText("Registration received", { exact: true })).toBeVisible();
  await expect(page.getByText("Email verified", { exact: true })).toBeVisible();
}

test("registration UI survives verification, correction, reverification, resubmit and approval", async ({ page, browser }) => {
  test.setTimeout(60_000);

  await registerAndVerify(page, {
    name: "Browser Phase Four",
    institutionUserId: "RES-BROWSER-P04",
    phone: "+919876540104",
    email: EMAIL,
    room: "E-401",
    password: PASSWORD,
  });

  const adminContext = await browser.newContext();
  try {
    const adminApi = adminContext.request;
    const login = await adminApi.post(`${API}/api/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(login.ok()).toBeTruthy();

    const disableLastAdmin = await adminApi.patch(`${API}/api/users/${ADMIN_ID}`, {
      data: { action: "SUSPEND", reason: "This must be rejected by the safety invariant" },
    });
    expect(disableLastAdmin.status()).toBe(422);
    await expect(disableLastAdmin.json()).resolves.toMatchObject({
      success: false,
      error: "Cannot disable the last active administrator",
    });

    const users = await adminApi.get(`${API}/api/users`, { params: { q: EMAIL } });
    expect(users.ok()).toBeTruthy();
    const usersBody = await users.json() as {
      success: boolean;
      data: Array<{ id: string; email: string; status: string; emailVerified: boolean }>;
    };
    const applicant = usersBody.data.find((user) => user.email === EMAIL);
    expect(applicant).toMatchObject({ status: "PENDING", emailVerified: true });
    expect(applicant?.id).toBeTruthy();

    const activationBypass = await adminApi.patch(`${API}/api/users/${applicant!.id}`, {
      data: { action: "ACTIVATE", reason: "Pending registration must not bypass approval" },
    });
    expect(activationBypass.status()).toBe(422);
    await expect(activationBypass.json()).resolves.toMatchObject({
      success: false,
      error: "Only suspended or inactive users can be activated",
    });

    const requestChanges = await adminApi.patch(`${API}/api/users/${applicant!.id}/request-changes`, {
      data: {
        fields: ["room", "email"],
        reason: "Please correct the room assignment and personal email before approval",
      },
    });
    expect(requestChanges.ok()).toBeTruthy();

    const prematureApprove = await adminApi.patch(`${API}/api/users/${applicant!.id}`, {
      data: { action: "APPROVE", reason: "Must not bypass requested corrections" },
    });
    expect(prematureApprove.status()).toBe(409);
    await expect(prematureApprove.json()).resolves.toMatchObject({
      success: false,
      error: "Registration is not awaiting approval",
    });

    await expect(page.getByText("Changes requested", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Room Number", { exact: true })).toBeVisible();
    await expect(page.getByText("Email", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Update & Resubmit", exact: true }).click();

    await page.getByLabel("Room Number", { exact: true }).fill("E-402");
    const correctedEmailInput = page.getByLabel("Personal Email", { exact: true });
    await expect(correctedEmailInput).toBeVisible();
    await correctedEmailInput.fill(UPDATED_EMAIL);
    await page.getByRole("button", { name: "Submit updated registration", exact: true }).click();

    await expect(page.getByText("Verify your email", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(UPDATED_EMAIL, { exact: true })).toBeVisible();
    const otpInput = page.locator('[data-slot="input-otp"]');
    await otpInput.fill("424242");
    await page.getByRole("button", { name: "Verify Email", exact: true }).click();

    await expect(page.getByText("Registration received", { exact: true })).toBeVisible();
    await expect(page.getByText("Email verified", { exact: true })).toBeVisible();
    await expect(page.getByText("In review", { exact: true })).toBeVisible({ timeout: 10_000 });

    const correctedUsers = await adminApi.get(`${API}/api/users`, { params: { q: UPDATED_EMAIL } });
    expect(correctedUsers.ok()).toBeTruthy();
    const correctedUsersBody = await correctedUsers.json() as {
      success: boolean;
      data: Array<{ id: string; email: string; status: string; emailVerified: boolean }>;
    };
    expect(correctedUsersBody.data.find((user) => user.id === applicant!.id)).toMatchObject({
      email: UPDATED_EMAIL,
      status: "PENDING",
      emailVerified: true,
    });

    const approve = await adminApi.patch(`${API}/api/users/${applicant!.id}`, {
      data: { action: "APPROVE", reason: "Browser Phase 04 verification" },
    });
    expect(approve.ok()).toBeTruthy();

    await expect(page.getByText("You're approved!", { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Continue to sign in", exact: true }).click();

    await page.getByLabel("Email", { exact: true }).fill(UPDATED_EMAIL);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    const applicantLogin = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/auth/login" && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    expect((await applicantLogin).status()).toBe(200);

    const activeMe = await page.context().request.get(`${API}/api/auth/me`);
    expect(activeMe.ok()).toBeTruthy();

    const suspend = await adminApi.patch(`${API}/api/users/${applicant!.id}`, {
      data: { action: "SUSPEND", reason: "Phase 04 session revocation verification" },
    });
    expect(suspend.ok()).toBeTruthy();

    // Use a protected endpoint that does not clear the browser cookie on 401.
    // This proves the status gate immediately rejects the disabled account while
    // retaining the exact credential for the reactivation check below.
    const suspendedDashboard = await page.context().request.get(`${API}/api/dashboard`);
    expect(suspendedDashboard.status()).toBe(401);

    const reactivate = await adminApi.patch(`${API}/api/users/${applicant!.id}`, {
      data: { action: "ACTIVATE", reason: "Restore after session revocation verification" },
    });
    expect(reactivate.ok()).toBeTruthy();

    // The same pre-suspension cookie must still fail after the account becomes
    // ACTIVE again. If this ever returns 200, the disable path only hid the
    // session behind account status instead of actually revoking it in D1.
    const reusedRevokedSession = await page.context().request.get(`${API}/api/auth/me`);
    expect(reusedRevokedSession.status()).toBe(401);
  } finally {
    await adminContext.close();
  }
});

test("rejected registration remains visible to the applicant with its reason", async ({ page, browser }) => {
  test.setTimeout(45_000);

  await registerAndVerify(page, {
    name: "Rejected Phase Four",
    institutionUserId: "RES-BROWSER-P04-R",
    phone: "+919876540105",
    email: REJECT_EMAIL,
    room: "R-101",
    password: REJECT_PASSWORD,
  });

  const adminContext = await browser.newContext();
  try {
    const adminApi = adminContext.request;
    const login = await adminApi.post(`${API}/api/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(login.ok()).toBeTruthy();

    const users = await adminApi.get(`${API}/api/users`, { params: { q: REJECT_EMAIL } });
    expect(users.ok()).toBeTruthy();
    const usersBody = await users.json() as {
      success: boolean;
      data: Array<{ id: string; email: string; status: string; emailVerified: boolean }>;
    };
    const applicant = usersBody.data.find((user) => user.email === REJECT_EMAIL);
    expect(applicant).toMatchObject({ status: "PENDING", emailVerified: true });
    expect(applicant?.id).toBeTruthy();

    const reason = "Institution details could not be validated";
    const reject = await adminApi.patch(`${API}/api/users/${applicant!.id}/reject`, {
      data: { reason },
    });
    expect(reject.ok()).toBeTruthy();

    const rejectedRestore = await adminApi.post(`${API}/api/users/${applicant!.id}/restore`);
    expect(rejectedRestore.status()).toBe(422);
    await expect(rejectedRestore.json()).resolves.toMatchObject({
      success: false,
      error: "Rejected registrations cannot be restored directly",
    });

    await expect(page.getByText("Registration rejected", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Application rejected", { exact: true })).toBeVisible();
    await expect(page.getByText(reason, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Back to login", exact: true })).toBeVisible();
  } finally {
    await adminContext.close();
  }
});
