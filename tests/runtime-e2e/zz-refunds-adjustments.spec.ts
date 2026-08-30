import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:8787";
const ADMIN_EMAIL = "admin@boardops.local";
const ADMIN_PASSWORD = "BoardOps@Fresh#2026!A7";
const RESIDENT_EMAIL = "refunds.rbac.resident@example.test";
const RESIDENT_PASSWORD = "BoardOps@Refunds#2026!";
const RIYA_ID = "usr_resident_riya_local";
const EXPENSE_ID = "expense_grocery_aug_2026_local";

test("Refund obligations reserve credit, partial payouts create canonical evidence, and adjustments stay additive", async ({ browser }) => {
  test.setTimeout(60_000);

  const adminContext = await browser.newContext();
  const residentContext = await browser.newContext();

  try {
    const adminApi = adminContext.request;
    const residentApi = residentContext.request;

    const adminLogin = await adminApi.post(`${API}/api/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(adminLogin.ok()).toBeTruthy();

    const refundsBefore = await adminApi.get(`${API}/api/refunds`);
    expect(refundsBefore.ok()).toBeTruthy();
    await expect(refundsBefore.json()).resolves.toEqual({ success: true, data: [] });

    const expenseBefore = await adminApi.get(`${API}/api/expenses/${EXPENSE_ID}`);
    expect(expenseBefore.ok()).toBeTruthy();
    const expenseBeforeBody = await expenseBefore.json() as {
      success: boolean;
      data: { id: string; amount: number; status: string };
    };
    expect(expenseBeforeBody).toMatchObject({
      success: true,
      data: { id: EXPENSE_ID, amount: 3000, status: "APPROVED" },
    });

    const refundKey = "refund-obligation-runtime-v1";
    const created = await adminApi.post(`${API}/api/refunds`, {
      headers: { "Idempotency-Key": refundKey },
      data: {
        userId: RIYA_ID,
        amount: 3000,
        method: "UPI",
        reason: "Runtime durable refund obligation",
        notes: "Reserve resident credit before payout",
      },
    });
    expect(created.status()).toBe(201);
    const createdBody = await created.json() as {
      success: boolean;
      data: {
        id: string;
        refundNumber: string;
        amount: number;
        paidAmount: number;
        remainingAmount: number;
        status: string;
        transactions: unknown[];
      };
    };
    expect(createdBody).toMatchObject({
      success: true,
      data: {
        amount: 3000,
        paidAmount: 0,
        remainingAmount: 3000,
        status: "PENDING",
        transactions: [],
      },
    });
    expect(createdBody.data.refundNumber).toMatch(/^REF-\d{4}-\d{4}$/);
    const refundId = createdBody.data.id;

    // Creation idempotency returns the same obligation instead of reserving
    // the resident's credit twice.
    const createReplay = await adminApi.post(`${API}/api/refunds`, {
      headers: { "Idempotency-Key": refundKey },
      data: { userId: RIYA_ID, amount: 3000 },
    });
    expect(createReplay.status()).toBe(200);
    const createReplayBody = await createReplay.json() as { success: boolean; data: { id: string } };
    expect(createReplayBody.data.id).toBe(refundId);

    // Riya starts with ₹5,000 canonical approved credit. The ₹3,000 pending
    // obligation reserves that amount, leaving only ₹2,000 unreserved.
    const overReserved = await adminApi.post(`${API}/api/refunds`, {
      headers: { "Idempotency-Key": "refund-overreserve-runtime-v1" },
      data: {
        userId: RIYA_ID,
        amount: 2500,
        reason: "This must exceed unreserved credit",
      },
    });
    expect(overReserved.status()).toBe(422);
    const overReservedBody = await overReserved.json() as { success: boolean; error: string };
    expect(overReservedBody.success).toBe(false);
    expect(overReservedBody.error).toContain("₹2000 unreserved refundable credit");

    const partialKey = "refund-partial-runtime-v1";
    const partial = await adminApi.post(`${API}/api/refunds/${refundId}/partial`, {
      headers: { "Idempotency-Key": partialKey },
      data: {
        amount: 1000,
        method: "UPI",
        reference: "UPI-RUNTIME-1",
        notes: "First partial payout",
      },
    });
    expect(partial.ok()).toBeTruthy();
    const partialBody = await partial.json() as {
      success: boolean;
      data: {
        status: string;
        paidAmount: number;
        remainingAmount: number;
        transactions: Array<{ paymentId: string; amount: number }>;
      };
    };
    expect(partialBody).toMatchObject({
      success: true,
      data: { status: "PARTIALLY_PAID", paidAmount: 1000, remainingAmount: 2000 },
    });
    expect(partialBody.data.transactions).toHaveLength(1);
    expect(partialBody.data.transactions[0]?.amount).toBe(1000);
    const firstPaymentId = partialBody.data.transactions[0]?.paymentId;
    expect(firstPaymentId).toBeTruthy();

    // Replaying the same payout key cannot create a second transaction/payment.
    const partialReplay = await adminApi.post(`${API}/api/refunds/${refundId}/partial`, {
      headers: { "Idempotency-Key": partialKey },
      data: { amount: 1000, method: "UPI" },
    });
    expect(partialReplay.ok()).toBeTruthy();
    const partialReplayBody = await partialReplay.json() as {
      success: boolean;
      data: { paidAmount: number; remainingAmount: number; transactions: unknown[] };
    };
    expect(partialReplayBody.data).toMatchObject({ paidAmount: 1000, remainingAmount: 2000 });
    expect(partialReplayBody.data.transactions).toHaveLength(1);

    const cancelAfterPayout = await adminApi.post(`${API}/api/refunds/${refundId}/cancel`, {
      data: { reason: "Cannot cancel after a payout" },
    });
    expect(cancelAfterPayout.status()).toBe(422);
    const cancelAfterPayoutBody = await cancelAfterPayout.json() as { success: boolean; error: string };
    expect(cancelAfterPayoutBody.error).toContain("Partially paid refunds cannot be cancelled");

    const completed = await adminApi.post(`${API}/api/refunds/${refundId}/partial`, {
      headers: { "Idempotency-Key": "refund-complete-runtime-v1" },
      data: {
        amount: 2000,
        method: "BANK_TRANSFER",
        reference: "BANK-RUNTIME-2",
        notes: "Complete durable refund",
      },
    });
    expect(completed.ok()).toBeTruthy();
    const completedBody = await completed.json() as {
      success: boolean;
      data: {
        status: string;
        paidAmount: number;
        remainingAmount: number;
        transactions: Array<{ paymentId: string; amount: number }>;
      };
    };
    expect(completedBody).toMatchObject({
      success: true,
      data: { status: "COMPLETED", paidAmount: 3000, remainingAmount: 0 },
    });
    expect(completedBody.data.transactions).toHaveLength(2);
    const payoutIds = completedBody.data.transactions.map((transaction) => transaction.paymentId);
    expect(payoutIds).toContain(firstPaymentId);

    const detail = await adminApi.get(`${API}/api/refunds/${refundId}`);
    expect(detail.ok()).toBeTruthy();
    const detailBody = await detail.json() as {
      success: boolean;
      data: { status: string; paidAmount: number; remainingAmount: number; transactions: unknown[] };
    };
    expect(detailBody.data).toMatchObject({ status: "COMPLETED", paidAmount: 3000, remainingAmount: 0 });
    expect(detailBody.data.transactions).toHaveLength(2);

    // Refund transaction rows point to canonical REFUNDED Payment evidence.
    const payments = await adminApi.get(`${API}/api/payments?limit=500`);
    expect(payments.ok()).toBeTruthy();
    const paymentsBody = await payments.json() as {
      success: boolean;
      data: Array<{ id: string; amount: number; status: string; method: string; user: { email: string } }>;
    };
    const payoutPayments = paymentsBody.data.filter((payment) => payoutIds.includes(payment.id));
    expect(payoutPayments).toHaveLength(2);
    expect(payoutPayments.reduce((sum, payment) => sum + payment.amount, 0)).toBe(3000);
    for (const payout of payoutPayments) {
      expect(payout).toMatchObject({ status: "REFUNDED", method: "REFUND", user: { email: "riya@boardops.local" } });
    }

    // A fresh unpaid obligation can be cancelled and releases its reserved
    // amount without deleting historical refund evidence.
    const cancellable = await adminApi.post(`${API}/api/refunds`, {
      headers: { "Idempotency-Key": "refund-cancel-runtime-v1" },
      data: {
        userId: RIYA_ID,
        amount: 500,
        method: "CASH",
        reason: "Runtime cancellation path",
      },
    });
    expect(cancellable.status()).toBe(201);
    const cancellableBody = await cancellable.json() as { success: boolean; data: { id: string; status: string } };
    expect(cancellableBody.data.status).toBe("PENDING");

    const cancelled = await adminApi.post(`${API}/api/refunds/${cancellableBody.data.id}/cancel`, {
      data: { reason: "Cancelled by runtime verification" },
    });
    expect(cancelled.ok()).toBeTruthy();
    const cancelledBody = await cancelled.json() as {
      success: boolean;
      data: { status: string; paidAmount: number; transactions: unknown[] };
    };
    expect(cancelledBody.data).toMatchObject({ status: "CANCELLED", paidAmount: 0, transactions: [] });

    // Adjustments are additive correction evidence. Creating one against an
    // approved Expense must not rewrite that Expense's historical amount.
    const adjustmentKey = "adjustment-expense-runtime-v1";
    const adjustment = await adminApi.post(`${API}/api/adjustments`, {
      headers: { "Idempotency-Key": adjustmentKey },
      data: {
        entityType: "Expense",
        entityId: EXPENSE_ID,
        userId: RIYA_ID,
        amount: -25,
        reason: "Runtime correction evidence",
        notes: "Do not rewrite approved expense",
      },
    });
    expect(adjustment.status()).toBe(201);
    const adjustmentBody = await adjustment.json() as {
      success: boolean;
      data: { id: string; adjustmentNumber: string; entityType: string; entityId: string; amount: number; reason: string };
    };
    expect(adjustmentBody).toMatchObject({
      success: true,
      data: {
        entityType: "Expense",
        entityId: EXPENSE_ID,
        amount: -25,
        reason: "Runtime correction evidence",
      },
    });
    expect(adjustmentBody.data.adjustmentNumber).toMatch(/^ADJ-\d{4}-\d{4}$/);

    const adjustmentReplay = await adminApi.post(`${API}/api/adjustments`, {
      headers: { "Idempotency-Key": adjustmentKey },
      data: { entityType: "Expense", entityId: EXPENSE_ID, amount: -99, reason: "Must replay original" },
    });
    expect(adjustmentReplay.ok()).toBeTruthy();
    const adjustmentReplayBody = await adjustmentReplay.json() as { success: boolean; data: { id: string; amount: number } };
    expect(adjustmentReplayBody.data.id).toBe(adjustmentBody.data.id);
    expect(adjustmentReplayBody.data.amount).toBe(-25);

    const adjustments = await adminApi.get(`${API}/api/adjustments?entityType=Expense&entityId=${EXPENSE_ID}`);
    expect(adjustments.ok()).toBeTruthy();
    const adjustmentsBody = await adjustments.json() as { success: boolean; data: Array<{ id: string; amount: number }> };
    expect(adjustmentsBody.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: adjustmentBody.data.id, amount: -25 })]),
    );

    const expenseAfter = await adminApi.get(`${API}/api/expenses/${EXPENSE_ID}`);
    expect(expenseAfter.ok()).toBeTruthy();
    const expenseAfterBody = await expenseAfter.json() as {
      success: boolean;
      data: { id: string; amount: number; status: string };
    };
    expect(expenseAfterBody).toMatchObject({
      success: true,
      data: { id: EXPENSE_ID, amount: 3000, status: "APPROVED" },
    });

    // Create a real approved resident to prove the external RBAC boundary,
    // rather than relying only on D1 role-grant counts.
    const registration = await residentApi.post(`${API}/api/auth/register`, {
      data: {
        name: "Refund RBAC Resident",
        institutionName: "BoardOps Institute",
        institutionUserId: "RES-REFUND-E2E",
        email: RESIDENT_EMAIL,
        phone: "+919876540620",
        password: RESIDENT_PASSWORD,
        confirmPassword: RESIDENT_PASSWORD,
        room: "REF-620",
        gender: "OTHER",
        consents: { rules: true, privacy: true, terms: true },
      },
    });
    expect(registration.ok()).toBeTruthy();
    const registrationBody = await registration.json() as { success: boolean; data: { userId: string } };

    const verify = await residentApi.post(`${API}/api/auth/verify-email`, {
      data: { email: RESIDENT_EMAIL, otp: "424242" },
    });
    expect(verify.ok()).toBeTruthy();

    const approve = await adminApi.patch(`${API}/api/users/${registrationBody.data.userId}`, {
      data: { action: "APPROVE", reason: "Refund RBAC runtime verification" },
    });
    expect(approve.ok()).toBeTruthy();

    const residentLogin = await residentApi.post(`${API}/api/auth/login`, {
      data: { email: RESIDENT_EMAIL, password: RESIDENT_PASSWORD },
    });
    expect(residentLogin.ok()).toBeTruthy();

    const deniedRefundRead = await residentApi.get(`${API}/api/refunds`);
    expect(deniedRefundRead.status()).toBe(403);
    await expect(deniedRefundRead.json()).resolves.toMatchObject({
      success: false,
      error: "Permission denied",
      requiredPermission: "refunds.read",
    });

    const deniedRefundCreate = await residentApi.post(`${API}/api/refunds`, {
      headers: { "Idempotency-Key": "resident-refund-denied" },
      data: { userId: RIYA_ID, amount: 10, reason: "Must be denied" },
    });
    expect(deniedRefundCreate.status()).toBe(403);
    await expect(deniedRefundCreate.json()).resolves.toMatchObject({
      success: false,
      error: "Permission denied",
      requiredPermission: "refunds.create",
    });

    const deniedPayout = await residentApi.post(`${API}/api/refunds/${refundId}/partial`, {
      headers: { "Idempotency-Key": "resident-payout-denied" },
      data: { amount: 1 },
    });
    expect(deniedPayout.status()).toBe(403);
    await expect(deniedPayout.json()).resolves.toMatchObject({
      success: false,
      error: "Permission denied",
      requiredPermission: "refunds.pay",
    });

    const deniedCancel = await residentApi.post(`${API}/api/refunds/${cancellableBody.data.id}/cancel`, {
      data: { reason: "Must be denied" },
    });
    expect(deniedCancel.status()).toBe(403);
    await expect(deniedCancel.json()).resolves.toMatchObject({
      success: false,
      error: "Permission denied",
      requiredPermission: "refunds.cancel",
    });

    const deniedAdjustmentRead = await residentApi.get(`${API}/api/adjustments`);
    expect(deniedAdjustmentRead.status()).toBe(403);
    await expect(deniedAdjustmentRead.json()).resolves.toMatchObject({
      success: false,
      error: "Permission denied",
      requiredPermission: "adjustments.read",
    });

    const deniedAdjustmentCreate = await residentApi.post(`${API}/api/adjustments`, {
      headers: { "Idempotency-Key": "resident-adjustment-denied" },
      data: {
        entityType: "Expense",
        entityId: EXPENSE_ID,
        amount: 1,
        reason: "Must be denied",
      },
    });
    expect(deniedAdjustmentCreate.status()).toBe(403);
    await expect(deniedAdjustmentCreate.json()).resolves.toMatchObject({
      success: false,
      error: "Permission denied",
      requiredPermission: "adjustments.create",
    });
  } finally {
    await residentContext.close();
    await adminContext.close();
  }
});
