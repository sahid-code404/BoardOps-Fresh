import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:8787";
const ADMIN_EMAIL = "admin@boardops.local";
const ADMIN_PASSWORD = "BoardOps@Fresh#2026!A7";
const RESIDENT_EMAIL = "browser.payments.resident@example.test";
const RESIDENT_PASSWORD = "BoardOps@Payments#2026!";

test("Resident payments are self-scoped, idempotent, and least-privilege", async ({ browser }) => {
  test.setTimeout(45_000);

  const adminContext = await browser.newContext();
  const residentContext = await browser.newContext();

  try {
    const adminApi = adminContext.request;
    const residentApi = residentContext.request;

    const adminLogin = await adminApi.post(`${API}/api/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(adminLogin.ok()).toBeTruthy();

    const registration = await residentApi.post(`${API}/api/auth/register`, {
      data: {
        name: "Payments Resident",
        institutionName: "BoardOps Institute",
        institutionUserId: "RES-PAYMENTS-E2E",
        email: RESIDENT_EMAIL,
        phone: "+919876540610",
        password: RESIDENT_PASSWORD,
        confirmPassword: RESIDENT_PASSWORD,
        room: "PAY-610",
        gender: "OTHER",
        consents: { rules: true, privacy: true, terms: true },
      },
    });
    expect(registration.status()).toBe(201);
    const registrationBody = await registration.json() as {
      success: boolean;
      data: { userId: string; email: string };
    };
    expect(registrationBody).toMatchObject({ success: true, data: { email: RESIDENT_EMAIL } });

    const verify = await residentApi.post(`${API}/api/auth/verify-email`, {
      data: { email: RESIDENT_EMAIL, otp: "424242" },
    });
    expect(verify.ok()).toBeTruthy();

    const approveResident = await adminApi.patch(`${API}/api/users/${registrationBody.data.userId}`, {
      data: { action: "APPROVE", reason: "Payments resident runtime verification" },
    });
    expect(approveResident.ok()).toBeTruthy();

    const residentLogin = await residentApi.post(`${API}/api/auth/login`, {
      data: { email: RESIDENT_EMAIL, password: RESIDENT_PASSWORD },
    });
    expect(residentLogin.ok()).toBeTruthy();

    // The resident must not see the seeded Arjun payment history.
    const before = await residentApi.get(`${API}/api/payments`);
    expect(before.ok()).toBeTruthy();
    await expect(before.json()).resolves.toEqual({ success: true, data: [] });

    const idempotencyKey = "payments-resident-e2e-v1";
    const first = await residentApi.post(`${API}/api/payments`, {
      headers: { "Idempotency-Key": idempotencyKey },
      data: {
        amount: 123.45,
        method: "UPI",
        reference: "SELF-SCOPE-E2E",
        notes: "Resident payment idempotency proof",
      },
    });
    expect(first.status()).toBe(201);
    const firstBody = await first.json() as {
      success: boolean;
      data: { id: string; amount: number; status: string; user: { email: string } };
    };
    expect(firstBody).toMatchObject({
      success: true,
      data: {
        amount: 123.45,
        status: "PENDING",
        user: { email: RESIDENT_EMAIL },
      },
    });

    // Same resident + same key returns the existing row instead of charging or
    // inserting twice.
    const replay = await residentApi.post(`${API}/api/payments`, {
      headers: { "Idempotency-Key": idempotencyKey },
      data: {
        amount: 123.45,
        method: "UPI",
        reference: "SELF-SCOPE-E2E",
      },
    });
    expect(replay.status()).toBe(200);
    const replayBody = await replay.json() as { success: boolean; data: { id: string; amount: number } };
    expect(replayBody.data.id).toBe(firstBody.data.id);
    expect(replayBody.data.amount).toBe(123.45);

    const after = await residentApi.get(`${API}/api/payments`);
    expect(after.ok()).toBeTruthy();
    const afterBody = await after.json() as { success: boolean; data: Array<{ id: string }> };
    expect(afterBody.data).toHaveLength(1);
    expect(afterBody.data[0]?.id).toBe(firstBody.data.id);

    const deniedApprove = await residentApi.patch(`${API}/api/payments/${firstBody.data.id}`, {
      data: { action: "APPROVE" },
    });
    expect(deniedApprove.status()).toBe(403);
    await expect(deniedApprove.json()).resolves.toMatchObject({
      success: false,
      error: "Permission denied",
      requiredPermission: "payments.decide",
    });

    const deniedEdit = await residentApi.put(`${API}/api/payments/${firstBody.data.id}`, {
      data: { action: "EDIT", notes: "resident must not edit" },
    });
    expect(deniedEdit.status()).toBe(403);
    await expect(deniedEdit.json()).resolves.toMatchObject({
      success: false,
      error: "Permission denied",
      requiredPermission: "payments.update",
    });

    const deniedVoid = await residentApi.put(`${API}/api/payments/${firstBody.data.id}`, {
      data: { action: "VOID" },
    });
    expect(deniedVoid.status()).toBe(403);
    await expect(deniedVoid.json()).resolves.toMatchObject({
      success: false,
      error: "Permission denied",
      requiredPermission: "payments.void",
    });

    const deniedDelete = await residentApi.delete(`${API}/api/payments/${firstBody.data.id}`);
    expect(deniedDelete.status()).toBe(403);
    await expect(deniedDelete.json()).resolves.toMatchObject({
      success: false,
      error: "Permission denied",
      requiredPermission: "payments.delete",
    });

    const deniedRefunds = await residentApi.get(`${API}/api/payments/refund`);
    expect(deniedRefunds.status()).toBe(403);
    await expect(deniedRefunds.json()).resolves.toMatchObject({
      success: false,
      error: "Permission denied",
      requiredPermission: "payments.refund",
    });
  } finally {
    await residentContext.close();
    await adminContext.close();
  }
});
