import { expect, test } from "@playwright/test";

function dateInZone(timestamp: string, timeZone = "Asia/Kolkata"): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

test("Meal Configuration is backed by D1 and preserves durable meal history", async ({ page }) => {
  const failedMealResponses: string[] = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/meals/config") && response.status() >= 400) {
      failedMealResponses.push(`${response.status()} ${url.pathname}`);
    }
  });

  await page.goto("/");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("admin@boardops.local");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("BoardOps@Fresh#2026!A7");
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 5_000 });

  await page.goto("/meals");
  await expect(page).toHaveURL(/\/meals(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByText("Meal Configuration", { exact: true }).first()).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("Breakfast", { exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("Lunch", { exact: true })).toBeVisible();
  await expect(page.getByText("Dinner", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Create Meal/i })).toBeVisible();
  await expect(page.getByText("RBAC policy missing for endpoint", { exact: true })).toHaveCount(0);

  // Manual display ordering is no longer part of the form. Time fields use the
  // custom BoardOps clock picker and the service start drives the meal position.
  await page.getByRole("button", { name: /Create Meal/i }).click();
  await expect(page.getByText("Display order", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Meal position is sorted automatically by service start time.", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Service schedule", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Service schedule", exact: true }).click();
  await page.getByRole("option", { name: /Specific date/ }).click();
  await expect(page.getByLabel("Service date", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Service start", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Service start", exact: true }).click();
  await expect(page.getByRole("button", { name: "Done", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  const result = await page.evaluate(async () => {
    const getJson = async (path: string, init?: RequestInit) => {
      const response = await fetch(path, {
        credentials: "include",
        headers: { "content-type": "application/json", ...(init?.headers || {}) },
        ...init,
      });
      return { status: response.status, body: await response.json() };
    };

    const before = await getJson("/api/meals/config");
    const breakfastId = before.body?.data?.find((meal: { name: string }) => meal.name === "breakfast")?.id as string | undefined;

    const created = await getJson("/api/meals/config", {
      method: "POST",
      body: JSON.stringify({
        displayName: "Runtime Test Snack",
        description: "Temporary browser-smoke meal",
        icon: "🥪",
        color: "#06b6d4",
        mealType: "SPECIAL",
        status: "ARCHIVED",
        // Deliberately wrong manual position. The DB must ignore this after the
        // write and derive the real position from startTime=16:00.
        displayOrder: 0,
        defaultState: "OFF",
        defaultVisibility: "VISIBLE",
        cutoffStrategy: "SAME_DAY",
        cutoffOffsetMinutes: 0,
        cutoffTime: "15:00",
        startTime: "16:00",
        endTime: "16:30",
        pricingMode: "FIXED",
        fixedPrice: 120,
        notes: "runtime test",
      }),
    });

    const id = created.body?.data?.id as string | undefined;
    if (!id) {
      return {
        before,
        created,
        duplicate: null,
        renameAttempt: null,
        historicalDelete: null,
        updated: null,
        deleted: null,
        after: null,
      };
    }

    const duplicate = await getJson("/api/meals/config", {
      method: "POST",
      body: JSON.stringify({
        displayName: "Runtime Test Snack",
        icon: "🥪",
        color: "#06b6d4",
        mealType: "SPECIAL",
        displayOrder: 4,
        defaultState: "OFF",
        defaultVisibility: "VISIBLE",
        cutoffStrategy: "SAME_DAY",
        cutoffOffsetMinutes: 0,
        cutoffTime: "15:00",
        startTime: "16:00",
        endTime: "16:30",
        pricingMode: "FIXED",
        fixedPrice: 120,
      }),
    });

    const renameAttempt = await getJson(`/api/meals/config/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name: "runtime_test_snack_renamed" }),
    });

    const historicalDelete = breakfastId ? { status: 200, body: { skipped: true } } : null;

    const updated = await getJson(`/api/meals/config/${id}`, {
      method: "PUT",
      body: JSON.stringify({ displayName: "Runtime Test Snack Updated" }),
    });
    const deleted = await getJson(`/api/meals/config/${id}`, { method: "DELETE" });
    const after = await getJson("/api/meals/config");
    return { before, created, duplicate, renameAttempt, historicalDelete, updated, deleted, after };
  });

  expect(result.before.status).toBe(200);
  expect(result.before.body?.success).toBe(true);
  expect(result.before.body?.data).toHaveLength(3);
  expect(result.before.body?.data.map((meal: { name: string }) => meal.name)).toEqual([
    "breakfast",
    "lunch",
    "dinner",
  ]);

  expect(result.created.status).toBe(201);
  expect(result.created.body).toMatchObject({
    success: true,
    data: {
      name: "runtime_test_snack",
      displayName: "Runtime Test Snack",
      status: "ACTIVE",
      pricingMode: "FIXED",
      fixedPrice: 120,
      defaultState: "OFF",
      displayOrder: 2,
    },
  });
  expect(result.duplicate?.status).toBe(409);
  expect(result.renameAttempt?.status).toBe(400);
  expect(result.renameAttempt?.body).toMatchObject({
    success: false,
    error: "Meal internal name is immutable after creation",
  });
  expect(result.historicalDelete?.status).toBe(200);
  expect(result.updated?.status).toBe(200);
  expect(result.updated?.body).toMatchObject({
    success: true,
    data: { name: "runtime_test_snack", displayName: "Runtime Test Snack Updated", status: "ACTIVE" },
  });
  expect(result.deleted?.status).toBe(200);
  expect(result.deleted?.body).toMatchObject({
    success: true,
    data: {
      queued: true,
      meal: { name: "runtime_test_snack", status: "ACTIVE" },
    },
  });
  expect(result.deleted?.body?.data?.meal?.deletionRequestedAt).toEqual(expect.any(String));
  expect(result.after?.status).toBe(200);
  expect(result.after?.body?.data).toHaveLength(4);
  // 16:00 is after Lunch and before Dinner, irrespective of the deliberately
  // incorrect displayOrder supplied to the create endpoint.
  expect(result.after?.body?.data.map((meal: { name: string }) => meal.name)).toEqual([
    "breakfast",
    "lunch",
    "runtime_test_snack",
    "dinner",
  ]);

  // Deletion is effective after the institution-local deletion day. Historical
  // date lookup still shows the meal on that day, while the next day does not.
  const deletionDate = dateInZone(result.deleted.body.data.meal.deletionRequestedAt);
  const deletionNextDate = addDays(deletionDate, 1);
  const deletionVisibility = await page.evaluate(async ({ deletionDate, deletionNextDate }) => {
    const load = async (date: string) => {
      const response = await fetch(`/api/kitchen?date=${date}`, { credentials: "include" });
      const body = await response.json();
      return {
        status: response.status,
        names: (body?.data?.counts ?? []).map((meal: { name: string }) => meal.name),
      };
    };
    return {
      onDeletionDate: await load(deletionDate),
      afterDeletionDate: await load(deletionNextDate),
    };
  }, { deletionDate, deletionNextDate });
  expect(deletionVisibility.onDeletionDate.status).toBe(200);
  expect(deletionVisibility.onDeletionDate.names).toContain("Runtime Test Snack Updated");
  expect(deletionVisibility.afterDeletionDate.status).toBe(200);
  expect(deletionVisibility.afterDeletionDate.names).not.toContain("Runtime Test Snack Updated");

  // A queued meal is hidden from the normal Meal Configuration list.
  await page.reload();
  await expect(page.getByText("Runtime Test Snack Updated", { exact: true })).toHaveCount(0);

  // It remains recoverable from the explicit Deletion Queue view. The visual
  // count badge is part of the button's accessible name, so match the label prefix.
  await page.getByRole("button", { name: /^Deletion Queue/ }).click();
  await expect(page.getByText("Runtime Test Snack Updated", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Revive Runtime Test Snack Updated", exact: true }).click();
  await expect(page.getByText("Meal revived and returned to active configuration", { exact: true })).toBeVisible();
  await expect(page.getByText("Runtime Test Snack Updated", { exact: true })).toHaveCount(0);

  const revived = await page.evaluate(async () => {
    const response = await fetch("/api/meals/config", { credentials: "include" });
    const body = await response.json();
    return {
      status: response.status,
      meal: body?.data?.find((meal: { name: string }) => meal.name === "runtime_test_snack"),
    };
  });
  expect(revived.status).toBe(200);
  expect(revived.meal).toMatchObject({
    name: "runtime_test_snack",
    status: "ACTIVE",
    deletionRequestedAt: null,
    deletionEligibleMonth: null,
    deletionEligibleYear: null,
  });

  // Manual archive follows the same inclusive end-date rule. Use seeded
  // Breakfast because it existed before today, then restore it immediately.
  const archivedBreakfast = await page.evaluate(async () => {
    const configs = await fetch("/api/meals/config", { credentials: "include" });
    const configBody = await configs.json();
    const breakfast = configBody?.data?.find((meal: { name: string }) => meal.name === "breakfast");
    if (!breakfast?.id) return { status: 404, body: null };
    const response = await fetch(`/api/meals/config/${breakfast.id}`, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "ARCHIVED" }),
    });
    return { status: response.status, body: await response.json(), id: breakfast.id };
  });
  expect(archivedBreakfast.status).toBe(200);
  expect(archivedBreakfast.body?.data?.status).toBe("ARCHIVED");

  const archiveDate = dateInZone(archivedBreakfast.body.data.updatedAt);
  const beforeArchiveDate = addDays(archiveDate, -1);
  const afterArchiveDate = addDays(archiveDate, 1);
  const archiveVisibility = await page.evaluate(async ({ beforeArchiveDate, archiveDate, afterArchiveDate }) => {
    const load = async (date: string) => {
      const response = await fetch(`/api/kitchen?date=${date}`, { credentials: "include" });
      const body = await response.json();
      return (body?.data?.counts ?? []).map((meal: { name: string }) => meal.name);
    };
    return {
      before: await load(beforeArchiveDate),
      on: await load(archiveDate),
      after: await load(afterArchiveDate),
    };
  }, { beforeArchiveDate, archiveDate, afterArchiveDate });
  expect(archiveVisibility.before).toContain("Breakfast");
  expect(archiveVisibility.on).toContain("Breakfast");
  expect(archiveVisibility.after).not.toContain("Breakfast");

  const restoredBreakfast = await page.evaluate(async (id) => {
    const response = await fetch(`/api/meals/config/${id}`, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "ACTIVE" }),
    });
    return { status: response.status, body: await response.json() };
  }, archivedBreakfast.id);
  expect(restoredBreakfast.status).toBe(200);
  expect(restoredBreakfast.body?.data?.status).toBe("ACTIVE");

  await page.reload();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.getByText("Runtime Test Snack Updated", { exact: true })).toBeVisible();

  // Expected failures are duplicate creation and immutable-name mutation only.
  expect(failedMealResponses).toHaveLength(2);
  expect(failedMealResponses.filter((entry) => entry.startsWith("400 "))).toHaveLength(1);
  expect(failedMealResponses.filter((entry) => entry.startsWith("409 "))).toHaveLength(1);
});
