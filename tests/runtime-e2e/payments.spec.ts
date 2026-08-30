import { expect, test } from "@playwright/test";

test("Payments renders real D1 data and recomputes bill state from canonical evidence", async ({ page }) => {
  test.setTimeout(50_000);

  await page.goto("/");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("admin@boardops.local");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("BoardOps@Fresh#2026!A7");
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 5_000 });

  await page.goto("/payments");
  await expect(page).toHaveURL(/\/payments(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByText("Arjun Rao", { exact: true }).first()).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("RBAC policy missing for endpoint", { exact: true })).toHaveCount(0);

  const result = await page.evaluate(async () => {
    const request = async (path: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
      const response = await fetch(path, {
        credentials: "include",
        ...init,
        headers,
      });
      return { status: response.status, body: await response.json() };
    };

    const augustBefore = await request("/api/payments?month=7&year=2026&limit=500");
    const billBefore = await request("/api/bills/bill_arjun_2026_07_local");

    const adminSubmitDenied = await request("/api/payments", {
      method: "POST",
      body: JSON.stringify({ amount: 100, method: "CASH" }),
    });

    const approved = await request("/api/payments/payment_arjun_pending_local", {
      method: "PATCH",
      body: JSON.stringify({ action: "APPROVE" }),
    });
    const billAfterApprove = await request("/api/bills/bill_arjun_2026_07_local");

    const approvedAgain = await request("/api/payments/payment_arjun_pending_local", {
      method: "PATCH",
      body: JSON.stringify({ action: "APPROVE" }),
    });
    const billAfterApproveAgain = await request("/api/bills/bill_arjun_2026_07_local");

    const approvedAmountEdit = await request("/api/payments/payment_arjun_pending_local", {
      method: "PUT",
      body: JSON.stringify({ action: "EDIT", amount: 2600 }),
    });

    const rejected = await request("/api/payments/payment_arjun_pending_local", {
      method: "PATCH",
      body: JSON.stringify({ action: "REJECT" }),
    });
    const billAfterReject = await request("/api/bills/bill_arjun_2026_07_local");

    const reapproved = await request("/api/payments/payment_arjun_pending_local", {
      method: "PATCH",
      body: JSON.stringify({ action: "APPROVE" }),
    });
    const billAfterReapprove = await request("/api/bills/bill_arjun_2026_07_local");

    const voided = await request("/api/payments/payment_arjun_pending_local", {
      method: "PUT",
      body: JSON.stringify({ action: "VOID" }),
    });
    const billAfterVoid = await request("/api/bills/bill_arjun_2026_07_local");

    const deleted = await request("/api/payments/payment_arjun_pending_local", {
      method: "DELETE",
      body: JSON.stringify({ reason: "Runtime payment recovery test" }),
    });
    const deletionQueue = await request("/api/payments?month=7&year=2026&includeDeleted=true&limit=500");
    const restored = await request("/api/payments/payment_arjun_pending_local/restore", {
      method: "POST",
      body: "{}",
    });
    const billAfterRestore = await request("/api/bills/bill_arjun_2026_07_local");

    const refundCandidates = await request("/api/payments/refund");
    const pendingRefunds = await request("/api/refunds?status=PENDING");

    return {
      augustBefore,
      billBefore,
      adminSubmitDenied,
      approved,
      billAfterApprove,
      approvedAgain,
      billAfterApproveAgain,
      approvedAmountEdit,
      rejected,
      billAfterReject,
      reapproved,
      billAfterReapprove,
      voided,
      billAfterVoid,
      deleted,
      deletionQueue,
      restored,
      billAfterRestore,
      refundCandidates,
      pendingRefunds,
    };
  });

  expect(result.augustBefore.status).toBe(200);
  expect(result.augustBefore.body.data).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "bill_arjun_2026_07_local:migrated-paid-balance",
        amount: 5000,
        status: "APPROVED",
        billId: "bill_arjun_2026_07_local",
        user: expect.objectContaining({ name: "Arjun Rao" }),
      }),
      expect.objectContaining({
        id: "payment_arjun_pending_local",
        amount: 2500,
        status: "PENDING",
        billId: "bill_arjun_2026_07_local",
      }),
    ]),
  );

  expect(result.billBefore.body).toMatchObject({
    success: true,
    data: { id: "bill_arjun_2026_07_local", paidAmount: 5000, dueAmount: 13500 },
  });

  expect(result.adminSubmitDenied.status).toBe(403);
  expect(result.adminSubmitDenied.body).toMatchObject({
    success: false,
    error: "Permission denied",
    requiredPermission: "payments.create",
  });

  expect(result.approved.status).toBe(200);
  expect(result.approved.body).toMatchObject({ success: true, data: { status: "APPROVED", amount: 2500 } });
  expect(result.billAfterApprove.body).toMatchObject({
    success: true,
    data: { paidAmount: 7500, dueAmount: 11000 },
  });

  // Re-approval is a no-op and cannot double count the same canonical payment.
  expect(result.approvedAgain.status).toBe(200);
  expect(result.billAfterApproveAgain.body).toMatchObject({
    success: true,
    data: { paidAmount: 7500, dueAmount: 11000 },
  });

  expect(result.approvedAmountEdit.status).toBe(422);
  expect(result.approvedAmountEdit.body).toMatchObject({ success: false });
  expect(String(result.approvedAmountEdit.body.error)).toContain("Approved payment amounts are immutable");

  expect(result.rejected.status).toBe(200);
  expect(result.rejected.body).toMatchObject({ success: true, data: { status: "REJECTED" } });
  expect(result.billAfterReject.body).toMatchObject({
    success: true,
    data: { paidAmount: 5000, dueAmount: 13500 },
  });

  expect(result.reapproved.status).toBe(200);
  expect(result.billAfterReapprove.body).toMatchObject({
    success: true,
    data: { paidAmount: 7500, dueAmount: 11000 },
  });

  expect(result.voided.status).toBe(200);
  expect(result.voided.body).toMatchObject({ success: true, data: { status: "VOID" } });
  expect(result.billAfterVoid.body).toMatchObject({
    success: true,
    data: { paidAmount: 5000, dueAmount: 13500 },
  });

  expect(result.deleted.status).toBe(200);
  expect(result.deletionQueue.status).toBe(200);
  expect(result.deletionQueue.body.data).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "payment_arjun_pending_local",
        status: "DELETED",
        deletionReason: "Runtime payment recovery test",
      }),
    ]),
  );

  // Restoration preserves the exact pre-delete state (VOID), rather than
  // silently turning financial evidence back into a pending/approved payment.
  expect(result.restored.status).toBe(200);
  expect(result.restored.body).toMatchObject({ success: true, data: { status: "VOID", deletedAt: null } });
  expect(result.billAfterRestore.body).toMatchObject({
    success: true,
    data: { paidAmount: 5000, dueAmount: 13500 },
  });

  expect(result.refundCandidates.status).toBe(200);
  expect(result.refundCandidates.body).toMatchObject({ success: true });
  expect(Array.isArray(result.refundCandidates.body.data)).toBe(true);
  expect(result.pendingRefunds.status).toBe(200);
  expect(result.pendingRefunds.body).toEqual({ success: true, data: [] });
});
