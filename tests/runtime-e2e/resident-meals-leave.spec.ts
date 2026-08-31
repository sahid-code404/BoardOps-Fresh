import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:8787";
const ADMIN_EMAIL = "admin@boardops.local";
const ADMIN_PASSWORD = "BoardOps@Fresh#2026!A7";
const RESIDENT_EMAIL = "browser.resident.meals@example.test";
const RESIDENT_PASSWORD = "BoardOps@ResidentMeals#2026!R25";
const REGISTRATION_IP = "198.51.100.25";

type ApiEnvelope<T> = { success: boolean; data: T; error?: string };

type ResidentSchedule = {
  meals: Array<{ id: string; displayName: string }>;
  byDate: Record<string, Array<{
    id: string;
    mealId: string;
    mealDisplayName: string;
    serviceDate: string;
    status: string;
    originalState: string;
    overridden: boolean;
    locked: boolean;
    preRegistration: boolean;
  }>>;
  registrationDate: string;
};

test("Resident meals and leave are self-scoped, cutoff-aware and baseline-preserving", async ({ browser }) => {
  test.setTimeout(75_000);

  const adminContext = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const residentContext = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  let residentId: string | null = null;

  try {
    const adminApi = adminContext.request;
    const residentApi = residentContext.request;

    const adminLogin = await adminApi.post(`${API}/api/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(adminLogin.ok()).toBeTruthy();

    const registration = await residentApi.post(`${API}/api/auth/register`, {
      headers: { "cf-connecting-ip": REGISTRATION_IP },
      data: {
        name: "Resident Meals Runtime",
        institutionName: "BoardOps Institute",
        institutionUserId: "RES-PHASE25-MEALS",
        email: RESIDENT_EMAIL,
        phone: "+919876540225",
        password: RESIDENT_PASSWORD,
        confirmPassword: RESIDENT_PASSWORD,
        room: "P25-225",
        gender: "OTHER",
        consents: { rules: true, privacy: true, terms: true },
      },
    });
    expect(registration.ok()).toBeTruthy();
    const registrationBody = await registration.json() as ApiEnvelope<{ userId: string }>;
    residentId = registrationBody.data.userId;

    const verify = await residentApi.post(`${API}/api/auth/verify-email`, {
      data: { email: RESIDENT_EMAIL, otp: "424242" },
    });
    expect(verify.ok()).toBeTruthy();

    const approveResident = await adminApi.patch(`${API}/api/users/${residentId}`, {
      data: { action: "APPROVE", reason: "Resident meals runtime verification" },
    });
    expect(approveResident.ok()).toBeTruthy();

    const residentLogin = await residentApi.post(`${API}/api/auth/login`, {
      data: { email: RESIDENT_EMAIL, password: RESIDENT_PASSWORD },
    });
    expect(residentLogin.ok()).toBeTruthy();

    const dashboard = await residentApi.get(`${API}/api/dashboard`);
    expect(dashboard.ok()).toBeTruthy();
    const dashboardBody = await dashboard.json() as ApiEnvelope<{ permissions: string[] }>;
    expect(dashboardBody.data.permissions).toEqual(expect.arrayContaining([
      "meals.entries.read_self",
      "meals.toggle_self",
      "leave.read",
      "leave.create",
    ]));
    expect(dashboardBody.data.permissions).not.toContain("meals.override");
    expect(dashboardBody.data.permissions).not.toContain("leave.decide");

    const scheduleDate = "2026-09-01";
    const scheduleResponse = await residentApi.get(`${API}/api/meals/entries?date=${scheduleDate}`);
    expect(scheduleResponse.ok()).toBeTruthy();
    const scheduleBody = await scheduleResponse.json() as ApiEnvelope<ResidentSchedule>;
    expect(scheduleBody.data.meals).toHaveLength(3);
    const scheduleEntries = scheduleBody.data.byDate[scheduleDate] ?? [];
    expect(scheduleEntries).toHaveLength(3);
    expect(scheduleEntries.every((entry) => entry.preRegistration === false)).toBe(true);

    const dinner = scheduleEntries.find((entry) => entry.mealDisplayName === "Dinner");
    expect(dinner).toBeTruthy();
    const toggleOff = await residentApi.patch(`${API}/api/meals/toggle`, {
      data: { entryId: dinner!.id, status: "OFF" },
    });
    expect(toggleOff.ok()).toBeTruthy();
    await expect(toggleOff.json()).resolves.toMatchObject({
      success: true,
      data: {
        id: dinner!.id,
        status: "OFF",
        originalState: "OFF",
        overridden: false,
        preRegistration: false,
      },
    });

    // A resident cannot use the self-service toggle endpoint to reach another
    // resident's known entry id, even when the id itself is guessed or leaked.
    const crossResidentToggle = await residentApi.patch(`${API}/api/meals/toggle`, {
      data: { entryId: "entry_riya_dinner_20260830", status: "OFF" },
    });
    expect(crossResidentToggle.status()).toBe(404);

    const leaveStart = "2026-09-04";
    const leaveEnd = "2026-09-05";
    const baselineResponse = await residentApi.get(`${API}/api/meals/entries?date=${leaveStart}`);
    expect(baselineResponse.ok()).toBeTruthy();
    const baselineBody = await baselineResponse.json() as ApiEnvelope<ResidentSchedule>;
    const baselineEntries = baselineBody.data.byDate[leaveStart] ?? [];
    expect(baselineEntries).toHaveLength(3);
    expect(baselineEntries.every((entry) => entry.status === "ON" && entry.originalState === "ON")).toBe(true);

    const leaveCreate = await residentApi.post(`${API}/api/leave`, {
      data: {
        startDate: leaveStart,
        endDate: leaveEnd,
        reason: "Resident meals runtime leave",
        mealType: "ALL",
        mealIds: [],
      },
    });
    expect(leaveCreate.status()).toBe(201);
    const leaveCreateBody = await leaveCreate.json() as ApiEnvelope<{ id: string; status: string }>;
    expect(leaveCreateBody.data.status).toBe("PENDING");

    const overlap = await residentApi.post(`${API}/api/leave`, {
      data: {
        startDate: "2026-09-05",
        endDate: "2026-09-06",
        reason: "Overlapping request must fail",
        mealType: "ALL",
        mealIds: [],
      },
    });
    expect(overlap.status()).toBe(409);
    await expect(overlap.json()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("overlap"),
    });

    const approveLeave = await adminApi.patch(`${API}/api/leave/${leaveCreateBody.data.id}`, {
      data: { status: "APPROVED", adminNotes: "Runtime baseline preservation proof" },
    });
    expect(approveLeave.ok()).toBeTruthy();

    const afterLeaveResponse = await residentApi.get(`${API}/api/meals/entries?date=${leaveStart}`);
    expect(afterLeaveResponse.ok()).toBeTruthy();
    const afterLeaveBody = await afterLeaveResponse.json() as ApiEnvelope<ResidentSchedule>;
    const afterLeaveEntries = afterLeaveBody.data.byDate[leaveStart] ?? [];
    expect(afterLeaveEntries).toHaveLength(3);
    expect(afterLeaveEntries.every((entry) =>
      entry.status === "OFF"
      && entry.originalState === "ON"
      && entry.overridden === true
      && entry.locked === true
    )).toBe(true);

    const selfLeaveList = await residentApi.get(`${API}/api/leave`);
    expect(selfLeaveList.ok()).toBeTruthy();
    const selfLeaveBody = await selfLeaveList.json() as ApiEnvelope<Array<{ id: string; user: { id: string } }>>;
    expect(selfLeaveBody.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: leaveCreateBody.data.id, user: { id: residentId } }),
    ]));
    expect(selfLeaveBody.data.some((leave) => leave.id === "leave_riya_pending_local")).toBe(false);

    // July is a seeded CLOSED accounting period. Approval must fail before any
    // historical meal entry is rewritten, while rejection remains available.
    const closedPeriodLeave = await residentApi.post(`${API}/api/leave`, {
      data: {
        startDate: "2026-07-15",
        endDate: "2026-07-16",
        reason: "Closed period protection proof",
        mealType: "ALL",
        mealIds: [],
      },
    });
    expect(closedPeriodLeave.status()).toBe(201);
    const closedPeriodLeaveBody = await closedPeriodLeave.json() as ApiEnvelope<{ id: string }>;

    const closedPeriodApproval = await adminApi.patch(`${API}/api/leave/${closedPeriodLeaveBody.data.id}`, {
      data: { status: "APPROVED", adminNotes: "Must fail closed" },
    });
    expect(closedPeriodApproval.status()).toBe(409);
    await expect(closedPeriodApproval.json()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("closed accounting period 2026-07"),
    });

    const rejectClosedPeriodLeave = await adminApi.patch(`${API}/api/leave/${closedPeriodLeaveBody.data.id}`, {
      data: { status: "REJECTED", adminNotes: "Runtime cleanup after closed-period proof" },
    });
    expect(rejectClosedPeriodLeave.ok()).toBeTruthy();

    const archiveResident = await adminApi.patch(`${API}/api/users/${residentId}`, {
      data: { action: "ARCHIVE", reason: "Resident meals runtime fixture cleanup" },
    });
    expect(archiveResident.ok()).toBeTruthy();
    residentId = null;
  } finally {
    if (residentId) {
      try {
        await adminContext.request.patch(`${API}/api/users/${residentId}`, {
          data: { action: "ARCHIVE", reason: "Resident meals runtime emergency cleanup" },
        });
      } catch {
        // Best-effort cleanup only; the CI database is reset before every suite.
      }
    }
    await residentContext.close();
    await adminContext.close();
  }
});
