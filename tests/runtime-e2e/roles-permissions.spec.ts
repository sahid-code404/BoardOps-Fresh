import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:8787";
const WEB = "http://127.0.0.1:5173";
const ADMIN_EMAIL = "admin@boardops.local";
const ADMIN_PASSWORD = "BoardOps@Fresh#2026!A7";
const RESIDENT_EMAIL = "browser.roles.permissions@example.test";
const RESIDENT_PASSWORD = "BoardOps@Roles#2026!P22";
const REGISTRATION_IP = "198.51.100.22";

type DashboardBody = {
  success: boolean;
  data: {
    permissions: string[];
    isAdmin: boolean;
  };
};

test("Roles and permissions resolve live grants while preserving golden role UX", async ({ browser }) => {
  test.setTimeout(60_000);

  const adminContext = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const residentContext = await browser.newContext({ viewport: { width: 1366, height: 900 } });

  try {
    const adminApi = adminContext.request;
    const residentApi = residentContext.request;

    const adminLogin = await adminApi.post(`${API}/api/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(adminLogin.ok()).toBeTruthy();

    const adminDashboard = await adminApi.get(`${API}/api/dashboard`);
    expect(adminDashboard.ok()).toBeTruthy();
    const adminDashboardBody = await adminDashboard.json() as DashboardBody;
    expect(adminDashboardBody.success).toBe(true);
    expect(adminDashboardBody.data.isAdmin).toBe(true);
    expect(adminDashboardBody.data.permissions).toEqual(expect.arrayContaining([
      "dashboard.read",
      "users.read",
      "users.role_assign",
      "audit.read",
      "tasks.read",
      "system.backup",
    ]));

    // Keep this checkpoint's public-registration proof isolated from the shared
    // localhost rate-limit bucket consumed by other serial runtime scenarios.
    // The rate limit itself remains unchanged and continues to be verified by
    // the production route implementation.
    const registration = await residentApi.post(`${API}/api/auth/register`, {
      headers: { "x-forwarded-for": REGISTRATION_IP },
      data: {
        name: "Roles Permissions Resident",
        institutionName: "BoardOps Institute",
        institutionUserId: "RES-PHASE22-RBAC",
        email: RESIDENT_EMAIL,
        phone: "+919876540222",
        password: RESIDENT_PASSWORD,
        confirmPassword: RESIDENT_PASSWORD,
        room: "P22-222",
        gender: "OTHER",
        consents: { rules: true, privacy: true, terms: true },
      },
    });
    expect(registration.ok()).toBeTruthy();
    const registrationBody = await registration.json() as {
      success: boolean;
      data: { userId: string };
    };
    expect(registrationBody.success).toBe(true);

    const verify = await residentApi.post(`${API}/api/auth/verify-email`, {
      data: { email: RESIDENT_EMAIL, otp: "424242" },
    });
    expect(verify.ok()).toBeTruthy();

    const approve = await adminApi.patch(`${API}/api/users/${registrationBody.data.userId}`, {
      data: { action: "APPROVE", reason: "Roles / Permissions runtime verification" },
    });
    expect(approve.ok()).toBeTruthy();

    const residentLogin = await residentApi.post(`${API}/api/auth/login`, {
      data: { email: RESIDENT_EMAIL, password: RESIDENT_PASSWORD },
    });
    expect(residentLogin.ok()).toBeTruthy();

    const residentDashboard = await residentApi.get(`${API}/api/dashboard`);
    expect(residentDashboard.ok()).toBeTruthy();
    const residentDashboardBody = await residentDashboard.json() as DashboardBody;
    expect(residentDashboardBody.data.isAdmin).toBe(false);
    expect(residentDashboardBody.data.permissions).toEqual(expect.arrayContaining([
      "dashboard.read",
      "profile.read_self",
      "notifications.read_self",
      "bills.read",
      "payments.read",
    ]));
    expect(residentDashboardBody.data.permissions).not.toContain("users.read");
    expect(residentDashboardBody.data.permissions).not.toContain("users.role_assign");
    expect(residentDashboardBody.data.permissions).not.toContain("audit.read");

    const deniedUsers = await residentApi.get(`${API}/api/users`);
    expect(deniedUsers.status()).toBe(403);
    await expect(deniedUsers.json()).resolves.toMatchObject({
      success: false,
      error: "Permission denied",
      requiredPermission: "users.read",
    });

    // Role changes must affect an already-authenticated principal immediately;
    // no logout/login cycle or client role matrix may be required.
    const promoteManager = await adminApi.patch(`${API}/api/users/${registrationBody.data.userId}`, {
      data: { action: "ASSIGN_ROLE", role: "MANAGER", reason: "Verify live grant resolution" },
    });
    expect(promoteManager.ok()).toBeTruthy();

    const managerMe = await residentApi.get(`${API}/api/auth/me`);
    expect(managerMe.ok()).toBeTruthy();
    await expect(managerMe.json()).resolves.toMatchObject({
      success: true,
      data: { role: "MANAGER" },
    });

    const managerDashboard = await residentApi.get(`${API}/api/dashboard`);
    expect(managerDashboard.ok()).toBeTruthy();
    const managerDashboardBody = await managerDashboard.json() as DashboardBody;
    expect(managerDashboardBody.data.permissions).toContain("kitchen.read");
    expect(managerDashboardBody.data.permissions).not.toContain("users.role_assign");

    const restoreResidentRole = await adminApi.patch(`${API}/api/users/${registrationBody.data.userId}`, {
      data: { action: "ASSIGN_ROLE", role: "USER", reason: "Restore resident role after verification" },
    });
    expect(restoreResidentRole.ok()).toBeTruthy();

    const residentAgainDashboard = await residentApi.get(`${API}/api/dashboard`);
    expect(residentAgainDashboard.ok()).toBeTruthy();
    const residentAgainBody = await residentAgainDashboard.json() as DashboardBody;
    expect(residentAgainBody.data.permissions).not.toContain("kitchen.read");
    expect(residentAgainBody.data.permissions).not.toContain("users.read");

    // Browser shell proof: Admin keeps the recognizable User Management route;
    // Resident receives direct-route denial. Navigation visibility is covered by
    // the permission-aware nav-config unit tests rather than a layout-specific
    // sidebar button assertion.
    const adminPage = await adminContext.newPage();
    await adminPage.goto(`${WEB}/users`);
    await expect(adminPage.getByText("User Management", { exact: true }).first()).toBeVisible();
    await expect(adminPage.getByText("Access Restricted")).toHaveCount(0);

    const residentPage = await residentContext.newPage();
    await residentPage.goto(`${WEB}/users`);
    await expect(residentPage.getByText("Access Restricted")).toBeVisible();
  } finally {
    await residentContext.close();
    await adminContext.close();
  }
});
