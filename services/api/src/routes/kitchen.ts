import { Hono, type Context } from "hono";
import { authenticatedPrincipal, type AuthPrincipal } from "../auth/authorization";
import {
  computeEditableUntilIso,
  isBeforeEnrollment,
  isDateString,
  isLockedAt,
  isOverridden,
  monthBounds,
  todayInTimeZone,
} from "../meals/engine";
import type { AppEnv } from "../types";

type MealRow = {
  id: string;
  display_name: string;
  icon: string;
  color: string;
  start_time: string;
  end_time: string;
  default_state: string;
  cutoff_strategy: string;
  cutoff_offset_minutes: number;
  cutoff_time: string;
};

type MealEntryRow = {
  id: string;
  user_id: string;
  meal_id: string;
  service_date: string;
  status: string;
  original_state: string;
  editable_until: string;
  locked: number;
};

type GuestRow = {
  id: string;
  meal_id: string;
  guest_count: number;
  notes: string | null;
  guest_name: string;
  service_date: string;
};

type ResidentRow = {
  id: string;
  name: string;
  email: string;
  room: string | null;
  avatar_url: string | null;
  created_at: string;
};

export const kitchenRoutes = new Hono<AppEnv>();

async function principalFor(c: Context<AppEnv>): Promise<AuthPrincipal | Response> {
  const principal = await authenticatedPrincipal(c);
  return principal ?? c.json({ success: false, error: "Authentication required" }, 401);
}

async function institutionTimezone(c: Context<AppEnv>, institutionId: string): Promise<string> {
  const row = await c.env.DB.prepare(`SELECT timezone FROM institutions WHERE id = ? LIMIT 1`)
    .bind(institutionId)
    .first<{ timezone: string }>();
  return row?.timezone || "UTC";
}

function confirmedOn(entry: MealEntryRow, isPastDate: boolean, now = new Date()): boolean {
  if (entry.status !== "ON" && entry.status !== "LOCKED") return false;
  const locked = isPastDate || entry.locked === 1 || entry.status === "LOCKED" || isLockedAt(entry.editable_until, now);
  return locked || isOverridden(entry.status, entry.original_state);
}

function confirmedOff(entry: MealEntryRow, isPastDate: boolean, now = new Date()): boolean {
  if (entry.status !== "OFF") return false;
  const locked = isPastDate || entry.locked === 1 || isLockedAt(entry.editable_until, now);
  return locked && !isOverridden(entry.status, entry.original_state);
}

