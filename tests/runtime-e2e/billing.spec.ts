import { expect, test } from "@playwright/test";

test("Billing uses immutable D1 snapshots and preserves bill lifecycle semantics", async ({ page }) => {
  test.setTimeout(50_000);

  await page.goto("/");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("admin@boardops.local");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("BoardOps@Fresh#2026!A7");
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 5_000 });

  await page.goto("/billing");
  await expect(page).toHaveURL(/\/billing(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByText("Generate Bills", { exact: true }).first()).toBeVisible({ timeout: 8_000 });
  await page.getByRole("button", { name: "Previous month", exact: true }).click();
  await expect(page.getByText("Arjun Rao", { exact: true }).first()).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("RBAC policy missing for endpoint", { exact: true })).toHaveCount(0);

  const result = await page.evaluate(async () => {
    const request = async (path: string, init?: RequestInit) => {
      const response = await fetch(path, {
        credentials: "include",
        headers: { "content-type": "application/json", ...(init?.headers || {}) },
        ...init,
      });
      return { status: response.status, body: await response.json() };
    };

    const julyBefore = await request("/api/bills?month=6&year=2026");
    const juneClosingReadiness = await request("/api/billing-cycles/readiness?month=5&year=2026");
    const juneGenerated = await request("/api/bills", {
      method: "POST",
      body: JSON.stringify({ month: 5, year: 2026, dueDate: "2026-12-10" }),
    });
    const juneAfter = await request("/api/bills?month=5&year=2026");
    const juneRegenerated = await request("/api/bills", {
      method: "POST",
      body: JSON.stringify({ month: 5, year: 2026, dueDate: "2026-12-11" }),
    });
    const juneBillId = juneAfter.body?.data?.[0]?.id as string | undefined;
    const juneVoided = juneBillId
      ? await request(`/api/bills/${juneBillId}/void`, { method: "POST", body: "{}" })
      : null;

    const julyDeleted = await request("/api/bills/bill_arjun_2026_07_local", {
      method: "DELETE",
      body: JSON.stringify({ reason: "Runtime billing recovery test" }),
    });
    const julyQueue = await request("/api/bills?month=6&year=2026&includeDeleted=true");
    const julyRestored = await request("/api/bills/bill_arjun_2026_07_local/restore", {
      method: "POST",
      body: "{}",
    });
    const julyAfterRestore = await request("/api/bills?month=6&year=2026");

    // Keep this guard independent of the calendar date on which CI happens to
    // run. A period two UTC months ahead is necessarily future for every
    // supported institution timezone, including around month boundaries.
    const futurePeriod = new Date();
    futurePeriod.setUTCDate(1);
    futurePeriod.setUTCHours(0, 0, 0, 0);
    futurePeriod.setUTCMonth(futurePeriod.getUTCMonth() + 2);
    const futureReadiness = await request(
      `/api/billing-cycles/readiness?month=${futurePeriod.getUTCMonth()}&year=${futurePeriod.getUTCFullYear()}`,
    );
    const closedJulyGenerate = await request("/api/bills", {
      method: "POST",
      body: JSON.stringify({ month: 6, year: 2026 }),
    });

    return {
      julyBefore,
      juneClosingReadiness,
      juneGenerated,
      juneAfter,
      juneRegenerated,
      juneVoided,
      julyDeleted,
      julyQueue,
      julyRestored,
      julyAfterRestore,
      futureReadiness,
      closedJulyGenerate,
    };
  });

  expect(result.julyBefore.status).toBe(200);
  expect(result.julyBefore.body).toMatchObject({ success: true });
  expect(result.julyBefore.body.data).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "bill_arjun_2026_07_local",
        periodMonth: 6,
        periodYear: 2026,
        totalAmount: 18500,
        paidAmount: 5000,
        dueAmount: 13500,
        user: expect.objectContaining({ name: "Arjun Rao", room: "A-101" }),
      }),
    ]),
  );

  // `/billing-cycles/readiness` is the Monthly Closing contract now. June has
  // an immutable Billing-Core snapshot but no cycle-owned closing workflow, so
  // closing must fail closed while direct snapshot bill generation remains valid.
  expect(result.juneClosingReadiness.status).toBe(200);
  expect(result.juneClosingReadiness.body).toMatchObject({ success: true, data: { canClose: false } });
  expect(result.juneClosingReadiness.body.data.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ key: "cycle", status: "error" }),
      expect.objectContaining({ key: "snapshot", status: "error" }),
    ]),
  );

  expect(result.juneGenerated.status).toBe(200);
  expect(result.juneGenerated.body).toMatchObject({
    success: true,
    data: { generated: 1, created: 1, updated: 0, skipped: 0, month: 5, year: 2026 },
  });
  expect(result.juneAfter.status).toBe(200);
  expect(result.juneAfter.body.data).toHaveLength(1);
  expect(result.juneAfter.body.data[0]).toMatchObject({
    totalAmount: 17300,
    paidAmount: 0,
    dueAmount: 17300,
    status: "GENERATED",
    user: { name: "Arjun Rao" },
  });

  // Re-running generation must not re-price the immutable generated bill even
  // though a different due date was supplied on the second request.
  expect(result.juneRegenerated.status).toBe(200);
  expect(result.juneRegenerated.body).toMatchObject({
    success: true,
    data: { generated: 0, created: 0, updated: 0, skipped: 1 },
  });

  expect(result.juneVoided?.status).toBe(200);
  expect(result.juneVoided?.body).toMatchObject({
    success: true,
    data: { status: "VOID", totalAmount: 17300, dueAmount: 0 },
  });

  expect(result.julyDeleted.status).toBe(200);
  expect(result.julyQueue.status).toBe(200);
  expect(result.julyQueue.body.data).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "bill_arjun_2026_07_local", status: "DELETED", deletionReason: "Runtime billing recovery test" }),
    ]),
  );
  expect(result.julyRestored.status).toBe(200);
  expect(result.julyRestored.body).toMatchObject({ success: true, data: { id: "bill_arjun_2026_07_local" } });
  expect(result.julyAfterRestore.body.data).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: "bill_arjun_2026_07_local", deletedAt: null })]),
  );

  expect(result.futureReadiness.status).toBe(200);
  expect(result.futureReadiness.body.data.canClose).toBe(false);
  expect(result.futureReadiness.body.data.items).toEqual(
    expect.arrayContaining([expect.objectContaining({ key: "period", status: "error" })]),
  );

  expect(result.closedJulyGenerate.status).toBe(422);
  expect(result.closedJulyGenerate.body).toMatchObject({ success: false });
});