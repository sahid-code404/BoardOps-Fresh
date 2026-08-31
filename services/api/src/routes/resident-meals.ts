import { Hono, type Context } from "hono";
import { authenticatedPrincipal, type AuthPrincipal } from "../auth/authorization";
import {
  computeEditableUntilIso,
  enumerateDates,
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
  name: string;
  display_name: string;
  icon: string;
  color: string;
  meal_type: string;
  default_state: "ON" | "OFF";
  cutoff_strategy: string;
  cutoff_offset_minutes: number;
  cutoff_time: string;
  start_time: string;
  end_time: string;
};

type EntryRow = {
  id: string;
  institution_id: string;
  user_id: string;
  meal_id: string;
  service_date: string;
  status: "ON" | "OFF" | "LOCKED";
  original_state: "ON" | "OFF";
  editable_until: string;
  locked: number;
  notes: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type UserRow = {
  created_at: string;
};

type InstitutionRow = {
  timezone: string;
};

type HolidayRow = {
  start_date: string;
  end_date: string;
};

type LockedPeriodRow = {
  starts_on: string;
  ends_on: string;
};

type ToggleEntryRow = EntryRow & {
  meal_name: string;
  meal_display_name: string;
  meal_icon: string;
  meal_color: string;
  meal_type: string;
  meal_default_state: "ON" | "OFF";
  meal_cutoff_strategy: string;
  meal_cutoff_offset_minutes: number;
  meal_cutoff_time: string;
  meal_start_time: string;
  meal_end_time: string;
};

export const residentMealRoutes = new Hono<AppEnv>();

function mappedMeal(row: MealRow) {
  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    icon: row.icon,
    color: row.color,
    startTime: row.start_time,
    endTime: row.end_time,
    cutoffTime: row.cutoff_time,
  };
}

function mappedEntry(row: EntryRow, meal: MealRow, preRegistration: boolean, now: Date) {
  const locked = row.locked === 1 || isLockedAt(row.editable_until, now) || row.status === "LOCKED";
  return {
    id: row.id,
    mealId: meal.id,
    mealName: meal.name,
    mealDisplayName: meal.display_name,
    mealIcon: meal.icon,
    mealColor: meal.color,
    serviceDate: row.service_date,
    status: row.status,
    originalState: row.original_state,
    overridden: isOverridden(row.status, row.original_state),
    editableUntil: row.editable_until,
    locked,
    preRegistration,
    startTime: meal.start_time,
    endTime: meal.end_time,
    mealType: meal.meal_type,
  };
}

function dateCovered(date: string, ranges: Array<{ start_date?: string; end_date?: string; starts_on?: string; ends_on?: string }>) {
  return ranges.some((range) => {
    const start = range.start_date ?? range.starts_on ?? "";
    const end = range.end_date ?? range.ends_on ?? "";
    return start <= date && date <= end;
  });
}

function mealFromToggleRow(row: ToggleEntryRow): MealRow {
  return {
    id: row.meal_id,
    name: row.meal_name,
    display_name: row.meal_display_name,
    icon: row.meal_icon,
    color: row.meal_color,
    meal_type: row.meal_type,
    default_state: row.meal_default_state,
    cutoff_strategy: row.meal_cutoff_strategy,
    cutoff_offset_minutes: row.meal_cutoff_offset_minutes,
    cutoff_time: row.meal_cutoff_time,
    start_time: row.meal_start_time,
    end_time: row.meal_end_time,
  };
}

async function readPrincipalContext(c: Context<AppEnv>, principal: AuthPrincipal) {
  const [user, institution, meals] = await Promise.all([
    c.env.DB.prepare(
      `SELECT created_at FROM users WHERE id = ? AND institution_id = ? LIMIT 1`,
    ).bind(principal.id, principal.institutionId).first<UserRow>(),
    c.env.DB.prepare(
      `SELECT timezone FROM institutions WHERE id = ? LIMIT 1`,
    ).bind(principal.institutionId).first<InstitutionRow>(),
    c.env.DB.prepare(
      `SELECT id, name, display_name, icon, color, meal_type, default_state,
              cutoff_strategy, cutoff_offset_minutes, cutoff_time, start_time, end_time
         FROM meal_configurations
        WHERE institution_id = ? AND status = 'ACTIVE'
        ORDER BY display_order ASC, created_at ASC`,
    ).bind(principal.institutionId).all<MealRow>(),
  ]);

  if (!user) return null;
  return {
    user,
    timeZone: institution?.timezone || "UTC",
    meals: meals.results,
  };
}

