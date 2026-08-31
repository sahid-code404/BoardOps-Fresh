import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:8787";
const ADMIN_EMAIL = "admin@boardops.local";
const ADMIN_PASSWORD = "BoardOps@Fresh#2026!A7";
const RECOVERY_EMAIL = "browser.auth.recovery@example.test";
const ORIGINAL_PASSWORD = "BoardOps@Recovery#2026!A1";
const NEW_PASSWORD = "BoardOps@Recovery#2026!B2";
const REGISTRATION_IP = "198.51.100.24";

test("password recovery is one-time, non-enumerating, and revokes pre-reset sessions", async ({ browser }) => {
  test.setTimeout(60_000);

  const adminContext = await browser.newContext();
  const recoveryContext = await browser.newContext();
  let userId: string | null = null;

  try {
    const adminApi = adminContext.request;
    const recoveryApi = recoveryContext.request;

    const adminLogin = await adminApi.post(`${API}/api/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(adminLogin.ok()).toBeTruthy();

    const registration = await recoveryApi.post(`${API}/api/auth/register`, {
      headers: { "cf-connecting-ip": REGISTRATION_IP },
      data: {
        name: "Auth Recovery Resident",
        institutionName: "BoardOps Institute",
        institutionUserId: "RES-AUTH-RECOVERY",
        email: RECOVERY_EMAIL,
        phone: "+919876540224",
        password: ORIGINAL_PASSWORD,
        confirmPassword: ORIGINAL_PASSWORD,
        room: "AUTH-224",
        gender: "OTHER",
        consents: { rules: true, privacy: true, terms: true },
      },
    });
    expect(registration.ok()).toBeTruthy();
    const registrationBody = await registration.json() as { success: boolean; data: { userId: string } };
    userId = registrationBody.data.userId;

    const verify = await recoveryApi.post(`${API}/api/auth/verify-email`, {
      data: { email: RECOVERY_EMAIL, otp: "424242" },
    });
    expect(verify.ok()).toBeTruthy();

    const approve = await adminApi.patch(`${API}/api/users/${userId}`, {
      data: { action: "APPROVE", reason: "Authentication recovery runtime verification" },
    });
    expect(approve.ok()).toBeTruthy();

    const initialLogin = await recoveryApi.post(`${API}/api/auth/login`, {
      data: { email: RECOVERY_EMAIL, password: ORIGINAL_PASSWORD },
    });
    expect(initialLogin.ok()).toBeTruthy();

    const beforeReset = await recoveryApi.get(`${API}/api/auth/me`);
    expect(beforeReset.ok()).toBeTruthy();

    const unknownRecovery = await recoveryApi.post(`${API}/api/auth/forgot-password`, {
      headers: { "cf-connecting-ip": REGISTRATION_IP },
      data: { email: "unknown.auth.recovery@example.test" },
    });
    expect(unknownRecovery.ok()).toBeTruthy();
    await expect(unknownRecovery.json()).resolves.toMatchObject({ success: true, data: { sent: true } });

    const requestReset = await recoveryApi.post(`${API}/api/auth/forgot-password`, {
      headers: { "cf-connecting-ip": REGISTRATION_IP },
      data: { email: RECOVERY_EMAIL },
    });
    expect(requestReset.ok()).toBeTruthy();
    await expect(requestReset.json()).resolves.toMatchObject({ success: true, data: { sent: true } });

    const wrongOtp = await recoveryApi.post(`${API}/api/auth/verify-reset-otp`, {
      data: { email: RECOVERY_EMAIL, otp: "000000" },
    });
    expect(wrongOtp.status()).toBe(400);
    await expect(wrongOtp.json()).resolves.toMatchObject({ success: false, error: "Invalid or expired code" });

    const verifyReset = await recoveryApi.post(`${API}/api/auth/verify-reset-otp`, {
      data: { email: RECOVERY_EMAIL, otp: "424242" },
    });
    expect(verifyReset.ok()).toBeTruthy();
    const verifyResetBody = await verifyReset.json() as {
      success: boolean;
      data: { verified: boolean; resetToken: string };
    };
    expect(verifyResetBody.data.verified).toBe(true);
    expect(verifyResetBody.data.resetToken.length).toBeGreaterThan(20);

    const otpReplay = await recoveryApi.post(`${API}/api/auth/verify-reset-otp`, {
      data: { email: RECOVERY_EMAIL, otp: "424242" },
    });
    expect(otpReplay.status()).toBe(400);

    const resetPassword = await recoveryApi.post(`${API}/api/auth/reset-password`, {
      data: {
        email: RECOVERY_EMAIL,
        resetToken: verifyResetBody.data.resetToken,
        newPassword: NEW_PASSWORD,
      },
    });
    expect(resetPassword.ok()).toBeTruthy();

    const reusedResetToken = await recoveryApi.post(`${API}/api/auth/reset-password`, {
      data: {
        email: RECOVERY_EMAIL,
        resetToken: verifyResetBody.data.resetToken,
        newPassword: ORIGINAL_PASSWORD,
      },
    });
    expect(reusedResetToken.status()).toBe(400);
    await expect(reusedResetToken.json()).resolves.toMatchObject({
      success: false,
      error: "Invalid or expired reset token",
    });

    const revokedPreResetSession = await recoveryApi.get(`${API}/api/auth/me`);
    expect(revokedPreResetSession.status()).toBe(401);

    const oldPasswordLogin = await recoveryApi.post(`${API}/api/auth/login`, {
      data: { email: RECOVERY_EMAIL, password: ORIGINAL_PASSWORD },
    });
    expect(oldPasswordLogin.status()).toBe(401);

    const newPasswordLogin = await recoveryApi.post(`${API}/api/auth/login`, {
      data: { email: RECOVERY_EMAIL, password: NEW_PASSWORD },
    });
    expect(newPasswordLogin.ok()).toBeTruthy();

    const afterReset = await recoveryApi.get(`${API}/api/auth/me`);
    expect(afterReset.ok()).toBeTruthy();

    const archive = await adminApi.patch(`${API}/api/users/${userId}`, {
      data: { action: "ARCHIVE", reason: "Authentication recovery runtime fixture cleanup" },
    });
    expect(archive.ok()).toBeTruthy();
    userId = null;
  } finally {
    if (userId) {
      const adminApi = adminContext.request;
      await adminApi.patch(`${API}/api/users/${userId}`, {
        data: { action: "ARCHIVE", reason: "Authentication recovery cleanup after assertion failure" },
      }).catch(() => undefined);
    }
    await recoveryContext.close();
    await adminContext.close();
  }
});
