import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:8787";
const ADMIN_EMAIL = "admin@boardops.local";
const ADMIN_PASSWORD = "BoardOps@Fresh#2026!A7";
const RESIDENT_EMAIL = "browser.phase05.rbac@example.test";
const RESIDENT_PASSWORD = "BoardOps@Rbac#2026!P5";

test("RBAC is database-driven, cookie-only and fail-closed", async ({ browser }) => {
  test.setTimeout(45_000);

  const adminContext = await browser.newContext();
  const residentContext = await browser.newContext();
  let bearerOnlyContext: Awaited<ReturnType<typeof browser.newContext>> | null = null;

  try {
    const adminApi = adminContext.request;
    const residentApi = residentContext.request;

    const adminLogin = await adminApi.post(`${API}/api/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(adminLogin.ok()).toBeTruthy();

    const adminUsers = await adminApi.get(`${API}/api/users`);
    expect(adminUsers.ok()).toBeTruthy();

    const registration = await residentApi.post(`${API}/api/auth/register`, {
      data: {
        name: "Phase Five Resident",
        institutionName: "BoardOps Institute",
        institutionUserId: "RES-PHASE05-RBAC",
        email: RESIDENT_EMAIL,
        phone: "+919876540205",
        password: RESIDENT_PASSWORD,
        confirmPassword: RESIDENT_PASSWORD,
        room: "P5-205",
        gender: "OTHER",
        consents: { rules: true, privacy: true, terms: true },
      },
    });
    expect(registration.ok()).toBeTruthy();
    const registrationBody = await registration.json() as {
      success: boolean;
      data: { userId: string; email: string };
    };
    expect(registrationBody).toMatchObject({
      success: true,
      data: { email: RESIDENT_EMAIL },
    });

    const verify = await residentApi.post(`${API}/api/auth/verify-email`, {
      data: { email: RESIDENT_EMAIL, otp: "424242" },
    });
    expect(verify.ok()).toBeTruthy();

    const approve = await adminApi.patch(`${API}/api/users/${registrationBody.data.userId}`, {
      data: { action: "APPROVE", reason: "Phase 05 RBAC browser verification" },
    });
    expect(approve.ok()).toBeTruthy();

    const residentLogin = await residentApi.post(`${API}/api/auth/login`, {
      data: { email: RESIDENT_EMAIL, password: RESIDENT_PASSWORD },
    });
    expect(residentLogin.ok()).toBeTruthy();

    const residentDashboard = await residentApi.get(`${API}/api/dashboard`);
    expect(residentDashboard.ok()).toBeTruthy();
    await expect(residentDashboard.json()).resolves.toMatchObject({
      success: true,
      data: {
        isAdmin: false,
        recentActivity: [],
      },
    });

    const deniedUsers = await residentApi.get(`${API}/api/users`);
    expect(deniedUsers.status()).toBe(403);
    await expect(deniedUsers.json()).resolves.toMatchObject({
      success: false,
      error: "Permission denied",
      requiredPermission: "users.read",
    });

    const deniedStatusMutation = await residentApi.patch(
      `${API}/api/users/${registrationBody.data.userId}`,
      { data: { action: "SUSPEND", reason: "Resident must never reach status mutation" } },
    );
    expect(deniedStatusMutation.status()).toBe(403);
    await expect(deniedStatusMutation.json()).resolves.toMatchObject({
      success: false,
      error: "Permission denied",
      requiredPermission: "users.status_change",
    });

    // The RBAC boundary must not inherit the Phase 04 bearer compatibility
    // path. A raw value copied from the HttpOnly cookie and replayed only as a
    // bearer header must be rejected when no cookie is present.
    const adminCookie = (await adminContext.cookies()).find((cookie) => cookie.name === "boardops_session");
    expect(adminCookie?.value).toBeTruthy();
    bearerOnlyContext = await browser.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${adminCookie!.value}` },
    });
    const bearerOnlyUsers = await bearerOnlyContext.request.get(`${API}/api/users`);
    expect(bearerOnlyUsers.status()).toBe(401);
    await expect(bearerOnlyUsers.json()).resolves.toMatchObject({
      success: false,
      error: "Authentication required",
    });

    // Future API routes are denied until their permission requirement is
    // explicitly registered in the Phase 05 policy map.
    const unmapped = await adminApi.get(`${API}/api/future-unmapped-route`);
    expect(unmapped.status()).toBe(403);
    await expect(unmapped.json()).resolves.toMatchObject({
      success: false,
      error: "RBAC policy missing for endpoint",
    });
  } finally {
    await bearerOnlyContext?.close();
    await residentContext.close();
    await adminContext.close();
  }
});
