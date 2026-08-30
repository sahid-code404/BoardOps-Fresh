import { Hono, type Context } from "hono";
import { authenticatedPrincipal, type AuthPrincipal } from "../auth/authorization";
import type { AppEnv } from "../types";

type InstitutionRow = {
  timezone: string;
};

type ResidentRow = {
  id: string;
  name: string;
  email: string;
  room: string | null;
  avatar_url: string | null;
  created_at: string;
};

type PaymentAggregateRow = {
  user_id: string;
  approved_minor: number | null;
  refunded_minor: number | null;
};

type BillAggregateRow = {
  user_id: string;
  bill_total_minor: number | null;
  bill_due_minor: number | null;
  bill_count: number | null;
};

type ExpenseAggregateRow = {
  total_expenses_minor: number | null;
};

type ResidentWeight = ResidentRow & {
  daysEnrolled: number;
};

export const fundRoutes = new Hono<AppEnv>();

async function principalFor(c: Context<AppEnv>): Promise<AuthPrincipal | Response> {
  const principal = await authenticatedPrincipal(c);
  return principal ?? c.json({ success: false, error: "Authentication required" }, 401);
}

function minorToMajor(value: number): number {
  return Number(value || 0) / 100;
}

function isValidPeriod(month: number, year: number): boolean {
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

function currentPeriodInTimeZone(timeZone: string, now: Date): { month: number; year: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? now.getUTCFullYear());
  const month = Number(parts.find((part) => part.type === "month")?.value ?? now.getUTCMonth() + 1) - 1;
  return { month, year };
}

function safeMinor(value: number | null | undefined): number {
  const numeric = Number(value ?? 0);
  return Number.isSafeInteger(numeric) ? numeric : 0;
}

/**
 * Allocate an integer-minor-unit total across weighted residents without ever
 * creating fractional paise. Floor each proportional share first, then assign
 * the remaining paise by largest remainder (stable user-id tie break). The
 * resulting shares always sum exactly to totalMinor.
 */
function allocateMinorByWeight(totalMinor: number, residents: ResidentWeight[]): Map<string, number> {
  const shares = new Map<string, number>();
  if (residents.length === 0 || totalMinor <= 0) {
    for (const resident of residents) shares.set(resident.id, 0);
    return shares;
  }

  const positiveWeight = residents.reduce((sum, resident) => sum + resident.daysEnrolled, 0);
  const weights = residents.map((resident) => ({
    id: resident.id,
    weight: positiveWeight > 0 ? resident.daysEnrolled : 1,
  }));
  const totalWeight = weights.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) {
    for (const resident of residents) shares.set(resident.id, 0);
    return shares;
  }

  const total = BigInt(totalMinor);
  const denominator = BigInt(totalWeight);
  let allocated = 0;
  const ranked: Array<{ id: string; remainder: bigint }> = [];

  for (const item of weights) {
    const numerator = total * BigInt(item.weight);
    const base = Number(numerator / denominator);
    const remainder = numerator % denominator;
    shares.set(item.id, base);
    allocated += base;
    ranked.push({ id: item.id, remainder });
  }

  ranked.sort((a, b) => {
    if (a.remainder === b.remainder) return a.id.localeCompare(b.id);
    return a.remainder > b.remainder ? -1 : 1;
  });

  let remainderMinor = totalMinor - allocated;
  for (let index = 0; index < ranked.length && remainderMinor > 0; index += 1) {
    const item = ranked[index];
    if (!item) break;
    shares.set(item.id, (shares.get(item.id) ?? 0) + 1);
    remainderMinor -= 1;
  }

  return shares;
}