function requestedRange(c: Context<AppEnv>, timeZone: string): { start: string; end: string; dates: string[] } | { error: string } {
  const requestedDate = c.req.query("date")?.trim();
  if (requestedDate !== undefined) {
    if (!isDateString(requestedDate)) return { error: "date must use YYYY-MM-DD" };
    return { start: requestedDate, end: requestedDate, dates: [requestedDate] };
  }

  const today = todayInTimeZone(timeZone);
  const defaultYear = Number(today.slice(0, 4));
  const defaultMonth = Number(today.slice(5, 7)) - 1;
  const yearRaw = c.req.query("year");
  const monthRaw = c.req.query("month");
  const year = yearRaw === undefined ? defaultYear : Number(yearRaw);
  const month = monthRaw === undefined ? defaultMonth : Number(monthRaw);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return { error: "year must be an integer between 2000 and 2100" };
  }
  if (!Number.isInteger(month) || month < 0 || month > 11) {
    return { error: "month must be a zero-based integer between 0 and 11" };
  }

  const start = `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-01`;
  const bounds = monthBounds(start);
  const dates = enumerateDates(bounds.start, bounds.end, 31);
  if (!dates) return { error: "Requested month is invalid" };
  return { start: bounds.start, end: bounds.end, dates };
}

residentMealRoutes.get("/meals/entries", async (c) => {
  const principal = await authenticatedPrincipal(c);
  if (!principal) return c.json({ success: false, error: "Authentication required" }, 401);

  const context = await readPrincipalContext(c, principal);
  if (!context) return c.json({ success: false, error: "User not found" }, 404);
  const range = requestedRange(c, context.timeZone);
  if ("error" in range) return c.json({ success: false, error: range.error }, 400);

  const [existing, holidays, lockedPeriods] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, institution_id, user_id, meal_id, service_date, status,
              original_state, editable_until, locked, notes, updated_by,
              created_at, updated_at
         FROM meal_entries
        WHERE institution_id = ? AND user_id = ?
          AND service_date BETWEEN ? AND ?
        ORDER BY service_date ASC, created_at ASC`,
    ).bind(principal.institutionId, principal.id, range.start, range.end).all<EntryRow>(),
    c.env.DB.prepare(
      `SELECT start_date, end_date
         FROM holidays
        WHERE institution_id = ? AND status = 'ACTIVE' AND meals_disabled = 1
          AND start_date <= ? AND end_date >= ?`,
    ).bind(principal.institutionId, range.end, range.start).all<HolidayRow>(),
    c.env.DB.prepare(
      `SELECT starts_on, ends_on
         FROM accounting_periods
        WHERE institution_id = ? AND status IN ('CLOSING', 'CLOSED')
          AND starts_on <= ? AND ends_on >= ?`,
    ).bind(principal.institutionId, range.end, range.start).all<LockedPeriodRow>(),
  ]);

  const existingKey = new Set(existing.results.map((entry) => `${entry.service_date}\u0000${entry.meal_id}`));
  const now = new Date();
  const inserts: D1PreparedStatement[] = [];

  for (const serviceDate of range.dates) {
    if (dateCovered(serviceDate, holidays.results) || dateCovered(serviceDate, lockedPeriods.results)) continue;
    for (const meal of context.meals) {
      if (existingKey.has(`${serviceDate}\u0000${meal.id}`)) continue;
      if (isBeforeEnrollment(serviceDate, context.user.created_at, meal, context.timeZone)) continue;

      const editableUntil = computeEditableUntilIso(meal, serviceDate, context.timeZone);
      inserts.push(
        c.env.DB.prepare(
          `INSERT OR IGNORE INTO meal_entries
            (id, institution_id, user_id, meal_id, service_date, status, original_state,
             editable_until, locked, notes, updated_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
        ).bind(
          crypto.randomUUID(),
          principal.institutionId,
          principal.id,
          meal.id,
          serviceDate,
          meal.default_state,
          meal.default_state,
          editableUntil,
          isLockedAt(editableUntil, now) ? 1 : 0,
          now.toISOString(),
          now.toISOString(),
        ),
      );
    }
  }

  if (inserts.length > 0) await c.env.DB.batch(inserts);

  const refreshed = inserts.length === 0
    ? existing
    : await c.env.DB.prepare(
      `SELECT id, institution_id, user_id, meal_id, service_date, status,
              original_state, editable_until, locked, notes, updated_by,
              created_at, updated_at
         FROM meal_entries
        WHERE institution_id = ? AND user_id = ?
          AND service_date BETWEEN ? AND ?
        ORDER BY service_date ASC, created_at ASC`,
    ).bind(principal.institutionId, principal.id, range.start, range.end).all<EntryRow>();

  const mealById = new Map(context.meals.map((meal) => [meal.id, meal]));
  const byDate: Record<string, ReturnType<typeof mappedEntry>[]> = {};
  for (const entry of refreshed.results) {
    const meal = mealById.get(entry.meal_id);
    if (!meal) continue;
    const preRegistration = isBeforeEnrollment(entry.service_date, context.user.created_at, meal, context.timeZone);
    // Old auto-generated pre-enrollment rows are not resident-visible. A genuine
    // administrator override remains visible because it differs from its baseline.
    if (preRegistration && entry.updated_by === null && !isOverridden(entry.status, entry.original_state)) continue;
    (byDate[entry.service_date] ??= []).push(mappedEntry(entry, meal, preRegistration, now));
  }

  return c.json({
    success: true,
    data: {
      meals: context.meals.map(mappedMeal),
      byDate,
      registrationDate: context.user.created_at,
    },
  });
});

