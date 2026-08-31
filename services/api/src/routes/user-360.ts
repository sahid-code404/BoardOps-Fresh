import { Hono } from "hono";
import { authenticatedPrincipal } from "../auth/authorization";
import type { AppEnv } from "../types";

type User360Row = {
  id: string;
  institution_id: string;
  name: string;
  email: string;
  phone: string | null;
  role: "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "USER";
  status: "ACTIVE" | "PENDING" | "SUSPENDED" | "ARCHIVED" | "INACTIVE";
  avatar_url: string | null;
  room: string | null;
  gender: string | null;
  emergency_contact: string | null;
  institution_name: string;
  institution_user_id: string | null;
  email_verified: number;
  created_at: string;
  last_login_at: string | null;
  institution_timezone: string;
};

type LoginHistoryRow = {
  id: string;
  success: number;
  ip_address: string | null;
  created_at: string;
  reason: string | null;
};

type BillRow = {
  id: string;
  period_month: number;
  period_year: number;
  total_amount_minor: number;
  paid_amount_minor: number;
  due_amount_minor: number;
  previous_due_minor: number | null;
  status: string;
  due_date: string | null;
  generated_at: string | null;
  created_at: string;
};

type PaymentRow = {
  id: string;
  amount_minor: number;
  method: string;
  status: string;
  reference: string | null;
  effective_month: number | null;
  effective_year: number | null;
  created_at: string;
};

type RefundRow = {
  id: string;
  refund_number: string;
  amount_minor: number;
  paid_amount_minor: number;
  remaining_amount_minor: number;
  status: string;
  created_at: string;
};

type BillAggregateRow = {
  total_billed_minor: number | null;
  settled_billed_minor: number | null;
  outstanding_due_minor: number | null;
  previous_due_minor: number | null;
};

type PaymentAggregateRow = {
  total_deposited_minor: number | null;
  pending_deposits_minor: number | null;
  refunded_payment_minor: number | null;
};

type RefundAggregateRow = {
  refund_pending_minor: number | null;
  total_refunded_minor: number | null;
};

type LedgerRow = {
  id: string;
  type: string;
  amount_minor: number;
  running_balance_minor: number;
  description: string;
  created_at: string;
  total_count: number;
};

type MealCountRow = {
  current_month_on: number;
};

export const user360Routes = new Hono<AppEnv>();