async function audit(
  c: Context<AppEnv>,
  principal: AuthPrincipal,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  await c.env.DB.prepare(
    `INSERT INTO audit_events
      (id, institution_id, actor_user_id, action, entity_type, entity_id,
       request_id, reason, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'GuestMeal', ?, ?, NULL, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      principal.institutionId,
      principal.id,
      action,
      entityId,
      c.get("requestId"),
      JSON.stringify(metadata),
      new Date().toISOString(),
    )
    .run();
}

kitchenRoutes.get("/kitchen", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;
  const principal = auth;
  const timeZone = await institutionTimezone(c, principal.institutionId);
  const requestedDate = (c.req.query("date") ?? "").trim();
  const serviceDate = requestedDate || todayInTimeZone(timeZone);
  if (!isDateString(serviceDate)) {
    return c.json({ success: false, error: "date must use YYYY-MM-DD" }, 400);
  }

  const now = new Date();
  const today = todayInTimeZone(timeZone, now);
  const isPastDate = serviceDate < today;
  const month = monthBounds(serviceDate);

  const [mealsResult, residentsResult, entriesResult, guestsResult, monthEntriesResult, monthGuestsResult] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, display_name, icon, color, start_time, end_time, default_state,
              cutoff_strategy, cutoff_offset_minutes, cutoff_time
         FROM meal_configurations
        WHERE institution_id = ? AND status = 'ACTIVE'
        ORDER BY display_order ASC, created_at ASC`,
    ).bind(principal.institutionId).all<MealRow>(),
    c.env.DB.prepare(
      `SELECT id, name, email, room, avatar_url, created_at
         FROM users
        WHERE institution_id = ? AND role = 'USER' AND status = 'ACTIVE' AND deleted_at IS NULL
        ORDER BY name COLLATE NOCASE ASC`,
    ).bind(principal.institutionId).all<ResidentRow>(),
    c.env.DB.prepare(
      `SELECT e.id, e.user_id, e.meal_id, e.service_date, e.status, e.original_state,
              e.editable_until, e.locked
         FROM meal_entries e
         JOIN users u ON u.id = e.user_id
        WHERE e.institution_id = ? AND e.service_date = ?
          AND u.institution_id = e.institution_id AND u.role = 'USER' AND u.deleted_at IS NULL`,
    ).bind(principal.institutionId, serviceDate).all<MealEntryRow>(),
    c.env.DB.prepare(
      `SELECT id, meal_id, guest_count, notes, guest_name, service_date
         FROM guest_meals
        WHERE institution_id = ? AND service_date = ?
        ORDER BY created_at ASC`,
    ).bind(principal.institutionId, serviceDate).all<GuestRow>(),
    c.env.DB.prepare(
      `SELECT e.id, e.user_id, e.meal_id, e.service_date, e.status, e.original_state,
              e.editable_until, e.locked
         FROM meal_entries e
         JOIN users u ON u.id = e.user_id
        WHERE e.institution_id = ? AND e.service_date BETWEEN ? AND ?
          AND u.institution_id = e.institution_id AND u.role = 'USER' AND u.deleted_at IS NULL`,
    ).bind(principal.institutionId, month.start, month.end).all<MealEntryRow>(),
    c.env.DB.prepare(
      `SELECT id, meal_id, guest_count, notes, guest_name, service_date
         FROM guest_meals
        WHERE institution_id = ? AND service_date BETWEEN ? AND ?`,
    ).bind(principal.institutionId, month.start, month.end).all<GuestRow>(),
  ]);

  const meals = mealsResult.results;
  const residents = residentsResult.results;
  const entries = entriesResult.results;
  const guests = guestsResult.results;
  const monthEntries = monthEntriesResult.results;
  const monthGuests = monthGuestsResult.results;

  const counts = meals.map((meal) => {
    const mealEntries = entries.filter((entry) => entry.meal_id === meal.id);
    const on = mealEntries.filter((entry) => confirmedOn(entry, isPastDate, now)).length;
    const off = mealEntries.filter((entry) => confirmedOff(entry, isPastDate, now)).length;
    const guestCount = guests
      .filter((guest) => guest.meal_id === meal.id)
      .reduce((sum, guest) => sum + Number(guest.guest_count || 0), 0);
    return {
      id: meal.id,
      name: meal.display_name,
      displayName: meal.display_name,
      icon: meal.icon,
      color: meal.color,
      startTime: meal.start_time,
      endTime: meal.end_time,
      on,
      off,
      guests: guestCount,
      total: on + guestCount,
    };
  });

  const monthOn = monthEntries.filter((entry) => confirmedOn(entry, entry.service_date < today, now));
  const monthOff = monthEntries.filter((entry) => confirmedOff(entry, entry.service_date < today, now));
  const monthGuestCount = monthGuests.reduce((sum, guest) => sum + Number(guest.guest_count || 0), 0);

  const userMealStatus = residents.map((resident) => {
    const residentEntries = entries.filter((entry) => entry.user_id === resident.id);
    const mealsForResident = meals.map((meal) => {
      const entry = residentEntries.find((candidate) => candidate.meal_id === meal.id);
      const preEnrollment = isBeforeEnrollment(serviceDate, resident.created_at, meal, timeZone);
      const editableUntil = entry?.editable_until ?? computeEditableUntilIso(meal, serviceDate, timeZone);
      const currentStatus = entry?.status ?? (preEnrollment ? "OFF" : meal.default_state);
      const originalState = entry?.original_state ?? (preEnrollment ? "OFF" : meal.default_state);
      const locked = preEnrollment || entry?.locked === 1 || currentStatus === "LOCKED" || isLockedAt(editableUntil, now);
      const overridden = entry ? isOverridden(currentStatus, originalState) : false;
      return {
        mealId: meal.id,
        mealName: meal.display_name,
        mealIcon: meal.icon,
        mealColor: meal.color,
        status: currentStatus,
        originalState,
        locked,
        overridden,
      };
    });

    const onCount = mealsForResident.filter((meal) =>
      (meal.status === "ON" || meal.status === "LOCKED") && (meal.locked || meal.overridden),
    ).length;
    const offCount = mealsForResident.filter((meal) =>
      meal.status === "OFF" && meal.locked && !meal.overridden,
    ).length;
    const monthConsumed = monthOn.filter((entry) => entry.user_id === resident.id).length;

    return {
      userId: resident.id,
      name: resident.name,
      email: resident.email,
      room: resident.room,
      avatarUrl: resident.avatar_url,
      onCount,
      offCount,
      monthConsumed,
      meals: mealsForResident,
      notEnrolled: mealsForResident.every((meal) => meal.originalState === "OFF") && serviceDate < dateInRegistration(resident.created_at, timeZone),
    };
  });

  return c.json({
    success: true,
    data: {
      date: serviceDate,
      counts,
      activeUsers: residents.length,
      monthTotals: {
        meals: monthOn.length + monthGuestCount,
        guests: monthGuestCount,
        off: monthOff.length,
      },
      userMealStatus,
      guestMealEntries: guests.map((guest) => ({
        id: guest.id,
        mealId: guest.meal_id,
        guestCount: guest.guest_count,
        notes: guest.notes,
        guestName: guest.guest_name,
      })),
    },
  });
});

