import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:8787";
const ADMIN_EMAIL = "admin@boardops.local";
const ADMIN_PASSWORD = "BoardOps@Fresh#2026!A7";
const EMAIL = "browser.users.lifecycle@example.test";
const PASSWORD = "BoardOps@Users#2026!U1";

async function registerAndVerify(page: Page) {
  await page.goto("/");
  await page.getByRole("tab", { name: "Register", exact: true }).click();
  await page.getByLabel("Full Name", { exact: true }).fill("Users Lifecycle Resident");
  await page.getByLabel("Institution User ID", { exact: true }).fill("RES-USERS-LIFECYCLE");
  await page.getByLabel("Mobile Number", { exact: true }).fill("+919876540191");
  await page.getByLabel("Personal Email", { exact: true }).fill(EMAIL);
  await page.getByLabel("Room Number", { exact: true }).fill("U-701");
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm Password", { exact: true }).fill(PASSWORD);

  const consents = page.getByRole("checkbox");
  await expect(consents).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) await consents.nth(index).check();

  await page.getByRole("button", { name: /Create account/u }).click();
  await expect(page.getByText("Verify your email", { exact: true })).toBeVisible();
  await page.locator('[data-slot="input-otp"]').fill("424242");
  await page.getByRole("button", { name: "Verify Email", exact: true }).click();
  await expect(page.getByText("Registration received", { exact: true })).toBeVisible();
}

