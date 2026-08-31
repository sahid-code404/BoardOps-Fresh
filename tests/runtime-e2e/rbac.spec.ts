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

    // Meal definitions are resident-safe read data used by the resident meal
    // experience, but configuration mutations remain an administrator concern.
    // A meal in the deletion queue intentionally remains ACTIVE through its
    // eligible billing month, so this assertion must not assume only the three
    // seeded configurations can ever be visible.
    const residentMealRead = await residentApi.get(`${API}/api/meals/config`);
    expect(residentMealRead.ok()).toBeTruthy();
    const residentMealBody = await residentMealRead.json() as {
      success: boolean;
      data: Array<{ name: string; status: string }>;
    };
    expect(residentMealBody.success).toBe(true);
    expect(residentMealBody.data.length).toBeGreaterThanOrEqual(3);
    expect(residentMealBody.data.map((meal) => meal.name)).toEqual(
      expect.arrayContaining(["breakfast", "lunch", "dinner"]),
    );
    expect(residentMealBody.data.every((meal) => meal.status === "ACTIVE")).toBe(true);

    const deniedMealCreate = await residentApi.post(`${API}/api/meals/config`, {
      data: {
        name: "resident_forbidden_meal",
        displayName: "Resident Forbidden Meal",
        icon: "🍽️",
        color: "#8b5cf6",
        mealType: "REGULAR",
        displayOrder: 99,
        defaultState: "OFF",
        defaultVisibility: "VISIBLE",
        cutoffStrategy: "SAME_DAY",
        cutoffOffsetMinutes: 0,
        cutoffTime: "16:00",
        startTime: "18:00",
        endTime: "19:00",
      },
    });
    expect(deniedMealCreate.status()).toBe(403);
    await expect(deniedMealCreate.json()).resolves.toMatchObject({
      success: false,
      error: "Permission denied",
      requiredPermission: "meals.config.create",
    });

    // Counts exposes institution-wide resident status and is not resident-safe.
    const deniedKitchen = await residentApi.get(`${API}/api/kitchen?date=2026-08-30`);
    expect(deniedKitchen.status()).toBe(403);
    await expect(deniedKitchen.json()).resolves.toMatchObject({
      success: false,
      error: "Permission denied",
      requiredPermission: "kitchen.read",
    });

    const deniedOverride = await residentApi.post(`${API}/api/meals/override`, {
      data: {
        mealId: "meal_breakfast_local",
        userId: registrationBody.data.userId,
        serviceDate: "2026-08-30",
        action: "TURN_OFF",
        reason: "Resident must never override another meal",
      },
    });
    expect(deniedOverride.status()).toBe(403);
    await expect(deniedOverride.json()).resolves.toMatchObject({
      success: false,
      error: "Permission denied",
      requiredPermission: "meals.override",
    });

    // Leave is intentionally self-scoped for residents. The seeded Riya leave
    // must remain invisible, while the resident can create and read their own.
    const leaveBefore = await residentApi.get(`${API}/api/leave`);
    expect(leaveBefore.ok()).toBeTruthy();
    await expect(leaveBefore.json()).resolves.toMatchObject({ success: true, data: [] });

    const ownLeave = await residentApi.post(`${API}/api/leave`, {
      data: {
        startDate: "2026-09-10",
        endDate: "2026-09-11",
        reason: "Resident RBAC self-scope verification",
        mealType: "ALL",
        mealIds: [],
      },
    });
    expect(ownLeave.status()).toBe(201);
    const ownLeaveBody = await ownLeave.json() as { success: boolean; data: { id: string; user: { id: string } } };
    expect(ownLeaveBody).toMatchObject({ success: true, data: { user: { id: registrationBody.data.userId } } });

    const leaveAfter = await residentApi.get(`${API}/api/leave`);
    expect(leaveAfter.ok()).toBeTruthy();
    const leaveAfterBody = await leaveAfter.json() as { success: boolean; data: Array<{ id: string; user: { id: string } }> };
    expect(leaveAfterBody.data).toHaveLength(1);
    expect(leaveAfterBody.data[0]?.user.id).toBe(registrationBody.data.userId);

    const deniedLeaveDecision = await residentApi.patch(`${API}/api/leave/${ownLeaveBody.data.id}`, {
      data: { status: "APPROVED" },
    });
    expect(deniedLeaveDecision.status()).toBe(403);
    await expect(deniedLeaveDecision.json()).resolves.toMatchObject({
      success: false,
      error: "Permission denied",
      requiredPermission: "leave.decide",
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