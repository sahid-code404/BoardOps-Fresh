import { expect, test } from "@playwright/test";

test("Counts uses real D1 meal entries, guests, overrides and leave decisions", async ({ page }) => {
  test.setTimeout(45_000);

  await page.goto("/");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("admin@boardops.local");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("BoardOps@Fresh#2026!A7");
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 5_000 });
  // Match the proven authenticated runtime flow used by the Meal Configuration
  // regression. The URL changes immediately after login, while the shell then
  // finishes validating the HttpOnly cookie and hydrating the current user.
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 5_000 });

  // Probe the same browser-origin API contract before asserting rendered cards.
  // If this ever fails, Playwright prints the real status/body instead of
  // masking a backend problem as a generic "Breakfast not visible" failure.
  const kitchenProbe = await page.evaluate(async () => {
    const response = await fetch("/api/kitchen?date=2026-08-30", { credentials: "include" });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  });
  expect(kitchenProbe).toMatchObject({
    status: 200,
    body: {
      success: true,
      data: {
        activeUsers: 1,
        counts: expect.arrayContaining([
          expect.objectContaining({ id: "meal_breakfast_local", displayName: "Breakfast" }),
          expect.objectContaining({ id: "meal_lunch_local", displayName: "Lunch" }),
          expect.objectContaining({ id: "meal_dinner_local", displayName: "Dinner" }),
        ]),
      },
    },
  });

  // Regression: Counts must infer the resident's effective default state even
  // when no meal_entries rows were materialized by opening /user-meals first.
  // Aug 29 is after Riya's enrollment, in an OPEN accounting period, and has no
  // seeded meal-entry rows, so the three past default-ON meals are confirmed.
  const inferredDefaultsProbe = await page.evaluate(async () => {
    const response = await fetch("/api/kitchen?date=2026-08-29", { credentials: "include" });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  });
  expect(inferredDefaultsProbe.status).toBe(200);
  for (const mealId of ["meal_breakfast_local", "meal_lunch_local", "meal_dinner_local"]) {
    const meal = inferredDefaultsProbe.body?.data?.counts?.find((item: { id: string }) => item.id === mealId);
    expect(meal).toMatchObject({ on: 1, off: 0, guests: 0, total: 1 });
  }

  await page.goto("/kitchen");
  await expect(page).toHaveURL(/\/kitchen(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByText("Breakfast", { exact: true }).first()).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("Lunch", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Dinner", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Riya Sen", { exact: true }).first()).toBeVisible();
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

    const before = await request("/api/kitchen?date=2026-08-30");
    const invalidDate = await request("/api/kitchen?date=2026-8-30");
    const guestCreated = await request("/api/kitchen", {
      method: "POST",
      body: JSON.stringify({
        mealId: "meal_breakfast_local",
        guestCount: 3,
        serviceDate: "2026-08-30",
        notes: "Runtime kitchen smoke",
      }),
    });
    const afterGuest = await request("/api/kitchen?date=2026-08-30");
    const guestId = guestCreated.body?.data?.id as string | undefined;
    const guestDeleted = guestId
      ? await request("/api/kitchen", { method: "DELETE", body: JSON.stringify({ guestMealId: guestId }) })
      : null;
    const invalidGuestCount = await request("/api/kitchen", {
      method: "POST",
      body: JSON.stringify({
        mealId: "meal_breakfast_local",
        guestCount: 101,
        serviceDate: "2026-08-30",
        notes: "Invalid runtime guest count",
      }),
    });
    const closedPeriodGuest = await request("/api/kitchen", {
      method: "POST",
      body: JSON.stringify({
        mealId: "meal_breakfast_local",
        guestCount: 1,
        serviceDate: "2026-07-15",
        notes: "Closed-period runtime guard",
      }),
    });

    const override = await request("/api/meals/override", {
      method: "POST",
      body: JSON.stringify({
        mealId: "meal_lunch_local",
        userId: "usr_resident_riya_local",
        serviceDate: "2026-08-30",
        action: "TURN_ON",
        reason: "Runtime kitchen override verification",
      }),
    });
    const lock = await request("/api/meals/override", {
      method: "POST",
      body: JSON.stringify({
        mealId: "meal_lunch_local",
        userId: "usr_resident_riya_local",
        serviceDate: "2026-08-30",
        action: "LOCK",
        reason: "Runtime lock-state preservation verification",
      }),
    });
    const unlock = await request("/api/meals/override", {
      method: "POST",
      body: JSON.stringify({
        mealId: "meal_lunch_local",
        userId: "usr_resident_riya_local",
        serviceDate: "2026-08-30",
        action: "UNLOCK",
        reason: "Runtime unlock-state preservation verification",
      }),
    });
    const afterOverride = await request("/api/kitchen?date=2026-08-30");

    const leaveBefore = await request("/api/leave");
    const leaveDecision = await request("/api/leave/leave_riya_pending_local", {
      method: "PATCH",
      body: JSON.stringify({ status: "APPROVED", adminNotes: "Runtime leave approval verification" }),
    });
    const futureKitchen = await request("/api/kitchen?date=2026-09-02");

    return {
      before,
      invalidDate,
      guestCreated,
      afterGuest,
      guestDeleted,
      invalidGuestCount,
      closedPeriodGuest,
      override,
      lock,
      unlock,
      afterOverride,
      leaveBefore,
      leaveDecision,
      futureKitchen,
    };
  });

  expect(result.before.status).toBe(200);
  expect(result.before.body).toMatchObject({
    success: true,
    data: { activeUsers: 1 },
  });
  expect(result.before.body.data.counts).toHaveLength(3);
  expect(result.before.body.data.userMealStatus).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: "Riya Sen", room: "B-204" })]),
  );
  expect(result.before.body.data.guestMealEntries).toEqual(
    expect.arrayContaining([expect.objectContaining({ mealId: "meal_lunch_local", guestCount: 2 })]),
  );
  expect(result.invalidDate.status).toBe(400);
  expect(result.invalidDate.body).toMatchObject({ success: false, error: "date must use YYYY-MM-DD" });

  expect(result.guestCreated.status).toBe(201);
  expect(result.guestCreated.body).toMatchObject({ success: true, data: { guestCount: 3, mealId: "meal_breakfast_local" } });
  const breakfastAfterGuest = result.afterGuest.body.data.counts.find((meal: { id: string }) => meal.id === "meal_breakfast_local");
  expect(breakfastAfterGuest.guests).toBeGreaterThanOrEqual(3);
  expect(result.guestDeleted?.status).toBe(200);
  expect(result.invalidGuestCount.status).toBe(400);
  expect(result.invalidGuestCount.body).toMatchObject({ success: false, error: "guestCount must be between 1 and 100" });
  expect(result.closedPeriodGuest.status).toBe(409);
  expect(result.closedPeriodGuest.body).toMatchObject({
    success: false,
    error: "Guest meals cannot be changed in a closing or closed accounting period",
  });

  expect(result.override.status).toBe(200);
  expect(result.override.body).toMatchObject({
    success: true,
    data: { mealId: "meal_lunch_local", userId: "usr_resident_riya_local", status: "ON", originalState: "OFF" },
  });
  expect(result.lock.status).toBe(200);
  expect(result.lock.body).toMatchObject({
    success: true,
    data: { status: "ON", originalState: "OFF", locked: true },
  });
  expect(result.unlock.status).toBe(200);
  expect(result.unlock.body).toMatchObject({
    success: true,
    data: { status: "ON", originalState: "OFF", locked: false },
  });
  const lunchAfterOverride = result.afterOverride.body.data.counts.find((meal: { id: string }) => meal.id === "meal_lunch_local");
  expect(lunchAfterOverride.on).toBe(1);
  expect(lunchAfterOverride.off).toBe(0);

  expect(result.leaveBefore.status).toBe(200);
  expect(result.leaveBefore.body.data).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: "leave_riya_pending_local", status: "PENDING" })]),
  );
  expect(result.leaveDecision.status).toBe(200);
  expect(result.leaveDecision.body).toMatchObject({ success: true, data: { id: "leave_riya_pending_local", status: "APPROVED" } });
  expect(result.futureKitchen.status).toBe(200);
  const riyaFuture = result.futureKitchen.body.data.userMealStatus.find((resident: { userId: string }) => resident.userId === "usr_resident_riya_local");
  expect(riyaFuture.meals).toHaveLength(3);
  expect(riyaFuture.meals.every((meal: { status: string; locked: boolean }) => meal.status === "OFF" && meal.locked)).toBe(true);
});