residentMealRoutes.patch("/meals/toggle", async (c) => {
  const principal = await authenticatedPrincipal(c);
  if (!principal) return c.json({ success: false, error: "Authentication required" }, 401);

  let body: Record<string, unknown>;
  try {
    const value: unknown = await c.req.json();
    body = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const entryId = typeof body.entryId === "string" ? body.entryId.trim() : "";
  const status = body.status === "ON" || body.status === "OFF" ? body.status : null;
  if (!entryId || !status) {
    return c.json({ success: false, error: "entryId and status (ON or OFF) are required" }, 400);
  }

  const entry = await c.env.DB.prepare(
    `SELECT e.id, e.institution_id, e.user_id, e.meal_id, e.service_date, e.status,
            e.original_state, e.editable_until, e.locked, e.notes, e.updated_by,
            e.created_at, e.updated_at,
            m.name AS meal_name, m.display_name AS meal_display_name,
            m.icon AS meal_icon, m.color AS meal_color, m.meal_type AS meal_type,
            m.default_state AS meal_default_state,
            m.cutoff_strategy AS meal_cutoff_strategy,
            m.cutoff_offset_minutes AS meal_cutoff_offset_minutes,
            m.cutoff_time AS meal_cutoff_time,
            m.start_time AS meal_start_time, m.end_time AS meal_end_time
       FROM meal_entries e
       JOIN meal_configurations m ON m.id = e.meal_id AND m.institution_id = e.institution_id
      WHERE e.id = ? AND e.institution_id = ? AND e.user_id = ? AND m.status = 'ACTIVE'
      LIMIT 1`,
  ).bind(entryId, principal.institutionId, principal.id).first<ToggleEntryRow>();
  if (!entry) return c.json({ success: false, error: "Meal entry not found" }, 404);
  const meal = mealFromToggleRow(entry);

  const [user, institution] = await Promise.all([
    c.env.DB.prepare(`SELECT created_at FROM users WHERE id = ? AND institution_id = ? LIMIT 1`)
      .bind(principal.id, principal.institutionId).first<UserRow>(),
    c.env.DB.prepare(`SELECT timezone FROM institutions WHERE id = ? LIMIT 1`)
      .bind(principal.institutionId).first<InstitutionRow>(),
  ]);
  if (!user) return c.json({ success: false, error: "User not found" }, 404);
  const timeZone = institution?.timezone || "UTC";

  if (isBeforeEnrollment(entry.service_date, user.created_at, meal, timeZone)) {
    return c.json({ success: false, error: "Meals before enrollment cannot be changed by the resident" }, 422);
  }
  if (entry.locked === 1 || entry.status === "LOCKED" || isLockedAt(entry.editable_until)) {
    return c.json({ success: false, error: "Meal selection is locked after its cutoff" }, 422);
  }

  if (status === "ON") {
    const holiday = await c.env.DB.prepare(
      `SELECT id FROM holidays
        WHERE institution_id = ? AND status = 'ACTIVE' AND meals_disabled = 1
          AND ? BETWEEN start_date AND end_date
        LIMIT 1`,
    ).bind(principal.institutionId, entry.service_date).first<{ id: string }>();
    if (holiday) return c.json({ success: false, error: "Meal booking is disabled for this holiday" }, 409);
  }

  const now = new Date().toISOString();
  if (entry.status !== status || entry.original_state !== status) {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE meal_entries
            SET status = ?, original_state = ?, updated_by = ?, updated_at = ?
          WHERE id = ? AND institution_id = ? AND user_id = ?`,
      ).bind(status, status, principal.id, now, entry.id, principal.institutionId, principal.id),
      c.env.DB.prepare(
        `INSERT INTO audit_events
          (id, institution_id, actor_user_id, action, entity_type, entity_id,
           request_id, reason, metadata_json, created_at)
         VALUES (?, ?, ?, 'MEAL_SELECTION_CHANGED', 'MealEntry', ?, ?, NULL, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        principal.institutionId,
        principal.id,
        entry.id,
        c.get("requestId"),
        JSON.stringify({
          mealId: entry.meal_id,
          serviceDate: entry.service_date,
          before: { status: entry.status, originalState: entry.original_state },
          after: { status, originalState: status },
        }),
        now,
      ),
    ]);
  }

  const updated = await c.env.DB.prepare(
    `SELECT id, institution_id, user_id, meal_id, service_date, status,
            original_state, editable_until, locked, notes, updated_by,
            created_at, updated_at
       FROM meal_entries
      WHERE id = ? AND institution_id = ? AND user_id = ? LIMIT 1`,
  ).bind(entry.id, principal.institutionId, principal.id).first<EntryRow>();
  if (!updated) return c.json({ success: false, error: "Meal entry not found" }, 404);

  return c.json({
    success: true,
    data: mappedEntry(updated, meal, false, new Date()),
  });
});
