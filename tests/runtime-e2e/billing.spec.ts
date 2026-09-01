import { expect, test } from "@playwright/test";

test("Billing is read/manage-only and bill generation is owned by Monthly Closing", async ({ page }) => {
  test.setTimeout(50_000);

  await page.goto("/");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("admin@boardops.local");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("BoardOps@Fresh#2026!A7");
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 5_000 });

  await page.goto("/billing");
  await expect(page).toHaveURL(/\/billing(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByRole("button", { name: "Monthly Closing", exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("Generate Bills", { exact: true })).toHaveCount(0);
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
    const manualGenerate = await request("/api/bills", {
      method: "POST",
      body: JSON.stringify({ month: 5, year: 2026, dueDate: "2026-12-10" }),
    });
    const juneAfterBlockedGenerate = await request("/api/bills?month=5&year=2026");

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
    return {
      julyBefore,
      juneClosingReadiness,
      manualGenerate,
      juneAfterBlockedGenerate,
      julyDeleted,
      julyQueue,
      julyRestored,
      julyAfterRestore,
      futureReadiness,
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

  // `/billing-cycles/readiness` belongs to Monthly Closing. The Billing
  // surface cannot publish the seeded June snapshot directly anymore.
  expect(result.juneClosingReadiness.status).toBe(200);
  expect(result.juneClosingReadiness.body).toMatchObject({ success: true, data: { canClose: false } });
  expect(result.juneClosingReadiness.body.data.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ key: "cycle", status: "error" }),
      expect.objectContaining({ key: "snapshot", status: "error" }),
    ]),
  );

  expect(result.manualGenerate.status).toBe(409);
  expect(result.manualGenerate.body).toMatchObject({
    success: false,
    error: "Bills are generated only through Monthly Closing. Close the billing period to create bills.",
  });
  expect(result.juneAfterBlockedGenerate.status).toBe(200);
  expect(result.juneAfterBlockedGenerate.body.data).toHaveLength(0);

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

});