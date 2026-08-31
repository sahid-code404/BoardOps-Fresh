import { Hono, type Context } from "hono";
import { authenticatedPrincipal, type AuthPrincipal } from "../auth/authorization";
import type { AppEnv } from "../types";

export const reportRoutes = new Hono<AppEnv>();

type Period = {
  month: number;
  year: number;
  start: string;
  end: string;
  startDate: string;
  endDate: string;
};

type ExpenseCategoryRow = { category: string; amount_minor: number | null };
type MoneyCountRow = { amount_minor: number | null; count: number | null };
type PurchaseSummaryRow = { amount_minor: number | null; count: number | null; item_count: number | null };
type PurchaseProductRow = { name: string; unit: string; quantity_milli: number | null; spend_minor: number | null };
type PurchaseCategoryRow = { category: string; amount_minor: number | null };
type PurchaseVendorRow = { vendor: string; count: number | null; total_minor: number | null };
type BillRow = {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  room: string | null;
  period_month: number;
  period_year: number;
  meal_charges_minor: number;
  other_charges_minor: number;
  adjustments_minor: number;
  total_amount_minor: number;
  paid_amount_minor: number;
  due_amount_minor: number;
  status: string;
  due_date: string | null;
  snapshot_id: string | null;
  formula_version_id?: string | null;
};
type MealConfigRow = { id: string; name: string; display_name: string };
type MealEntryAggregateRow = { meal_id: string; on_count: number | null; off_count: number | null };
type MealGuestAggregateRow = { meal_id: string; guest_count: number | null };
type MealOverrideAggregateRow = { meal_id: string; overridden_count: number | null };
type ResidentRow = { id: string; name: string; email: string; room: string | null };
type ResidentPaymentRow = { user_id: string; approved_minor: number | null; pending_minor: number | null };
type ResidentBillRow = { user_id: string; total_minor: number | null; due_minor: number | null; previous_due_minor: number | null };
type ResidentRefundRow = { user_id: string; paid_minor: number | null; pending_minor: number | null };

async function principalFor(c: Context<AppEnv>): Promise<AuthPrincipal | Response> {
  const principal = await authenticatedPrincipal(c);
  return principal ?? c.json({ success: false, error: "Authentication required" }, 401);
}

function safeInt(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isSafeInteger(n) ? n : 0;
}

function minorToMajor(value: unknown): number {
  return safeInt(value) / 100;
}

function validPeriod(month: number, year: number): boolean {
  return Number.isInteger(month) && month >= 0 && month <= 11 && Number.isInteger(year) && year >= 2000 && year <= 9999;
}

function timezoneOffsetMinutes(timeZone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const part = (name: string) => Number(parts.find((item) => item.type === name)?.value ?? 0);
  const localAsUtc = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return Math.round((localAsUtc - instant.getTime()) / 60_000);
}

function localMidnightUtc(year: number, month: number, day: number, timeZone: string): string {
  const wallClockUtc = Date.UTC(year, month, day, 0, 0, 0, 0);
  let candidate = new Date(wallClockUtc);
  let offset = timezoneOffsetMinutes(timeZone, candidate);
  candidate = new Date(wallClockUtc - offset * 60_000);
  const corrected = timezoneOffsetMinutes(timeZone, candidate);
  if (corrected !== offset) candidate = new Date(wallClockUtc - corrected * 60_000);
  return candidate.toISOString();
}

function currentPeriodInTimeZone(timeZone: string, now = new Date()): { month: number; year: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? now.getUTCFullYear());
  const month = Number(parts.find((part) => part.type === "month")?.value ?? now.getUTCMonth() + 1) - 1;
  return { month, year };
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function institutionTimeZone(c: Context<AppEnv>, institutionId: string): Promise<string> {
  const row = await c.env.DB.prepare("SELECT timezone FROM institutions WHERE id = ? LIMIT 1")
    .bind(institutionId)
    .first<{ timezone: string }>();
  return row?.timezone || "UTC";
}

async function parsePeriod(c: Context<AppEnv>, institutionId: string): Promise<Period | Response> {
  const timeZone = await institutionTimeZone(c, institutionId);
  const rawMonth = c.req.query("month");
  const rawYear = c.req.query("year");
  if ((rawMonth === undefined) !== (rawYear === undefined)) {
    return c.json({ success: false, error: "month and year must be supplied together" }, 400);
  }

  const current = currentPeriodInTimeZone(timeZone);
  const month = rawMonth === undefined ? current.month : Number(rawMonth);
  const year = rawYear === undefined ? current.year : Number(rawYear);
  if (!validPeriod(month, year)) {
    return c.json({ success: false, error: "month/year must identify a valid calendar month" }, 400);
  }

  const nextMonth = month === 11 ? 0 : month + 1;
  const nextYear = month === 11 ? year + 1 : year;
  return {
    month,
    year,
    start: localMidnightUtc(year, month, 1, timeZone),
    end: localMidnightUtc(nextYear, nextMonth, 1, timeZone),
    startDate: dateKey(year, month, 1),
    endDate: dateKey(nextYear, nextMonth, 1),
  };
}

