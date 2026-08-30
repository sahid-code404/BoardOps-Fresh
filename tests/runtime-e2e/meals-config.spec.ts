import { expect, test } from "@playwright/test";

test("Meal Configuration is backed by D1 and explicit RBAC instead of an unmapped endpoint", async ({ page }) => {
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
    const created = await getJson("/api/meals/config", {
      method: "POST",
      body: JSON.stringify({
        name: "runtime_test_snack",
        displayName: "Runtime Test Snack",
        description: "Temporary browser-smoke meal",
        icon: "🥪",
        color: "#06b6d4",
        mealType: "SPECIAL",
        displayOrder: 99,
        defaultState: "OFF",
        defaultVisibility: "VISIBLE",
        cutoffStrategy: "SAME_DAY",
        cutoffOffsetMinutes: 0,
        cutoffTime: "15:00",
        startTime: "16:00",
        endTime: "16:30",
        notes: "runtime test",
      }),
    });

    const id = created.body?.data?.id as string | undefined;
    if (!id) return { before, created, updated: null, duplicate: null, deleted: null, after: null };

    const duplicate = await getJson("/api/meals/config", {
      method: "POST",
      body: JSON.stringify({
        name: "runtime_test_snack",
        displayName: "Duplicate Runtime Test Snack",
        icon: "🥪",
        color: "#06b6d4",
        mealType: "SPECIAL",
        displayOrder: 100,
        defaultState: "OFF",
        defaultVisibility: "VISIBLE",
        cutoffStrategy: "SAME_DAY",
        cutoffOffsetMinutes: 0,
        cutoffTime: "15:00",
        startTime: "16:00",
        endTime: "16:30",
      }),
    });

    const updated = await getJson(`/api/meals/config/${id}`, {
      method: "PUT",
      body: JSON.stringify({ status: "INACTIVE", displayName: "Runtime Test Snack Updated" }),
    });
    const deleted = await getJson(`/api/meals/config/${id}`, { method: "DELETE" });
    const after = await getJson("/api/meals/config");
    return { before, created, duplicate, updated, deleted, after };
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
    data: { name: "runtime_test_snack", displayName: "Runtime Test Snack", status: "ACTIVE" },
  });
  expect(result.duplicate?.status).toBe(409);
  expect(result.updated?.status).toBe(200);
  expect(result.updated?.body).toMatchObject({
    success: true,
    data: { displayName: "Runtime Test Snack Updated", status: "INACTIVE" },
  });
  expect(result.deleted?.status).toBe(200);
  expect(result.deleted?.body).toMatchObject({ success: true, data: { deleted: true } });
  expect(result.after?.status).toBe(200);
  expect(result.after?.body?.data).toHaveLength(3);

  // The intentionally exercised duplicate request is the only expected failure.
  expect(failedMealResponses.filter((entry) => !entry.startsWith("409 "))).toEqual([]);
});