test("Residents / Users preserves verification, lifecycle notifications and the seven-day deletion queue", async ({ page, browser }) => {
  test.setTimeout(90_000);
  await registerAndVerify(page);

  const adminContext = await browser.newContext();
  let userContext = await browser.newContext();
  try {
    const adminApi = adminContext.request;
    const adminLogin = await adminApi.post(`${API}/api/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(adminLogin.ok()).toBeTruthy();

    const users = await adminApi.get(`${API}/api/users`, { params: { q: EMAIL } });
    expect(users.ok()).toBeTruthy();
    const usersBody = await users.json() as {
      data: Array<{ id: string; email: string; status: string; emailVerified: boolean }>;
    };
    const resident = usersBody.data.find((entry) => entry.email === EMAIL);
    expect(resident).toMatchObject({ status: "PENDING", emailVerified: true });
    expect(resident?.id).toBeTruthy();
    const userId = resident!.id;

    const approve = await adminApi.patch(`${API}/api/users/${userId}`, {
      data: { action: "APPROVE", reason: "Residents / Users lifecycle verification" },
    });
    expect(approve.ok()).toBeTruthy();

    const userLogin = await userContext.request.post(`${API}/api/auth/login`, {
      data: { email: EMAIL, password: PASSWORD },
    });
    expect(userLogin.ok()).toBeTruthy();

    const approvalNotifications = await userContext.request.get(`${API}/api/notifications`);
    expect(approvalNotifications.ok()).toBeTruthy();
    const approvalBody = await approvalNotifications.json() as {
      data: { notifications: Array<{ title: string }> };
    };
    expect(approvalBody.data.notifications.map((entry) => entry.title)).toContain("Account Approved");

    const weakPassword = await adminApi.put(`${API}/api/users/${userId}`, {
      data: { password: "short" },
    });
    expect(weakPassword.status()).toBe(422);

    // The UI submits the full edit form, including the existing email. Re-sending
    // that same address must not accidentally clear its verified state.
    const edit = await adminApi.put(`${API}/api/users/${userId}`, {
      data: {
        name: "Users Lifecycle Resident",
        email: EMAIL,
        phone: "+919876540191",
        room: "U-702",
        gender: "OTHER",
        emergencyContact: "+919876540192",
      },
    });
    expect(edit.ok()).toBeTruthy();

    const afterEdit = await adminApi.get(`${API}/api/users`, { params: { q: EMAIL } });
    const afterEditBody = await afterEdit.json() as {
      data: Array<{ id: string; room: string | null; emailVerified: boolean }>;
    };
    expect(afterEditBody.data.find((entry) => entry.id === userId)).toMatchObject({
      room: "U-702",
      emailVerified: true,
    });

    const editedNotifications = await userContext.request.get(`${API}/api/notifications`);
    const editedBody = await editedNotifications.json() as {
      data: { notifications: Array<{ title: string }> };
    };
    expect(editedBody.data.notifications.map((entry) => entry.title)).toContain("Account Updated");

    const deleteStartedAt = Date.now();
    const deletion = await adminApi.delete(`${API}/api/users/${userId}`, {
      data: { reason: "Residents / Users seven-day restoration verification" },
    });
    expect(deletion.ok()).toBeTruthy();
    const deletionBody = await deletion.json() as {
      data: { status: string; deletedAt: string; deletionReason: string };
    };
    expect(deletionBody.data.status).toBe("ARCHIVED");
    const deletionDeadlineMs = Date.parse(deletionBody.data.deletedAt);
    const graceMs = deletionDeadlineMs - deleteStartedAt;
    expect(graceMs).toBeGreaterThanOrEqual(6.99 * 24 * 60 * 60 * 1000);
    expect(graceMs).toBeLessThanOrEqual(7.01 * 24 * 60 * 60 * 1000);

    const duplicateDelete = await adminApi.delete(`${API}/api/users/${userId}`, {
      data: { reason: "A repeated delete must not reset the grace window" },
    });
    expect(duplicateDelete.status()).toBe(422);
    await expect(duplicateDelete.json()).resolves.toMatchObject({
      success: false,
      error: "This user is already in the deletion queue",
    });

    // Deletion revokes the already-issued credential immediately.
    const deletedSession = await userContext.request.get(`${API}/api/auth/me`);
    expect(deletedSession.status()).toBe(401);

    const queued = await adminApi.get(`${API}/api/users`, { params: { q: EMAIL } });
    const queuedBody = await queued.json() as {
      data: Array<{ id: string; status: string; deletedAt: string | null; deletionReason: string | null }>;
    };
    expect(queuedBody.data.find((entry) => entry.id === userId)).toMatchObject({
      status: "ARCHIVED",
      deletedAt: deletionBody.data.deletedAt,
      deletionReason: "Residents / Users seven-day restoration verification",
    });

    const restore = await adminApi.post(`${API}/api/users/${userId}/restore`);
    expect(restore.ok()).toBeTruthy();
    await expect(restore.json()).resolves.toMatchObject({
      success: true,
      data: { id: userId, status: "ACTIVE", deletedAt: null, deletionReason: null },
    });

    // Restoration never resurrects the revoked pre-delete session.
    expect((await userContext.request.get(`${API}/api/auth/me`)).status()).toBe(401);
    await userContext.close();
    userContext = await browser.newContext();
    const relogin = await userContext.request.post(`${API}/api/auth/login`, {
      data: { email: EMAIL, password: PASSWORD },
    });
    expect(relogin.ok()).toBeTruthy();

    const lifecycleNotifications = await userContext.request.get(`${API}/api/notifications`);
    expect(lifecycleNotifications.ok()).toBeTruthy();
    const lifecycleBody = await lifecycleNotifications.json() as {
      data: { notifications: Array<{ title: string; priority: string }> };
    };
    const titles = lifecycleBody.data.notifications.map((entry) => entry.title);
    expect(titles).toContain("Account Scheduled for Deletion");
    expect(titles).toContain("Account Restored");
    expect(lifecycleBody.data.notifications.find((entry) => entry.title === "Account Scheduled for Deletion")?.priority).toBe("URGENT");

    // Leave the synthetic resident non-active so later accounting tests never
    // inherit an additional active resident from this lifecycle scenario.
    const finalDelete = await adminApi.delete(`${API}/api/users/${userId}`, {
      data: { reason: "Residents / Users runtime fixture cleanup" },
    });
    expect(finalDelete.ok()).toBeTruthy();
  } finally {
    await userContext.close();
    await adminContext.close();
  }
});