function previousPeriod(period: Period, timeZone: string): Period {
  const month = period.month === 0 ? 11 : period.month - 1;
  const year = period.month === 0 ? period.year - 1 : period.year;
  return {
    month,
    year,
    start: localMidnightUtc(year, month, 1, timeZone),
    end: period.start,
    startDate: dateKey(year, month, 1),
    endDate: period.startDate,
  };
}

async function buildFinancial(c: Context<AppEnv>, principal: AuthPrincipal, period: Period) {
  const timeZone = await institutionTimeZone(c, principal.institutionId);
  const prev = previousPeriod(period, timeZone);

  const [expenseCategories, purchases, deposit, prevExpense, prevDeposit, bills, refunds] = await Promise.all([
    c.env.DB.prepare(
      `SELECT category, COALESCE(SUM(amount_minor), 0) AS amount_minor
         FROM expenses
        WHERE institution_id = ? AND status = 'APPROVED' AND purged_at IS NULL
          AND expense_date >= ? AND expense_date < ?
        GROUP BY category
        ORDER BY amount_minor DESC, category ASC`,
    ).bind(principal.institutionId, period.start, period.end).all<ExpenseCategoryRow>(),
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(p.total_amount_minor), 0) AS amount_minor,
              COUNT(*) AS count,
              COALESCE(SUM(p.item_count), 0) AS item_count
         FROM purchases p
         JOIN expenses e ON e.id = p.expense_id AND e.institution_id = p.institution_id
        WHERE p.institution_id = ?
          AND p.purchase_date >= ? AND p.purchase_date < ?
          AND e.status = 'APPROVED' AND e.purged_at IS NULL`,
    ).bind(principal.institutionId, period.startDate, period.endDate).first<PurchaseSummaryRow>(),
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(p.amount_minor), 0) AS amount_minor, COUNT(*) AS count
         FROM payments p
         JOIN users u ON u.id = p.user_id AND u.institution_id = p.institution_id
        WHERE p.institution_id = ? AND u.role = 'USER'
          AND p.status = 'APPROVED' AND p.deleted_on IS NULL AND p.purged_at IS NULL
          AND p.created_at >= ? AND p.created_at < ?`,
    ).bind(principal.institutionId, period.start, period.end).first<MoneyCountRow>(),
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(amount_minor), 0) AS amount_minor, COUNT(*) AS count
         FROM expenses
        WHERE institution_id = ? AND status = 'APPROVED' AND purged_at IS NULL
          AND expense_date >= ? AND expense_date < ?`,
    ).bind(principal.institutionId, prev.start, prev.end).first<MoneyCountRow>(),
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(p.amount_minor), 0) AS amount_minor, COUNT(*) AS count
         FROM payments p
         JOIN users u ON u.id = p.user_id AND u.institution_id = p.institution_id
        WHERE p.institution_id = ? AND u.role = 'USER'
          AND p.status = 'APPROVED' AND p.deleted_on IS NULL AND p.purged_at IS NULL
          AND p.created_at >= ? AND p.created_at < ?`,
    ).bind(principal.institutionId, prev.start, prev.end).first<MoneyCountRow>(),
    c.env.DB.prepare(
      `SELECT b.id, b.user_id, u.name AS user_name, u.email AS user_email, u.room,
              b.period_month, b.period_year, b.meal_charges_minor, b.other_charges_minor,
              b.adjustments_minor, b.total_amount_minor, b.paid_amount_minor,
              b.due_amount_minor, b.status, b.due_date, b.snapshot_id
         FROM bills b
         JOIN users u ON u.id = b.user_id AND u.institution_id = b.institution_id
        WHERE b.institution_id = ? AND u.role = 'USER'
          AND b.period_month = ? AND b.period_year = ?
          AND b.deleted_on IS NULL AND b.purged_at IS NULL
        ORDER BY b.id`,
    ).bind(principal.institutionId, period.month, period.year).all<BillRow>(),
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(amount_minor), 0) AS amount_minor,
              COALESCE(SUM(paid_amount_minor), 0) AS paid_minor,
              COUNT(*) AS count
         FROM refunds
        WHERE institution_id = ? AND created_at >= ? AND created_at < ?`,
    ).bind(principal.institutionId, period.start, period.end).first<{ amount_minor: number | null; paid_minor: number | null; count: number | null }>(),
  ]);

  const totalExpensesMinor = expenseCategories.results.reduce((sum, row) => sum + safeInt(row.amount_minor), 0);
  const totalDepositsMinor = safeInt(deposit?.amount_minor);
  const totalBillsMinor = bills.results.reduce((sum, row) => sum + safeInt(row.total_amount_minor), 0);
  const totalCollectedMinor = bills.results.reduce((sum, row) => sum + safeInt(row.paid_amount_minor), 0);
  const outstandingMinor = bills.results.reduce((sum, row) => sum + safeInt(row.due_amount_minor), 0);
  const breakdown: Record<string, number> = { GENERATED: 0, PARTIALLY_PAID: 0, PAID: 0, OVERDUE: 0, VOID: 0 };
  for (const bill of bills.results) {
    if (bill.status in breakdown) breakdown[bill.status] = (breakdown[bill.status] ?? 0) + 1;
  }

  return {
    period: { month: period.month, year: period.year },
    summary: {
      totalExpenses: minorToMajor(totalExpensesMinor),
      // Purchases are also canonical Expense rows. Expose their subset for
      // procurement transparency without subtracting them a second time below.
      totalPurchases: minorToMajor(purchases?.amount_minor),
      purchaseCount: safeInt(purchases?.count),
      totalDeposits: minorToMajor(totalDepositsMinor),
      depositCount: safeInt(deposit?.count),
      totalBills: minorToMajor(totalBillsMinor),
      totalCollected: minorToMajor(totalCollectedMinor),
      outstandingDue: minorToMajor(outstandingMinor),
      refundTotal: minorToMajor(refunds?.amount_minor),
      refundPaid: minorToMajor(refunds?.paid_minor),
      refundCount: safeInt(refunds?.count),
      netPosition: minorToMajor(totalDepositsMinor - totalExpensesMinor),
    },
    expenseByCategory: expenseCategories.results.map((row) => ({
      category: row.category,
      amount: minorToMajor(row.amount_minor),
    })),
    billStatusBreakdown: breakdown,
    comparison: {
      prevExpenses: minorToMajor(prevExpense?.amount_minor),
      prevDeposits: minorToMajor(prevDeposit?.amount_minor),
      expenseChange: minorToMajor(totalExpensesMinor - safeInt(prevExpense?.amount_minor)),
      depositChange: minorToMajor(totalDepositsMinor - safeInt(prevDeposit?.amount_minor)),
    },
  };
}

async function buildMeals(c: Context<AppEnv>, principal: AuthPrincipal, period: Period) {
  const [configs, entries, guests, overrides, overrideTotal] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, name, display_name
         FROM meal_configurations
        WHERE institution_id = ? AND status = 'ACTIVE'
        ORDER BY display_order ASC, id ASC`,
    ).bind(principal.institutionId).all<MealConfigRow>(),
    c.env.DB.prepare(
      `SELECT me.meal_id,
              SUM(CASE WHEN me.status = 'ON' OR (me.status = 'LOCKED' AND me.original_state = 'ON') THEN 1 ELSE 0 END) AS on_count,
              SUM(CASE WHEN me.status = 'OFF' OR (me.status = 'LOCKED' AND me.original_state = 'OFF') THEN 1 ELSE 0 END) AS off_count
         FROM meal_entries me
         JOIN users u ON u.id = me.user_id AND u.institution_id = me.institution_id
        WHERE me.institution_id = ? AND u.role = 'USER'
          AND me.service_date >= ? AND me.service_date < ?
        GROUP BY me.meal_id`,
    ).bind(principal.institutionId, period.startDate, period.endDate).all<MealEntryAggregateRow>(),
    c.env.DB.prepare(
      `SELECT meal_id, COALESCE(SUM(guest_count), 0) AS guest_count
         FROM guest_meals
        WHERE institution_id = ? AND service_date >= ? AND service_date < ?
        GROUP BY meal_id`,
    ).bind(principal.institutionId, period.startDate, period.endDate).all<MealGuestAggregateRow>(),
    c.env.DB.prepare(
      `SELECT meal_id, COUNT(DISTINCT meal_entry_id) AS overridden_count
         FROM meal_overrides
        WHERE institution_id = ? AND service_date >= ? AND service_date < ?
        GROUP BY meal_id`,
    ).bind(principal.institutionId, period.startDate, period.endDate).all<MealOverrideAggregateRow>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS count
         FROM meal_overrides
        WHERE institution_id = ? AND service_date >= ? AND service_date < ?`,
    ).bind(principal.institutionId, period.startDate, period.endDate).first<{ count: number | null }>(),
  ]);

  const entryByMeal = new Map(entries.results.map((row) => [row.meal_id, row]));
  const guestByMeal = new Map(guests.results.map((row) => [row.meal_id, safeInt(row.guest_count)]));
  const overrideByMeal = new Map(overrides.results.map((row) => [row.meal_id, safeInt(row.overridden_count)]));
  const perMeal = configs.results.map((meal) => {
    const entry = entryByMeal.get(meal.id);
    const on = safeInt(entry?.on_count);
    const off = safeInt(entry?.off_count);
    const guestsCount = guestByMeal.get(meal.id) ?? 0;
    const overridden = overrideByMeal.get(meal.id) ?? 0;
    const denominator = on + off;
    return {
      mealId: meal.id,
      mealName: meal.name,
      displayName: meal.display_name,
      on,
      off,
      overridden,
      guests: guestsCount,
      total: on + guestsCount,
      participation: denominator > 0 ? Math.round((on / denominator) * 100) : 0,
    };
  });

  return {
    period: { month: period.month, year: period.year },
    summary: {
      totalMeals: perMeal.reduce((sum, meal) => sum + meal.on, 0),
      totalGuests: perMeal.reduce((sum, meal) => sum + meal.guests, 0),
      totalOverrides: safeInt(overrideTotal?.count),
      holidayCount: 0,
      activeMealCount: configs.results.length,
    },
    perMeal,
  };
}

async function buildPurchases(c: Context<AppEnv>, principal: AuthPrincipal, period: Period) {
  const [summary, topProducts, topCategories, vendorBreakdown] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(p.total_amount_minor), 0) AS amount_minor,
              COUNT(*) AS count,
              COALESCE(SUM(p.item_count), 0) AS item_count
         FROM purchases p
         JOIN expenses e ON e.id = p.expense_id AND e.institution_id = p.institution_id
        WHERE p.institution_id = ?
          AND p.purchase_date >= ? AND p.purchase_date < ?
          AND e.status = 'APPROVED' AND e.purged_at IS NULL`,
    ).bind(principal.institutionId, period.startDate, period.endDate).first<PurchaseSummaryRow>(),
    c.env.DB.prepare(
      `SELECT pi.product_name AS name, pi.unit,
              COALESCE(SUM(pi.quantity_milli), 0) AS quantity_milli,
              COALESCE(SUM(pi.total_minor), 0) AS spend_minor
         FROM purchase_items pi
         JOIN purchases p ON p.id = pi.purchase_id AND p.institution_id = pi.institution_id
         JOIN expenses e ON e.id = p.expense_id AND e.institution_id = p.institution_id
        WHERE p.institution_id = ?
          AND p.purchase_date >= ? AND p.purchase_date < ?
          AND e.status = 'APPROVED' AND e.purged_at IS NULL
        GROUP BY pi.product_name, pi.unit
        ORDER BY spend_minor DESC, pi.product_name ASC, pi.unit ASC
        LIMIT 10`,
    ).bind(principal.institutionId, period.startDate, period.endDate).all<PurchaseProductRow>(),
    c.env.DB.prepare(
      `SELECT pi.category, COALESCE(SUM(pi.total_minor), 0) AS amount_minor
         FROM purchase_items pi
         JOIN purchases p ON p.id = pi.purchase_id AND p.institution_id = pi.institution_id
         JOIN expenses e ON e.id = p.expense_id AND e.institution_id = p.institution_id
        WHERE p.institution_id = ?
          AND p.purchase_date >= ? AND p.purchase_date < ?
          AND e.status = 'APPROVED' AND e.purged_at IS NULL
        GROUP BY pi.category
        ORDER BY amount_minor DESC, pi.category ASC`,
    ).bind(principal.institutionId, period.startDate, period.endDate).all<PurchaseCategoryRow>(),
    c.env.DB.prepare(
      `SELECT p.vendor, COUNT(*) AS count,
              COALESCE(SUM(p.total_amount_minor), 0) AS total_minor
         FROM purchases p
         JOIN expenses e ON e.id = p.expense_id AND e.institution_id = p.institution_id
        WHERE p.institution_id = ?
          AND p.purchase_date >= ? AND p.purchase_date < ?
          AND e.status = 'APPROVED' AND e.purged_at IS NULL
        GROUP BY p.vendor
        ORDER BY total_minor DESC, p.vendor ASC`,
    ).bind(principal.institutionId, period.startDate, period.endDate).all<PurchaseVendorRow>(),
  ]);

  const totalSpendMinor = safeInt(summary?.amount_minor);
  const purchaseCount = safeInt(summary?.count);
  return {
    period: { month: period.month, year: period.year },
    summary: {
      totalSpend: minorToMajor(totalSpendMinor),
      purchaseCount,
      itemCount: safeInt(summary?.item_count),
      avgPurchaseValue: purchaseCount > 0 ? minorToMajor(Math.round(totalSpendMinor / purchaseCount)) : 0,
    },
    topProducts: topProducts.results.map((row) => ({
      name: row.name,
      quantity: safeInt(row.quantity_milli) / 1000,
      spend: minorToMajor(row.spend_minor),
      unit: row.unit,
    })),
    topCategories: topCategories.results.map((row) => ({
      category: row.category,
      amount: minorToMajor(row.amount_minor),
    })),
    vendorBreakdown: vendorBreakdown.results.map((row) => ({
      vendor: row.vendor,
      count: safeInt(row.count),
      total: minorToMajor(row.total_minor),
    })),
  };
}