function dateInRegistration(createdAt: string, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(createdAt)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

kitchenRoutes.post("/kitchen", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;
  const principal = auth;
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await c.req.json();
    body = typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const mealId = typeof body.mealId === "string" ? body.mealId.trim() : "";
  const serviceDate = typeof body.serviceDate === "string" ? body.serviceDate.trim() : "";
  const guestCount = typeof body.guestCount === "number" && Number.isInteger(body.guestCount) ? body.guestCount : 1;
  const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
  if (!mealId || !isDateString(serviceDate)) return c.json({ success: false, error: "Valid mealId and serviceDate are required" }, 400);
  if (guestCount < 1 || guestCount > 100) return c.json({ success: false, error: "guestCount must be between 1 and 100" }, 400);
  if ((notes?.length ?? 0) > 500) return c.json({ success: false, error: "Guest meal notes are too long" }, 400);

  const meal = await c.env.DB.prepare(
    `SELECT id, display_name FROM meal_configurations
      WHERE id = ? AND institution_id = ? AND status = 'ACTIVE' LIMIT 1`,
  ).bind(mealId, principal.institutionId).first<{ id: string; display_name: string }>();
  if (!meal) return c.json({ success: false, error: "Meal not found or inactive" }, 404);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO guest_meals
        (id, institution_id, meal_id, host_user_id, guest_name, guest_count, service_date, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, principal.institutionId, mealId, principal.id, `Guest (${meal.display_name})`, guestCount, serviceDate, notes, now),
    c.env.DB.prepare(
      `INSERT INTO audit_events
        (id, institution_id, actor_user_id, action, entity_type, entity_id, request_id, reason, metadata_json, created_at)
       VALUES (?, ?, ?, 'GUEST_MEAL_CREATED', 'GuestMeal', ?, ?, NULL, ?, ?)`,
    ).bind(crypto.randomUUID(), principal.institutionId, principal.id, id, c.get("requestId"), JSON.stringify({ mealId, serviceDate, guestCount, notes }), now),
  ]);

  return c.json({ success: true, data: { id, mealId, guestCount, serviceDate, notes, guestName: `Guest (${meal.display_name})` } }, 201);
});

kitchenRoutes.delete("/kitchen", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;
  const principal = auth;
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await c.req.json();
    body = typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }
  const guestMealId = typeof body.guestMealId === "string" ? body.guestMealId.trim() : "";
  if (!guestMealId) return c.json({ success: false, error: "guestMealId is required" }, 400);

  const existing = await c.env.DB.prepare(
    `SELECT id, meal_id, service_date, guest_count, notes
       FROM guest_meals WHERE id = ? AND institution_id = ? LIMIT 1`,
  ).bind(guestMealId, principal.institutionId).first<{ id: string; meal_id: string; service_date: string; guest_count: number; notes: string | null }>();
  if (!existing) return c.json({ success: false, error: "Guest meal not found" }, 404);

  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM guest_meals WHERE id = ? AND institution_id = ?`).bind(guestMealId, principal.institutionId),
    c.env.DB.prepare(
      `INSERT INTO audit_events
        (id, institution_id, actor_user_id, action, entity_type, entity_id, request_id, reason, metadata_json, created_at)
       VALUES (?, ?, ?, 'GUEST_MEAL_DELETED', 'GuestMeal', ?, ?, NULL, ?, ?)`,
    ).bind(crypto.randomUUID(), principal.institutionId, principal.id, guestMealId, c.get("requestId"), JSON.stringify(existing), now),
  ]);
  return c.json({ success: true, data: { deleted: true } });
});
