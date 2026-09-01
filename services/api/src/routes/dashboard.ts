import { Hono, type Context } from "hono";
import { authenticatedPrincipal, hasPermission, PERMISSIONS } from "../auth/authorization";
import {
  addDays,
  computeEditableUntilIso,
  isBeforeEnrollment,
  isLockedAt,
  isOverridden,
  monthBounds,
  todayInTimeZone,
  zonedDateTimeIso,
} from "../meals/engine";
import type { AppEnv } from "../types";

type MealRow = {
  id: string;
  name: string;
  display_name: string;
  icon: string;
  color: string;
  start_time: string;
  end_time: string;
  default_state: string;
  cutoff_strategy: string;
  cutoff_offset_minutes: number;
  cutoff_time: string;
  service_schedule: "DAILY" | "DATE_SPECIFIC";
  service_date: string | null;
};

type MealEntryRow = {
  user_id: string;
  meal_id: string;
  service_date: string;
  status: string;
  original_state: string;
  editable_until: string;
  locked: number;
};

type ResidentRow = {
  id: string;
  created_at: string;
};

type ActivityRow = {
  id: string;
  action: string;
  created_at: string;
  actor_name: string | null;
  actor_email: string | null;
};

type ExpenseRow = {
  category: string;
  amount_minor: number;
};

type GuestCountRow = {
  meal_name: string;
  guest_count: number;
};

type RateRow = {
  key: string;
  value_text: string;
};

export const dashboardRoutes = new Hono<AppEnv>();

async function institutionTimezone(c: Context<AppEnv>, institutionId: string): Promise<string> {
  const row = await c.env.DB.prepare("SELECT timezone FROM institutions WHERE id = ? LIMIT 1")
    .bind(institutionId)
    .first<{ timezone: string }>();
  return row?.timezone || "UTC";
}

function confirmedOn(entry: MealEntryRow, isPastDate: boolean, now: Date): boolean {
  if (entry.status !== "ON" && entry.status !== "LOCKED") return false;
  const locked =
    isPastDate ||
    entry.locked === 1 ||
    entry.status === "LOCKED" ||
    isLockedAt(entry.editable_until, now);
  return locked || isOverridden(entry.status, entry.original_state);
}

function confirmedOff(entry: MealEntryRow, isPastDate: boolean, now: Date): boolean {
  if (entry.status !== "OFF") return false;
  const locked = isPastDate || entry.locked === 1 || isLockedAt(entry.editable_until, now);
  return locked && !isOverridden(entry.status, entry.original_state);
}

function exactMajorToMinor(valueExact: string): number | null {
  const match = /^([+-])?(\d+)(?:\.(\d+))?$/u.exec(valueExact.trim());
  if (!match || !match[2]) return null;
  const negative = match[1] === "-";
  const whole = BigInt(match[2]);
  const fraction = (match[3] ?? "").padEnd(3, "0");
  const cents = BigInt(fraction.slice(0, 2) || "0");
  const roundDigit = Number(fraction.charAt(2) || "0");
  let minor = whole * 100n + cents;
  if (roundDigit >= 5) minor += 1n;
  if (negative) minor = -minor;
  if (minor > BigInt(Number.MAX_SAFE_INTEGER) || minor < BigInt(Number.MIN_SAFE_INTEGER)) return null;
  return Number(minor);
}

function minorToMajor(value: number): number {
  return Number(value || 0) / 100;
}