async function loadOutstandingBills(c: Context<AppEnv>, principal: AuthPrincipal, period: Period): Promise<BillRow[]> {
  const result = await c.env.DB.prepare(
    `SELECT b.id, b.user_id, u.name AS user_name, u.email AS user_email, u.room,
            b.period_month, b.period_year, b.meal_charges_minor, b.other_charges_minor,
            b.adjustments_minor, b.total_amount_minor, b.paid_amount_minor,
            b.due_amount_minor, b.status, b.due_date, b.snapshot_id
       FROM bills b
       JOIN users u ON u.id = b.user_id AND u.institution_id = b.institution_id
      WHERE b.institution_id = ? AND u.role = 'USER'
        AND b.deleted_on IS NULL AND b.purged_at IS NULL
        AND b.status NOT IN ('VOID','DELETED') AND b.due_amount_minor > 0
        AND (b.period_year < ? OR (b.period_year = ? AND b.period_month <= ?))
      ORDER BY b.due_amount_minor DESC, b.period_year ASC, b.period_month ASC, b.id ASC`,
  ).bind(principal.institutionId, period.year, period.year, period.month).all<BillRow>();
  return result.results;
}

function outstandingData(rows: BillRow[], period: Period) {
  const selectedKey = period.year * 12 + period.month;
  const now = Date.now();
  let totalCurrentMinor = 0;
  let totalPreviousMinor = 0;
  let daysTotal = 0;
  const residentIds = new Set<string>();

  const mapped = rows.map((bill) => {
    const billKey = bill.period_year * 12 + bill.period_month;
    const dueMinor = safeInt(bill.due_amount_minor);
    if (billKey === selectedKey) totalCurrentMinor += dueMinor;
    else totalPreviousMinor += dueMinor;
    residentIds.add(bill.user_id);
    const dueMs = bill.due_date ? new Date(bill.due_date).getTime() : Number.NaN;
    const daysOutstanding = Number.isFinite(dueMs) ? Math.max(0, Math.floor((now - dueMs) / 86_400_000)) : 0;
    daysTotal += daysOutstanding;
    return {
      userId: bill.user_id,
      userName: bill.user_name,
      userEmail: bill.user_email,
      room: bill.room,
      billNumber: bill.id,
      period: `${bill.period_month + 1}/${bill.period_year}`,
      currentBill: minorToMajor(bill.total_amount_minor),
      paidAmount: minorToMajor(bill.paid_amount_minor),
      dueAmount: minorToMajor(dueMinor),
      previousDue: 0,
      totalOutstanding: minorToMajor(dueMinor),
      daysOutstanding,
      status: bill.status,
      dueDate: bill.due_date,
    };
  });

  return {
    period: { month: period.month, year: period.year },
    summary: {
      totalOutstanding: minorToMajor(totalCurrentMinor + totalPreviousMinor),
      totalCurrentDue: minorToMajor(totalCurrentMinor),
      totalPreviousDue: minorToMajor(totalPreviousMinor),
      residentCount: residentIds.size,
      billCount: rows.length,
      avgDaysOutstanding: rows.length > 0 ? Math.round(daysTotal / rows.length) : 0,
    },
    rows: mapped,
  };
}