function minorToMajor(value: number | null | undefined): number {
  return Number(value ?? 0) / 100;
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

function monthDateKey(year: number, month: number): string {
  return `${year.toString().padStart(4, "0")}-${(month + 1).toString().padStart(2, "0")}-01`;
}

function nextMonth(period: { month: number; year: number }): { month: number; year: number } {
  return period.month === 11
    ? { month: 0, year: period.year + 1 }
    : { month: period.month + 1, year: period.year };
}

/**
 * GET /api/users/:id/360
 *
 * Composite administrator read model over the canonical D1 domains that exist
 * today. It does not create a second financial balance table or copy mutable
 * accounting state. Bills, Payments, Refunds and Meals remain authoritative;
 * the resident ledger and fund summary below are derived from that evidence.
 *
 * Per-resident Restriction records are intentionally still unavailable because
 * BoardOps-Fresh does not yet have a canonical D1 restriction domain. Returning
 * null is safer than inventing a booking-eligibility decision.
 */
user360Routes.get("/users/:id/360", async (c) => {
  const viewer = await authenticatedPrincipal(c);
  if (!viewer) return c.json({ success: false, error: "Authentication required" }, 401);

  const userId = c.req.param("id");
  const user = await c.env.DB.prepare(
    `SELECT
       u.id, u.institution_id, u.name, u.email, u.phone, u.role, u.status,
       u.avatar_url, u.room, u.gender, u.emergency_contact,
       i.name AS institution_name, u.institution_user_id, u.email_verified,
       u.created_at, u.last_login_at, i.timezone AS institution_timezone
     FROM users u
     JOIN institutions i ON i.id = u.institution_id
     WHERE u.id = ? AND u.institution_id = ?
     LIMIT 1`,
  )
    .bind(userId, viewer.institutionId)
    .first<User360Row>();

  if (!user) return c.json({ success: false, error: "User not found" }, 404);

  const current = currentPeriodInTimeZone(user.institution_timezone || "UTC");
  const following = nextMonth(current);
  const currentPeriodIndex = current.year * 12 + current.month;
  const monthStart = monthDateKey(current.year, current.month);
  const monthEnd = monthDateKey(following.year, following.month);

  const [
    loginHistory,
    recentBills,
    recentPayments,
    recentRefunds,
    billAggregate,
    paymentAggregate,
    refundAggregate,
    ledgerResult,
    mealCount,
  ] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, success, ip_address, created_at, reason
         FROM login_history
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 3`,
    ).bind(user.id).all<LoginHistoryRow>(),

    c.env.DB.prepare(
      `SELECT
         b.id, b.period_month, b.period_year, b.total_amount_minor,
         b.paid_amount_minor, b.due_amount_minor, b.status, b.due_date,
         b.generated_at, b.created_at,
         COALESCE((
           SELECT SUM(previous.due_amount_minor)
             FROM bills previous
            WHERE previous.institution_id = b.institution_id
              AND previous.user_id = b.user_id
              AND previous.deleted_on IS NULL
              AND previous.purged_at IS NULL
              AND previous.status NOT IN ('VOID', 'DELETED')
              AND (previous.period_year * 12 + previous.period_month) < (b.period_year * 12 + b.period_month)
         ), 0) AS previous_due_minor
       FROM bills b
       WHERE b.institution_id = ?
         AND b.user_id = ?
         AND b.deleted_on IS NULL
         AND b.purged_at IS NULL
         AND b.status <> 'DELETED'
       ORDER BY COALESCE(b.generated_at, b.created_at) DESC, b.id DESC
       LIMIT 5`,
    ).bind(user.institution_id, user.id).all<BillRow>(),

    c.env.DB.prepare(
      `SELECT id, amount_minor, method, status, reference,
              effective_month, effective_year, created_at
         FROM payments
        WHERE institution_id = ?
          AND user_id = ?
          AND deleted_on IS NULL
          AND purged_at IS NULL
          AND status <> 'DELETED'
        ORDER BY created_at DESC, id DESC
        LIMIT 5`,
    ).bind(user.institution_id, user.id).all<PaymentRow>(),

    c.env.DB.prepare(
      `SELECT id, refund_number, amount_minor, paid_amount_minor,
              remaining_amount_minor, status, created_at
         FROM refunds
        WHERE institution_id = ? AND user_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 5`,
    ).bind(user.institution_id, user.id).all<RefundRow>(),

    c.env.DB.prepare(
      `SELECT
         COALESCE(SUM(total_amount_minor), 0) AS total_billed_minor,
         COALESCE(SUM(CASE WHEN status <> 'DRAFT' THEN total_amount_minor ELSE 0 END), 0) AS settled_billed_minor,
         COALESCE(SUM(due_amount_minor), 0) AS outstanding_due_minor,
         COALESCE(SUM(CASE
           WHEN (period_year * 12 + period_month) < ? THEN due_amount_minor
           ELSE 0
         END), 0) AS previous_due_minor
       FROM bills
       WHERE institution_id = ?
         AND user_id = ?
         AND deleted_on IS NULL
         AND purged_at IS NULL
         AND status NOT IN ('VOID', 'DELETED')`,
    ).bind(currentPeriodIndex, user.institution_id, user.id).first<BillAggregateRow>(),

    c.env.DB.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN amount_minor ELSE 0 END), 0) AS total_deposited_minor,
         COALESCE(SUM(CASE WHEN status = 'PENDING' THEN amount_minor ELSE 0 END), 0) AS pending_deposits_minor,
         COALESCE(SUM(CASE WHEN status = 'REFUNDED' THEN amount_minor ELSE 0 END), 0) AS refunded_payment_minor
       FROM payments
       WHERE institution_id = ?
         AND user_id = ?
         AND deleted_on IS NULL
         AND purged_at IS NULL`,
    ).bind(user.institution_id, user.id).first<PaymentAggregateRow>(),

    c.env.DB.prepare(
      `SELECT
         COALESCE(SUM(CASE
           WHEN status IN ('PENDING', 'PARTIALLY_PAID') THEN remaining_amount_minor
           ELSE 0
         END), 0) AS refund_pending_minor,
         COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN amount_minor ELSE 0 END), 0) AS total_refunded_minor
       FROM refunds
       WHERE institution_id = ? AND user_id = ?`,
    ).bind(user.institution_id, user.id).first<RefundAggregateRow>(),

    c.env.DB.prepare(
      `WITH ledger_events AS (
         SELECT
           'payment:' || id AS id,
           'DEPOSIT' AS type,
           amount_minor AS amount_minor,
           COALESCE('Payment · ' || method, 'Payment') AS description,
           created_at
         FROM payments
         WHERE institution_id = ? AND user_id = ?
           AND status = 'APPROVED'
           AND deleted_on IS NULL AND purged_at IS NULL
         UNION ALL
         SELECT
           'refund-payment:' || id AS id,
           'REFUND' AS type,
           -amount_minor AS amount_minor,
           'Refund payout' AS description,
           created_at
         FROM payments
         WHERE institution_id = ? AND user_id = ?
           AND status = 'REFUNDED'
           AND deleted_on IS NULL AND purged_at IS NULL
         UNION ALL
         SELECT
           'bill:' || id AS id,
           'BILL_SETTLEMENT' AS type,
           -total_amount_minor AS amount_minor,
           'Bill · ' || printf('%04d-%02d', period_year, period_month + 1) AS description,
           COALESCE(generated_at, created_at) AS created_at
         FROM bills
         WHERE institution_id = ? AND user_id = ?
           AND deleted_on IS NULL AND purged_at IS NULL
           AND status NOT IN ('DRAFT', 'VOID', 'DELETED')
       ), scored AS (
         SELECT
           id, type, amount_minor, description, created_at,
           SUM(amount_minor) OVER (
             ORDER BY created_at ASC, id ASC
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
           ) AS running_balance_minor,
           COUNT(*) OVER () AS total_count
         FROM ledger_events
       )
       SELECT id, type, amount_minor, running_balance_minor,
              description, created_at, total_count
         FROM scored
        ORDER BY created_at DESC, id DESC
        LIMIT 10`,
    ).bind(
      user.institution_id, user.id,
      user.institution_id, user.id,
      user.institution_id, user.id,
    ).all<LedgerRow>(),

    c.env.DB.prepare(
      `SELECT COUNT(*) AS current_month_on
         FROM meal_entries
        WHERE institution_id = ?
          AND user_id = ?
          AND service_date >= ?
          AND service_date < ?
          AND status IN ('ON', 'LOCKED')`,
    ).bind(user.institution_id, user.id, monthStart, monthEnd).first<MealCountRow>(),
  ]);

  const totalDepositedMinor = Number(paymentAggregate?.total_deposited_minor ?? 0);
  const pendingDepositsMinor = Number(paymentAggregate?.pending_deposits_minor ?? 0);
  const paidRefundMinor = Number(paymentAggregate?.refunded_payment_minor ?? 0);
  const totalBilledMinor = Number(billAggregate?.total_billed_minor ?? 0);
  const settledBilledMinor = Number(billAggregate?.settled_billed_minor ?? 0);
  const outstandingDueMinor = Number(billAggregate?.outstanding_due_minor ?? 0);
  const previousDueMinor = Number(billAggregate?.previous_due_minor ?? 0);
  const refundPendingMinor = Number(refundAggregate?.refund_pending_minor ?? 0);
  const totalRefundedMinor = Number(refundAggregate?.total_refunded_minor ?? 0);
  const rawAvailableMinor = totalDepositedMinor - settledBilledMinor - paidRefundMinor;
  const financialStatus = outstandingDueMinor > 0 && rawAvailableMinor <= 0
    ? "OVERDUE"
    : rawAvailableMinor < 0
      ? "LOW_BALANCE"
      : "HEALTHY";
  const ledgerEntryCount = Number(ledgerResult.results[0]?.total_count ?? 0);

  return c.json({
    success: true,
    data: {
      contractVersion: 2,
      profile: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        avatarUrl: user.avatar_url,
        room: user.room,
        gender: user.gender,
        emergencyContact: user.emergency_contact,
        institutionName: user.institution_name,
        institutionUserId: user.institution_user_id,
        emailVerified: user.email_verified === 1,
        twoFactorEnabled: false,
        createdAt: user.created_at,
        lastLoginAt: user.last_login_at,
      },

      fundAccount: {
        availableBalance: minorToMajor(Math.max(0, rawAvailableMinor)),
        pendingDeposits: minorToMajor(pendingDepositsMinor),
        refundPending: minorToMajor(refundPendingMinor),
        outstandingDue: minorToMajor(outstandingDueMinor),
        previousDue: minorToMajor(previousDueMinor),
        financialStatus,
        totalDeposited: minorToMajor(totalDepositedMinor),
        totalBilled: minorToMajor(totalBilledMinor),
        totalRefunded: minorToMajor(totalRefundedMinor),
        ledgerEntryCount,
      },

      // A canonical per-resident restriction domain does not exist in Fresh yet.
      restrictions: null,
      activeRestrictions: [],

      recentBills: recentBills.results.map((bill) => ({
        id: bill.id,
        billNumber: null,
        periodMonth: bill.period_month,
        periodYear: bill.period_year,
        totalAmount: minorToMajor(bill.total_amount_minor),
        paidAmount: minorToMajor(bill.paid_amount_minor),
        dueAmount: minorToMajor(bill.due_amount_minor),
        previousDue: minorToMajor(bill.previous_due_minor),
        status: bill.status,
        dueDate: bill.due_date,
        generatedAt: bill.generated_at,
      })),

      recentPayments: recentPayments.results.map((payment) => ({
        id: payment.id,
        amount: minorToMajor(payment.amount_minor),
        method: payment.method,
        status: payment.status,
        reference: payment.reference,
        effectiveMonth: payment.effective_month,
        effectiveYear: payment.effective_year,
        createdAt: payment.created_at,
      })),

      recentRefunds: recentRefunds.results.map((refund) => ({
        id: refund.id,
        refundNumber: refund.refund_number,
        amount: minorToMajor(refund.amount_minor),
        paidAmount: minorToMajor(refund.paid_amount_minor),
        remainingAmount: minorToMajor(refund.remaining_amount_minor),
        status: refund.status,
        createdAt: refund.created_at,
      })),

      ledger: ledgerResult.results.map((entry) => ({
        id: entry.id,
        type: entry.type,
        amount: minorToMajor(entry.amount_minor),
        runningBalance: minorToMajor(entry.running_balance_minor),
        description: entry.description,
        createdAt: entry.created_at,
      })),

      mealStats: {
        currentMonthON: Number(mealCount?.current_month_on ?? 0),
      },

      loginHistory: loginHistory.results.map((entry) => ({
        id: entry.id,
        success: entry.success === 1,
        ipAddress: entry.ip_address,
        createdAt: entry.created_at,
        reason: entry.reason,
      })),

      dataAvailability: {
        profile: true,
        loginHistory: true,
        fundAccount: true,
        bills: true,
        payments: true,
        refunds: true,
        ledger: true,
        meals: true,
        restrictions: false,
      },
    },
  });
});