dashboardRoutes.get("/dashboard", async (c) => {
  const viewer = await authenticatedPrincipal(c);
  if (!viewer) return c.json({ success: false, error: "Authentication required" }, 401);

  const now = new Date();
  const timeZone = await institutionTimezone(c, viewer.institutionId);
  const today = todayInTimeZone(timeZone, now);
  const month = monthBounds(today);
  const trendStart = addDays(today, -6);
  const expenseStart = zonedDateTimeIso(month.start, "00:00", timeZone);
  const expenseEnd = zonedDateTimeIso(addDays(month.end, 1), "00:00", timeZone);
  const canReadAudit = hasPermission(viewer, PERMISSIONS.AUDIT_READ);

  const [
    summary,
    mealsResult,
    residentsResult,
    viewerEntriesResult,
    trendEntriesResult,
    monthEntriesResult,
    guestCountsResult,
    rateRowsResult,
    expenseRowsResult,
    pendingBillRow,
    unreadRow,
    disabledHoliday,
    lockedPeriod,
    activityRows,
  ] = await Promise.all([
    c.env.DB.prepare(
      `SELECT
         SUM(CASE WHEN status = 'ACTIVE' AND deleted_at IS NULL THEN 1 ELSE 0 END) AS active_count,
         SUM(CASE WHEN status = 'PENDING' AND deleted_at IS NULL THEN 1 ELSE 0 END) AS pending_count
       FROM users
       WHERE institution_id = ?`,
    ).bind(viewer.institutionId).first<{ active_count: number | null; pending_count: number | null }>(),
    c.env.DB.prepare(
      `SELECT id, name, display_name, icon, color, start_time, end_time, default_state,
              cutoff_strategy, cutoff_offset_minutes, cutoff_time, service_schedule, service_date
         FROM meal_configurations
        WHERE institution_id = ? AND status = 'ACTIVE'
        ORDER BY display_order ASC, created_at ASC`,
    ).bind(viewer.institutionId).all<MealRow>(),
    c.env.DB.prepare(
      `SELECT id, created_at
         FROM users
        WHERE institution_id = ? AND role = 'USER' AND status = 'ACTIVE' AND deleted_at IS NULL
        ORDER BY id ASC`,
    ).bind(viewer.institutionId).all<ResidentRow>(),
    c.env.DB.prepare(
      `SELECT user_id, meal_id, service_date, status, original_state, editable_until, locked
         FROM meal_entries
        WHERE institution_id = ? AND user_id = ? AND service_date = ?`,
    ).bind(viewer.institutionId, viewer.id, today).all<MealEntryRow>(),
    c.env.DB.prepare(
      `SELECT e.user_id, e.meal_id, e.service_date, e.status, e.original_state, e.editable_until, e.locked
         FROM meal_entries e
         JOIN users u ON u.id = e.user_id
        WHERE e.institution_id = ?
          AND e.service_date BETWEEN ? AND ?
          AND u.institution_id = e.institution_id
          AND u.role = 'USER'
          AND u.deleted_at IS NULL`,
    ).bind(viewer.institutionId, trendStart, today).all<MealEntryRow>(),
    c.env.DB.prepare(
      `SELECT e.user_id, e.meal_id, e.service_date, e.status, e.original_state, e.editable_until, e.locked
         FROM meal_entries e
         JOIN users u ON u.id = e.user_id
        WHERE e.institution_id = ?
          AND e.service_date BETWEEN ? AND ?
          AND u.institution_id = e.institution_id
          AND u.role = 'USER'
          AND u.deleted_at IS NULL`,
    ).bind(viewer.institutionId, month.start, month.end).all<MealEntryRow>(),
    c.env.DB.prepare(
      `SELECT m.name AS meal_name, COALESCE(SUM(g.guest_count), 0) AS guest_count
         FROM guest_meals g
         JOIN meal_configurations m
           ON m.id = g.meal_id AND m.institution_id = g.institution_id
        WHERE g.institution_id = ? AND g.service_date BETWEEN ? AND ?
        GROUP BY m.name`,
    ).bind(viewer.institutionId, month.start, month.end).all<GuestCountRow>(),
    c.env.DB.prepare(
      `SELECT key, value_text
         FROM variables
        WHERE institution_id = ? AND status = 'ACTIVE' AND key LIKE 'meal.rate.%'`,
    ).bind(viewer.institutionId).all<RateRow>(),
    c.env.DB.prepare(
      `SELECT category, amount_minor
         FROM expenses
        WHERE institution_id = ?
          AND status = 'APPROVED'
          AND purged_at IS NULL
          AND expense_date >= ? AND expense_date < ?
        ORDER BY category COLLATE NOCASE ASC, expense_date ASC, created_at ASC`,
    ).bind(viewer.institutionId, expenseStart, expenseEnd).all<ExpenseRow>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS pending_bills
         FROM bills b
         JOIN users u ON u.id = b.user_id
        WHERE b.institution_id = ?
          AND u.institution_id = b.institution_id
          AND u.role = 'USER'
          AND b.deleted_on IS NULL
          AND b.purged_at IS NULL
          AND b.status IN ('GENERATED', 'PARTIALLY_PAID', 'OVERDUE')
          AND b.due_amount_minor > 0`,
    ).bind(viewer.institutionId).first<{ pending_bills: number | null }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS unread_count
         FROM notifications
        WHERE institution_id = ? AND user_id = ? AND read_at IS NULL`,
    ).bind(viewer.institutionId, viewer.id).first<{ unread_count: number | null }>(),
    c.env.DB.prepare(
      `SELECT id
         FROM holidays
        WHERE institution_id = ? AND status = 'ACTIVE' AND meals_disabled = 1
          AND ? BETWEEN start_date AND end_date
        LIMIT 1`,
    ).bind(viewer.institutionId, today).first<{ id: string }>(),
    c.env.DB.prepare(
      `SELECT status
         FROM accounting_periods
        WHERE institution_id = ? AND starts_on <= ? AND ends_on >= ?
          AND status IN ('CLOSING', 'CLOSED')
        ORDER BY starts_on DESC
        LIMIT 1`,
    ).bind(viewer.institutionId, today, today).first<{ status: string }>(),
    canReadAudit
      ? c.env.DB.prepare(
          `SELECT a.id, a.action, a.created_at, u.name AS actor_name, u.email AS actor_email
             FROM audit_events a
             LEFT JOIN users u ON u.id = a.actor_user_id
            WHERE a.institution_id = ?
            ORDER BY a.created_at DESC
            LIMIT 6`,
        ).bind(viewer.institutionId).all<ActivityRow>()
      : Promise.resolve({ results: [] as ActivityRow[] }),
  ]);

  const viewerEntries = new Map(viewerEntriesResult.results.map((entry) => [entry.meal_id, entry]));
  const visibleTodayMeals = mealsResult.results
    .filter((meal) => meal.service_schedule !== "DATE_SPECIFIC" || meal.service_date === today);
  const todayMeals = visibleTodayMeals.map((meal) => {
    const entry = viewerEntries.get(meal.id);
    const editableUntil = entry?.editable_until ?? computeEditableUntilIso(meal, today, timeZone);
    const status = entry?.status ?? meal.default_state;
    return {
      id: meal.id,
      name: meal.name,
      displayName: meal.display_name,
      icon: meal.icon,
      color: meal.color,
      startTime: meal.start_time,
      endTime: meal.end_time,
      status,
      locked: entry?.locked === 1 || status === "LOCKED" || isLockedAt(editableUntil, now),
      editableUntil,
    };
  });

  const persistedTodayEntries = trendEntriesResult.results.filter((entry) => entry.service_date === today);
  const inferredTodayEntries: MealEntryRow[] = [];

  // `/meals/entries` lazily materializes default rows. Dashboard KPIs must not
  // depend on a resident visiting that screen first, and must stay identical to
  // the canonical Kitchen counts for the same date. Infer missing today's rows
  // in memory under the same enrollment/holiday/accounting-period guards.
  if (!disabledHoliday && !lockedPeriod) {
    const existingKeys = new Set(
      persistedTodayEntries.map((entry) => `${entry.user_id}\u0000${entry.meal_id}`),
    );
    for (const resident of residentsResult.results) {
      for (const meal of visibleTodayMeals) {
        const key = `${resident.id}\u0000${meal.id}`;
        if (existingKeys.has(key)) continue;
        if (isBeforeEnrollment(today, resident.created_at, meal, timeZone)) continue;

        const editableUntil = computeEditableUntilIso(meal, today, timeZone);
        inferredTodayEntries.push({
          user_id: resident.id,
          meal_id: meal.id,
          service_date: today,
          status: meal.default_state,
          original_state: meal.default_state,
          editable_until: editableUntil,
          locked: isLockedAt(editableUntil, now) ? 1 : 0,
        });
        existingKeys.add(key);
      }
    }
  }

  const effectiveTodayEntries = [...persistedTodayEntries, ...inferredTodayEntries];
  const todayOnCount = effectiveTodayEntries.filter((entry) => confirmedOn(entry, false, now)).length;
  const todayOffCount = effectiveTodayEntries.filter((entry) => confirmedOff(entry, false, now)).length;

  const effectiveMonthEntries = [...monthEntriesResult.results, ...inferredTodayEntries];
  const totalResidentMeals = effectiveMonthEntries.filter((entry) =>
    confirmedOn(entry, entry.service_date < today, now),
  ).length;

  const totalExpensesMinor = expenseRowsResult.results.reduce(
    (sum, expense) => sum + Number(expense.amount_minor || 0),
    0,
  );
  const byCategoryMinor = new Map<string, number>();
  for (const expense of expenseRowsResult.results) {
    byCategoryMinor.set(
      expense.category,
      (byCategoryMinor.get(expense.category) ?? 0) + Number(expense.amount_minor || 0),
    );
  }

  const rateByMealName = new Map(
    rateRowsResult.results.map((row) => [row.key.slice("meal.rate.".length), exactMajorToMinor(row.value_text) ?? 0]),
  );
  const guestRevenueMinor = guestCountsResult.results.reduce((sum, guest) => {
    const rateMinor = rateByMealName.get(guest.meal_name) ?? 0;
    return sum + rateMinor * Number(guest.guest_count || 0);
  }, 0);
  const currentMealCharge = totalResidentMeals > 0
    ? Math.max(0, totalExpensesMinor - guestRevenueMinor) / totalResidentMeals / 100
    : 0;

  const trendDates = Array.from({ length: 7 }, (_, index) => addDays(trendStart, index));
  const trend = trendDates.map((date) => {
    const entries = date === today
      ? effectiveTodayEntries
      : trendEntriesResult.results.filter((entry) => entry.service_date === date);
    const isPastDate = date < today;
    return {
      date,
      on: entries.filter((entry) => confirmedOn(entry, isPastDate, now)).length,
      off: entries.filter((entry) => confirmedOff(entry, isPastDate, now)).length,
    };
  });

  const isAdmin = hasPermission(viewer, PERMISSIONS.USERS_READ);

  return c.json({
    success: true,
    data: {
      todayMeals,
      kpis: {
        totalUsers: Number(summary?.active_count ?? 0),
        pendingUsers: Number(summary?.pending_count ?? 0),
        todayOnCount,
        todayOffCount,
        currentMealCharge,
        totalResidentMeals,
        totalExpenses: minorToMajor(totalExpensesMinor),
        pendingBills: Number(pendingBillRow?.pending_bills ?? 0),
      },
      trend,
      expenseBreakdown: [...byCategoryMinor.entries()].map(([category, amountMinor]) => ({
        category,
        amount: minorToMajor(amountMinor),
      })),
      unreadNotifications: Number(unreadRow?.unread_count ?? 0),
      recentActivity: activityRows.results.map((row) => ({
        id: row.id,
        action: row.action,
        createdAt: row.created_at,
        actor: row.actor_name
          ? { name: row.actor_name, email: row.actor_email ?? undefined }
          : null,
      })),
      permissions: viewer.permissions,
      isAdmin,
    },
  });
});