async function buildOutstanding(c: Context<AppEnv>, principal: AuthPrincipal, period: Period) {
  return outstandingData(await loadOutstandingBills(c, principal, period), period);
}

async function buildResidents(c: Context<AppEnv>, principal: AuthPrincipal) {
  const timeZone = await institutionTimeZone(c, principal.institutionId);
  const current = currentPeriodInTimeZone(timeZone);
  const currentKey = current.year * 12 + current.month;
  const [residents, payments, bills, refunds] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, name, email, room
         FROM users
        WHERE institution_id = ? AND role = 'USER' AND status = 'ACTIVE' AND deleted_at IS NULL
        ORDER BY name ASC, id ASC`,
    ).bind(principal.institutionId).all<ResidentRow>(),
    c.env.DB.prepare(
      `SELECT user_id,
              COALESCE(SUM(CASE WHEN status = 'APPROVED' AND deleted_on IS NULL AND purged_at IS NULL THEN amount_minor ELSE 0 END), 0) AS approved_minor,
              COALESCE(SUM(CASE WHEN status = 'PENDING' AND deleted_on IS NULL AND purged_at IS NULL THEN amount_minor ELSE 0 END), 0) AS pending_minor
         FROM payments
        WHERE institution_id = ?
        GROUP BY user_id`,
    ).bind(principal.institutionId).all<ResidentPaymentRow>(),
    c.env.DB.prepare(
      `SELECT user_id,
              COALESCE(SUM(CASE WHEN status NOT IN ('VOID','DELETED') AND deleted_on IS NULL AND purged_at IS NULL THEN total_amount_minor ELSE 0 END), 0) AS total_minor,
              COALESCE(SUM(CASE WHEN status NOT IN ('VOID','DELETED') AND deleted_on IS NULL AND purged_at IS NULL THEN due_amount_minor ELSE 0 END), 0) AS due_minor,
              COALESCE(SUM(CASE WHEN status NOT IN ('VOID','DELETED') AND deleted_on IS NULL AND purged_at IS NULL
                                  AND (period_year * 12 + period_month) < ? THEN due_amount_minor ELSE 0 END), 0) AS previous_due_minor
         FROM bills
        WHERE institution_id = ?
        GROUP BY user_id`,
    ).bind(currentKey, principal.institutionId).all<ResidentBillRow>(),
    c.env.DB.prepare(
      `SELECT user_id,
              COALESCE(SUM(paid_amount_minor), 0) AS paid_minor,
              COALESCE(SUM(CASE WHEN status IN ('PENDING','PARTIALLY_PAID') THEN remaining_amount_minor ELSE 0 END), 0) AS pending_minor
         FROM refunds
        WHERE institution_id = ?
        GROUP BY user_id`,
    ).bind(principal.institutionId).all<ResidentRefundRow>(),
  ]);

  const paymentByUser = new Map(payments.results.map((row) => [row.user_id, row]));
  const billByUser = new Map(bills.results.map((row) => [row.user_id, row]));
  const refundByUser = new Map(refunds.results.map((row) => [row.user_id, row]));

  const rows = residents.results.map((resident) => {
    const payment = paymentByUser.get(resident.id);
    const bill = billByUser.get(resident.id);
    const refund = refundByUser.get(resident.id);
    const totalDepositedMinor = safeInt(payment?.approved_minor);
    const totalBilledMinor = safeInt(bill?.total_minor);
    const totalRefundedMinor = safeInt(refund?.paid_minor);
    const outstandingDueMinor = safeInt(bill?.due_minor);
    const availableMinor = Math.max(0, totalDepositedMinor - totalBilledMinor - totalRefundedMinor);
    const financialStatus = outstandingDueMinor > 0 && availableMinor <= 0 ? "OVERDUE" : "HEALTHY";
    return {
      userId: resident.id,
      userName: resident.name,
      userEmail: resident.email,
      room: resident.room,
      availableBalance: minorToMajor(availableMinor),
      pendingDeposits: minorToMajor(payment?.pending_minor),
      refundPending: minorToMajor(refund?.pending_minor),
      outstandingDue: minorToMajor(outstandingDueMinor),
      previousDue: minorToMajor(bill?.previous_due_minor),
      totalDeposited: minorToMajor(totalDepositedMinor),
      totalBilled: minorToMajor(totalBilledMinor),
      totalRefunded: minorToMajor(totalRefundedMinor),
      financialStatus,
    };
  });

  return {
    summary: {
      residentCount: rows.length,
      totalBalance: rows.reduce((sum, row) => sum + row.availableBalance, 0),
      totalDue: rows.reduce((sum, row) => sum + row.outstandingDue, 0),
      totalDeposited: rows.reduce((sum, row) => sum + row.totalDeposited, 0),
      totalBilled: rows.reduce((sum, row) => sum + row.totalBilled, 0),
      healthyCount: rows.filter((row) => row.financialStatus === "HEALTHY").length,
      lowBalanceCount: 0,
      overdueCount: rows.filter((row) => row.financialStatus === "OVERDUE").length,
      restrictedCount: 0,
      exemptedCount: 0,
    },
    rows,
  };
}

function escapeCsv(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (text.includes(",") || text.includes("\"") || text.includes("\n") || text.includes("\r")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  return [headers.map(escapeCsv).join(","), ...rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(","))].join("\n");
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

function csvResponse(headers: string[], rows: Record<string, unknown>[], filename: string): Response {
  return new Response(toCsv(headers, rows), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}

reportRoutes.get("/reports/financial", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;
  const period = await parsePeriod(c, auth.institutionId);
  if (period instanceof Response) return period;
  return c.json({ success: true, data: await buildFinancial(c, auth, period) });
});

reportRoutes.get("/reports/meals", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;
  const period = await parsePeriod(c, auth.institutionId);
  if (period instanceof Response) return period;
  return c.json({ success: true, data: await buildMeals(c, auth, period) });
});

reportRoutes.get("/reports/purchases", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;
  const period = await parsePeriod(c, auth.institutionId);
  if (period instanceof Response) return period;
  return c.json({ success: true, data: await buildPurchases(c, auth, period) });
});

reportRoutes.get("/reports/outstanding", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;
  const period = await parsePeriod(c, auth.institutionId);
  if (period instanceof Response) return period;
  return c.json({ success: true, data: await buildOutstanding(c, auth, period) });
});

reportRoutes.get("/reports/residents", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;
  return c.json({ success: true, data: await buildResidents(c, auth) });
});

reportRoutes.get("/reports/export", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;
  const period = await parsePeriod(c, auth.institutionId);
  if (period instanceof Response) return period;
  const type = c.req.query("type") || "bills";
  const monthName = MONTH_NAMES[period.month] ?? `Month-${period.month + 1}`;

  if (type === "purchases") {
    const result = await c.env.DB.prepare(
      `SELECT p.purchase_date, p.vendor, pi.product_name, pi.category,
              pi.quantity_milli, pi.unit, pi.rate_minor, pi.total_minor,
              u.name AS created_by_name
         FROM purchases p
         JOIN expenses e ON e.id = p.expense_id AND e.institution_id = p.institution_id
         JOIN purchase_items pi ON pi.purchase_id = p.id AND pi.institution_id = p.institution_id
         LEFT JOIN users u ON u.id = p.created_by
        WHERE p.institution_id = ?
          AND p.purchase_date >= ? AND p.purchase_date < ?
          AND e.status = 'APPROVED' AND e.purged_at IS NULL
        ORDER BY p.purchase_date DESC, p.id ASC, pi.id ASC`,
    ).bind(auth.institutionId, period.startDate, period.endDate).all<{
      purchase_date: string; vendor: string; product_name: string; category: string;
      quantity_milli: number; unit: string; rate_minor: number; total_minor: number;
      created_by_name: string | null;
    }>();
    const headers = ["Date", "Vendor", "Item", "Category", "Quantity", "Unit", "Rate", "Total", "CreatedBy"];
    const rows = result.results.map((row) => ({
      Date: row.purchase_date,
      Vendor: row.vendor,
      Item: row.product_name,
      Category: row.category,
      Quantity: row.quantity_milli / 1000,
      Unit: row.unit,
      Rate: minorToMajor(row.rate_minor),
      Total: minorToMajor(row.total_minor),
      CreatedBy: row.created_by_name ?? "",
    }));
    return csvResponse(headers, rows, `purchases-${monthName}-${period.year}.csv`);
  }

  if (type === "expenses") {
    const result = await c.env.DB.prepare(
      `SELECT e.expense_date, e.title, e.category, e.amount_minor, e.quantity, e.unit,
              e.paid_to, e.status, u.name AS created_by_name
         FROM expenses e
         LEFT JOIN users u ON u.id = e.created_by
        WHERE e.institution_id = ? AND e.status = 'APPROVED' AND e.purged_at IS NULL
          AND e.expense_date >= ? AND e.expense_date < ?
        ORDER BY e.expense_date DESC, e.id ASC`,
    ).bind(auth.institutionId, period.start, period.end).all<{
      expense_date: string; title: string; category: string; amount_minor: number;
      quantity: number; unit: string; paid_to: string | null; status: string; created_by_name: string | null;
    }>();
    const headers = ["Date", "Title", "Category", "Amount", "Quantity", "Unit", "PaidTo", "Status", "CreatedBy"];
    const rows = result.results.map((row) => ({
      Date: row.expense_date.slice(0, 10), Title: row.title, Category: row.category,
      Amount: minorToMajor(row.amount_minor), Quantity: row.quantity, Unit: row.unit,
      PaidTo: row.paid_to ?? "", Status: row.status, CreatedBy: row.created_by_name ?? "",
    }));
    return csvResponse(headers, rows, `expenses-${monthName}-${period.year}.csv`);
  }

  if (type === "outstanding") {
    const report = await buildOutstanding(c, auth, period);
    const headers = ["Resident", "Email", "Room", "BillNumber", "Period", "TotalAmount", "PaidAmount", "DueAmount", "PreviousDue", "TotalOutstanding", "Status", "DueDate"];
    const rows = report.rows.map((row) => ({
      Resident: row.userName, Email: row.userEmail, Room: row.room ?? "", BillNumber: row.billNumber,
      Period: row.period, TotalAmount: row.currentBill, PaidAmount: row.paidAmount, DueAmount: row.dueAmount,
      PreviousDue: row.previousDue, TotalOutstanding: row.totalOutstanding, Status: row.status,
      DueDate: row.dueDate ? row.dueDate.slice(0, 10) : "",
    }));
    return csvResponse(headers, rows, `outstanding-${monthName}-${period.year}.csv`);
  }

  if (type === "residents") {
    const report = await buildResidents(c, auth);
    const headers = ["Resident", "Email", "Room", "AvailableBalance", "PendingDeposits", "RefundPending", "OutstandingDue", "PreviousDue", "TotalDeposited", "TotalBilled", "TotalRefunded", "FinancialStatus"];
    const rows = report.rows.map((row) => ({
      Resident: row.userName, Email: row.userEmail, Room: row.room ?? "",
      AvailableBalance: row.availableBalance, PendingDeposits: row.pendingDeposits,
      RefundPending: row.refundPending, OutstandingDue: row.outstandingDue,
      PreviousDue: row.previousDue, TotalDeposited: row.totalDeposited,
      TotalBilled: row.totalBilled, TotalRefunded: row.totalRefunded,
      FinancialStatus: row.financialStatus,
    }));
    return csvResponse(headers, rows, `residents-${monthName}-${period.year}.csv`);
  }

  if (type === "bills") {
    const result = await c.env.DB.prepare(
      `SELECT b.id, b.user_id, u.name AS user_name, u.email AS user_email, u.room,
              b.period_month, b.period_year, b.meal_charges_minor, b.other_charges_minor,
              b.adjustments_minor, b.total_amount_minor, b.paid_amount_minor, b.due_amount_minor,
              b.status, b.due_date, b.snapshot_id,
              json_extract(s.snapshot_json, '$.formulas.totalBill.versionId') AS formula_version_id
         FROM bills b
         JOIN users u ON u.id = b.user_id AND u.institution_id = b.institution_id
         LEFT JOIN billing_snapshots s ON s.id = b.snapshot_id
        WHERE b.institution_id = ? AND u.role = 'USER'
          AND b.period_month = ? AND b.period_year = ?
          AND b.deleted_on IS NULL AND b.purged_at IS NULL
        ORDER BY b.created_at DESC, b.id ASC`,
    ).bind(auth.institutionId, period.month, period.year).all<BillRow>();
    const headers = ["BillNumber", "Resident", "Email", "Room", "Period", "MealCharges", "OtherCharges", "TotalAmount", "PaidAmount", "DueAmount", "PreviousDue", "Status", "DueDate", "FormulaVersion"];
    const rows = result.results.map((bill) => ({
      BillNumber: bill.id, Resident: bill.user_name, Email: bill.user_email, Room: bill.room ?? "",
      Period: `${bill.period_month + 1}/${bill.period_year}`, MealCharges: minorToMajor(bill.meal_charges_minor),
      OtherCharges: minorToMajor(safeInt(bill.other_charges_minor) + safeInt(bill.adjustments_minor)),
      TotalAmount: minorToMajor(bill.total_amount_minor), PaidAmount: minorToMajor(bill.paid_amount_minor),
      DueAmount: minorToMajor(bill.due_amount_minor), PreviousDue: 0, Status: bill.status,
      DueDate: bill.due_date ? bill.due_date.slice(0, 10) : "", FormulaVersion: bill.formula_version_id ?? "",
    }));
    return csvResponse(headers, rows, `bills-${monthName}-${period.year}.csv`);
  }

  return c.json({
    success: false,
    error: `Unknown export type: ${type}. Supported: expenses, purchases, outstanding, residents, bills`,
  }, 400);
});