import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:8787";
const WEB = "http://127.0.0.1:5173";
const ADMIN_EMAIL = "admin@boardops.local";
const ADMIN_PASSWORD = "BoardOps@Fresh#2026!A7";
const RESIDENT_EMAIL = "browser.procurement@example.test";
const RESIDENT_PASSWORD = "BoardOps@Procurement#2026!P23";
const REGISTRATION_IP = "198.51.100.23";

test("Products and Purchases use immutable linked accounting evidence and least privilege", async ({ browser }) => {
  test.setTimeout(90_000);

  const adminContext = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const residentContext = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  let createdResidentId: string | null = null;
  let createdPurchaseId: string | null = null;

  try {
    const adminApi = adminContext.request;
    const residentApi = residentContext.request;

    const adminLogin = await adminApi.post(`${API}/api/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(adminLogin.ok()).toBeTruthy();

    const units = await adminApi.get(`${API}/api/units`);
    expect(units.ok()).toBeTruthy();
    await expect(units.json()).resolves.toMatchObject({
      success: true,
      data: expect.arrayContaining([
        expect.objectContaining({ id: "unit_kg_local", name: "kg", isActive: true }),
        expect.objectContaining({ id: "unit_litre_local", name: "litre", isActive: true }),
      ]),
    });

    const products = await adminApi.get(`${API}/api/products`);
    expect(products.ok()).toBeTruthy();
    await expect(products.json()).resolves.toMatchObject({
      success: true,
      data: expect.arrayContaining([
        expect.objectContaining({ id: "product_rice_local", name: "Rice", category: "GRAINS", isActive: true }),
        expect.objectContaining({ id: "product_oil_local", name: "Cooking Oil", category: "OIL", isActive: true }),
      ]),
    });

    const idempotencyKey = `runtime-procurement-${Date.now()}`;
    const purchasePayload = {
      vendor: "Runtime Procurement Market",
      purchaseDate: "2026-08-15",
      notes: "Runtime linked-expense verification",
      items: [
        { productId: "product_rice_local", productName: "Rice", category: "GRAINS", quantity: 5, unit: "kg", rate: 60 },
        { productId: "product_oil_local", productName: "Cooking Oil", category: "OIL", quantity: 2, unit: "litre", rate: 150 },
      ],
    };

    const create = await adminApi.post(`${API}/api/purchases`, {
      headers: { "Idempotency-Key": idempotencyKey },
      data: purchasePayload,
    });
    expect(create.status()).toBe(201);
    const created = await create.json() as {
      success: boolean;
      data: { id: string; expenseId: string; totalAmount: number; status: string; items: Array<{ total: number }> };
    };
    expect(created.success).toBe(true);
    expect(created.data.totalAmount).toBe(600);
    expect(created.data.status).toBe("APPROVED");
    expect(created.data.items).toHaveLength(2);
    expect(created.data.items.reduce((sum, item) => sum + item.total, 0)).toBe(600);
    createdPurchaseId = created.data.id;

    const replay = await adminApi.post(`${API}/api/purchases`, {
      headers: { "Idempotency-Key": idempotencyKey },
      data: purchasePayload,
    });
    expect(replay.ok()).toBeTruthy();
    const replayBody = await replay.json() as { success: boolean; data: { id: string; expenseId: string } };
    expect(replayBody.data.id).toBe(created.data.id);
    expect(replayBody.data.expenseId).toBe(created.data.expenseId);

    const listed = await adminApi.get(`${API}/api/purchases?month=8&year=2026&limit=500`);
    expect(listed.ok()).toBeTruthy();
    await expect(listed.json()).resolves.toMatchObject({
      success: true,
      data: expect.arrayContaining([
        expect.objectContaining({ id: created.data.id, vendor: "Runtime Procurement Market", totalAmount: 600, status: "APPROVED" }),
      ]),
    });

    const stats = await adminApi.get(`${API}/api/purchases/stats?month=8&year=2026`);
    expect(stats.ok()).toBeTruthy();
    await expect(stats.json()).resolves.toMatchObject({
      success: true,
      data: {
        monthTotal: 600,
        monthCount: 1,
        topProducts: expect.arrayContaining([
          expect.objectContaining({ name: "Rice", totalSpend: 300, totalQuantity: 5 }),
        ]),
      },
    });

    const purchaseReport = await adminApi.get(`${API}/api/reports/purchases?month=7&year=2026`);
    expect(purchaseReport.ok()).toBeTruthy();
    await expect(purchaseReport.json()).resolves.toMatchObject({
      success: true,
      data: {
        summary: { totalSpend: 600, purchaseCount: 1, itemCount: 2, avgPurchaseValue: 600 },
        topProducts: expect.arrayContaining([
          expect.objectContaining({ name: "Rice", quantity: 5, spend: 300, unit: "kg" }),
        ]),
        vendorBreakdown: expect.arrayContaining([
          expect.objectContaining({ vendor: "Runtime Procurement Market", count: 1, total: 600 }),
        ]),
      },
    });

    const financialReport = await adminApi.get(`${API}/api/reports/financial?month=7&year=2026`);
    expect(financialReport.ok()).toBeTruthy();
    await expect(financialReport.json()).resolves.toMatchObject({
      success: true,
      data: { summary: { totalPurchases: 600, purchaseCount: 1 } },
    });

    const purchaseCsv = await adminApi.get(`${API}/api/reports/export?type=purchases&month=7&year=2026`);
    expect(purchaseCsv.ok()).toBeTruthy();
    expect(purchaseCsv.headers()["content-type"]).toContain("text/csv");
    const csv = await purchaseCsv.text();
    expect(csv).toContain("Runtime Procurement Market");
    expect(csv).toContain("Rice");
    expect(csv).toContain("300");

    const expense = await adminApi.get(`${API}/api/expenses/${created.data.expenseId}`);
    expect(expense.ok()).toBeTruthy();
    await expect(expense.json()).resolves.toMatchObject({
      success: true,
      data: {
        id: created.data.expenseId,
        title: "Purchase · Runtime Procurement Market",
        category: "PURCHASE",
        amount: 600,
        paidTo: "Runtime Procurement Market",
        status: "APPROVED",
      },
    });

    const softDelete = await adminApi.patch(`${API}/api/purchases/${created.data.id}`, {
      data: { action: "SOFT_DELETE", reason: "Runtime procurement recovery verification" },
    });
    expect(softDelete.ok()).toBeTruthy();
    await expect(softDelete.json()).resolves.toMatchObject({
      success: true,
      data: { id: created.data.id, status: "DELETED", deletionReason: "Runtime procurement recovery verification" },
    });

    const emptyStats = await adminApi.get(`${API}/api/purchases/stats?month=8&year=2026`);
    expect(emptyStats.ok()).toBeTruthy();
    await expect(emptyStats.json()).resolves.toMatchObject({ success: true, data: { monthTotal: 0, monthCount: 0 } });

    const restore = await adminApi.post(`${API}/api/purchases/${created.data.id}/restore`, { data: {} });
    expect(restore.ok()).toBeTruthy();
    await expect(restore.json()).resolves.toMatchObject({ success: true, data: { id: created.data.id, status: "APPROVED" } });

    const adminPage = await adminContext.newPage();
    await adminPage.goto(`${WEB}/expenses`);
    const main = adminPage.locator("main");
    await expect(main.getByRole("tab", { name: "Expenses", exact: true })).toBeVisible();
    await expect(main.getByRole("tab", { name: "Purchases", exact: true })).toBeVisible();
    await expect(main.getByRole("tab", { name: "Products", exact: true })).toBeVisible();
    await main.getByRole("tab", { name: "Purchases", exact: true }).click();
    await expect(adminPage.getByRole("heading", { name: "Purchases & Shopping", exact: true })).toBeVisible();
    await expect(adminPage.getByText("Runtime Procurement Market", { exact: true }).first()).toBeVisible();
    await main.getByRole("tab", { name: "Products", exact: true }).click();
    await expect(adminPage.getByRole("heading", { name: "Product Catalog", exact: true })).toBeVisible();
    await expect(adminPage.getByText("Rice", { exact: true }).first()).toBeVisible();

    const registration = await residentApi.post(`${API}/api/auth/register`, {
      headers: { "cf-connecting-ip": REGISTRATION_IP },
      data: {
        name: "Procurement Resident",
        institutionName: "BoardOps Institute",
        institutionUserId: "RES-PHASE23-PROC",
        email: RESIDENT_EMAIL,
        phone: "+919876540223",
        password: RESIDENT_PASSWORD,
        confirmPassword: RESIDENT_PASSWORD,
        room: "P23-223",
        gender: "OTHER",
        consents: { rules: true, privacy: true, terms: true },
      },
    });
    expect(registration.ok()).toBeTruthy();
    const registrationBody = await registration.json() as { success: boolean; data: { userId: string } };
    createdResidentId = registrationBody.data.userId;

    const verify = await residentApi.post(`${API}/api/auth/verify-email`, {
      data: { email: RESIDENT_EMAIL, otp: "424242" },
    });
    expect(verify.ok()).toBeTruthy();

    const approve = await adminApi.patch(`${API}/api/users/${createdResidentId}`, {
      data: { action: "APPROVE", reason: "Procurement least-privilege runtime verification" },
    });
    expect(approve.ok()).toBeTruthy();

    const residentLogin = await residentApi.post(`${API}/api/auth/login`, {
      data: { email: RESIDENT_EMAIL, password: RESIDENT_PASSWORD },
    });
    expect(residentLogin.ok()).toBeTruthy();

    const deniedProducts = await residentApi.get(`${API}/api/products`);
    expect(deniedProducts.status()).toBe(403);
    await expect(deniedProducts.json()).resolves.toMatchObject({ requiredPermission: "products.read" });

    const deniedPurchases = await residentApi.get(`${API}/api/purchases?month=8&year=2026`);
    expect(deniedPurchases.status()).toBe(403);
    await expect(deniedPurchases.json()).resolves.toMatchObject({ requiredPermission: "purchases.read" });

    const deniedCreate = await residentApi.post(`${API}/api/purchases`, {
      headers: { "Idempotency-Key": "resident-denied-procurement" },
      data: purchasePayload,
    });
    expect(deniedCreate.status()).toBe(403);
    await expect(deniedCreate.json()).resolves.toMatchObject({ requiredPermission: "purchases.create" });

    const finalDelete = await adminApi.patch(`${API}/api/purchases/${created.data.id}`, {
      data: { action: "SOFT_DELETE", reason: "Runtime procurement fixture cleanup" },
    });
    expect(finalDelete.ok()).toBeTruthy();
    createdPurchaseId = null;

    const archiveResident = await adminApi.patch(`${API}/api/users/${createdResidentId}`, {
      data: { action: "ARCHIVE", reason: "Procurement runtime fixture cleanup" },
    });
    expect(archiveResident.ok()).toBeTruthy();
    createdResidentId = null;
  } finally {
    const adminApi = adminContext.request;
    if (createdPurchaseId) {
      await adminApi.patch(`${API}/api/purchases/${createdPurchaseId}`, {
        data: { action: "SOFT_DELETE", reason: "Procurement runtime cleanup after assertion failure" },
      }).catch(() => undefined);
    }
    if (createdResidentId) {
      await adminApi.patch(`${API}/api/users/${createdResidentId}`, {
        data: { action: "ARCHIVE", reason: "Procurement runtime cleanup after assertion failure" },
      }).catch(() => undefined);
    }
    await residentContext.close();
    await adminContext.close();
  }
});