fundRoutes.get("/funds", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;
  const principal = auth;

  const institution = await c.env.DB.prepare(
    `SELECT timezone FROM institutions WHERE id = ? LIMIT 1`,
  )
    .bind(principal.institutionId)
    .first<InstitutionRow>();
  const timeZone = institution?.timezone || "UTC";
  const now = new Date();
  const current = currentPeriodInTimeZone(timeZone, now);

  const monthRaw = c.req.query("month");
  const yearRaw = c.req.query("year");
  if ((monthRaw === undefined) !== (yearRaw === undefined)) {
    return c.json({ success: false, error: "month and year must be supplied together" }, 400);
  }
  const month = monthRaw === undefined ? current.month : Number(monthRaw);
  const year = yearRaw === undefined ? current.year : Number(yearRaw);
  if (!isValidPeriod(month, year)) {
    return c.json({ success: false, error: "month/year must identify a valid calendar month" }, 400);
  }

  const start = localMidnightUtc(year, month, 1, timeZone);
  const endMonth = month === 11 ? 0 : month + 1;
  const endYear = month === 11 ? year + 1 : year;
  const end = localMidnightUtc(endYear, endMonth, 1, timeZone);
  const isCurrentPeriod = month === current.month && year === current.year;
  const enrollmentEndMs = isCurrentPeriod ? now.getTime() : new Date(end).getTime();
  const periodStartMs = new Date(start).getTime();
  const DAY_MS = 24 * 60 * 60 * 1000;

  const [paymentRows, expenseRow, residentsResult, billRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT p.user_id,
              COALESCE(SUM(CASE WHEN p.status = 'APPROVED' THEN p.amount_minor ELSE 0 END), 0) AS approved_minor,
              COALESCE(SUM(CASE WHEN p.status = 'REFUNDED' THEN p.amount_minor ELSE 0 END), 0) AS refunded_minor
         FROM payments p
         JOIN users u ON u.id = p.user_id
        WHERE p.institution_id = ?
          AND u.institution_id = p.institution_id
          AND u.role = 'USER'
          AND p.deleted_on IS NULL
          AND p.purged_at IS NULL
          AND p.status IN ('APPROVED', 'REFUNDED')
          AND p.created_at >= ?
          AND p.created_at < ?
        GROUP BY p.user_id`,
    )
      .bind(principal.institutionId, start, end)
      .all<PaymentAggregateRow>(),
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(amount_minor), 0) AS total_expenses_minor
         FROM expenses
        WHERE institution_id = ?
          AND status = 'APPROVED'
          AND purged_at IS NULL
          AND expense_date >= ?
          AND expense_date < ?`,
    )
      .bind(principal.institutionId, start, end)
      .first<ExpenseAggregateRow>(),
    c.env.DB.prepare(
      `SELECT id, name, email, room, avatar_url, created_at
         FROM users
        WHERE institution_id = ?
          AND role = 'USER'
          AND status = 'ACTIVE'
          AND deleted_at IS NULL
        ORDER BY name ASC, id ASC`,
    )
      .bind(principal.institutionId)
      .all<ResidentRow>(),
    c.env.DB.prepare(
      `SELECT user_id,
              COALESCE(SUM(total_amount_minor), 0) AS bill_total_minor,
              COALESCE(SUM(due_amount_minor), 0) AS bill_due_minor,
              COUNT(*) AS bill_count
         FROM bills
        WHERE institution_id = ?
          AND period_month = ?
          AND period_year = ?
          AND deleted_on IS NULL
          AND purged_at IS NULL
          AND status NOT IN ('VOID', 'DELETED')
        GROUP BY user_id`,
    )
      .bind(principal.institutionId, month, year)
      .all<BillAggregateRow>(),
  ]);

  const paymentByUser = new Map<string, { approvedMinor: number; refundedMinor: number }>();
  let totalDepositMinor = 0;
  let totalRefundedMinor = 0;
  for (const row of paymentRows.results) {
    const approvedMinor = safeMinor(row.approved_minor);
    const refundedMinor = safeMinor(row.refunded_minor);
    paymentByUser.set(row.user_id, { approvedMinor, refundedMinor });
    totalDepositMinor += approvedMinor;
    totalRefundedMinor += refundedMinor;
  }

  const totalExpensesMinor = safeMinor(expenseRow?.total_expenses_minor);
  const remainingFundMinor = totalDepositMinor - totalExpensesMinor;

  const billByUser = new Map<string, { billTotalMinor: number; billDueMinor: number; billCount: number }>();
  for (const row of billRows.results) {
    billByUser.set(row.user_id, {
      billTotalMinor: safeMinor(row.bill_total_minor),
      billDueMinor: safeMinor(row.bill_due_minor),
      billCount: Math.max(0, Math.trunc(Number(row.bill_count ?? 0))),
    });
  }

  const residentsWithDays: ResidentWeight[] = residentsResult.results.map((resident) => {
    const createdMs = new Date(resident.created_at).getTime();
    const enrollmentStartMs = Math.max(periodStartMs, Number.isFinite(createdMs) ? createdMs : periodStartMs);
    const daysEnrolled = enrollmentStartMs <= enrollmentEndMs
      ? Math.max(1, Math.ceil((enrollmentEndMs - enrollmentStartMs) / DAY_MS))
      : 0;
    return { ...resident, daysEnrolled };
  });

  const expenseShareByUser = allocateMinorByWeight(totalExpensesMinor, residentsWithDays);
  const users = residentsWithDays.map((resident) => {
    const payment = paymentByUser.get(resident.id) ?? { approvedMinor: 0, refundedMinor: 0 };
    const bills = billByUser.get(resident.id) ?? { billTotalMinor: 0, billDueMinor: 0, billCount: 0 };
    const expenseShareMinor = expenseShareByUser.get(resident.id) ?? 0;
    const deficitMinor = Math.max(0, expenseShareMinor - payment.approvedMinor);

    return {
      userId: resident.id,
      name: resident.name,
      email: resident.email,
      room: resident.room,
      avatarUrl: resident.avatar_url,
      billTotal: minorToMajor(bills.billTotalMinor),
      deposit: minorToMajor(payment.approvedMinor),
      needToPay: minorToMajor(Math.max(0, bills.billDueMinor)),
      deficit: minorToMajor(deficitMinor),
      hasBills: bills.billCount > 0,
    };
  });

  return c.json({
    success: true,
    data: {
      totalDeposit: minorToMajor(totalDepositMinor),
      totalExpenses: minorToMajor(totalExpensesMinor),
      remainingFund: minorToMajor(remainingFundMinor),
      totalRefunded: minorToMajor(totalRefundedMinor),
      month,
      year,
      users,
    },
  });
});
