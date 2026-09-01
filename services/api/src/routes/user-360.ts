import { Hono } from "hono";
import { authenticatedPrincipal } from "../auth/authorization";
import type { AppEnv } from "../types";

type UserRow = {
  id: string;
  institution_id: string;
  name: string;
  email: string;
  phone: string | null;
  role: "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "USER";
  status: string;
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

type RestrictionRow = {
  id: string;
  type: "FINANCIAL" | "ADMINISTRATIVE";
  reason: string;
  source: "AUTOMATIC" | "MANUAL";
  status: string;
  applied_at: string;
  expires_at: string | null;
};

type PolicyRow = { key: string; value: string };
type AggregateRow = { a: number | null; b: number | null; c: number | null; d: number | null };

const DEFAULT_GRACE_DAYS = 2;
const DEFAULT_REQUIRED_BALANCE = 1000;

export const user360Routes = new Hono<AppEnv>();

function major(minor: number | null | undefined): number {
  return Number(minor ?? 0) / 100;
}

function currentPeriod(timeZone: string) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? now.getUTCFullYear());
  const month = Number(parts.find((part) => part.type === "month")?.value ?? now.getUTCMonth() + 1) - 1;
  return { month, year };
}

function monthKey(year: number, month: number) {
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-01`;
}

function policyFrom(rows: PolicyRow[]) {
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const grace = Number.parseInt(values.get("policy.lowBalance.graceDays") ?? "", 10);
  const required = Number.parseFloat(values.get("policy.lowBalance.requiredBalance") ?? "");
  return {
    enabled: (values.get("policy.lowBalance.enabled") ?? "true").trim().toLowerCase() !== "false",
    graceDays: Number.isFinite(grace) && grace > 0 ? grace : DEFAULT_GRACE_DAYS,
    requiredBalance: Number.isFinite(required) && required > 0 ? required : DEFAULT_REQUIRED_BALANCE,
  };
}

user360Routes.get("/users/:id/360", async (c) => {
  const viewer = await authenticatedPrincipal(c);
  if (!viewer) return c.json({ success: false, error: "Authentication required" }, 401);

  const user = await c.env.DB.prepare(
    `SELECT u.id, u.institution_id, u.name, u.email, u.phone, u.role, u.status,
            u.avatar_url, u.room, u.gender, u.emergency_contact,
            i.name AS institution_name, u.institution_user_id, u.email_verified,
            u.created_at, u.last_login_at, i.timezone AS institution_timezone
       FROM users u
       JOIN institutions i ON i.id = u.institution_id
      WHERE u.id = ? AND u.institution_id = ? LIMIT 1`,
  ).bind(c.req.param("id"), viewer.institutionId).first<UserRow>();

  if (!user) return c.json({ success: false, error: "User not found" }, 404);
  if (user.role !== "USER") {
    return c.json({ success: false, error: "Resident 360° is available only for resident accounts. Administrators do not have a resident Fund Account." }, 422);
  }

  const period = currentPeriod(user.institution_timezone || "UTC");
  const next = period.month === 11 ? { month: 0, year: period.year + 1 } : { month: period.month + 1, year: period.year };
  const periodIndex = period.year * 12 + period.month;

  const [loginHistory, bills, payments, refunds, billAgg, paymentAgg, refundAgg, ledger, mealCount, restrictions, policyRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, success, ip_address, created_at, reason FROM login_history
        WHERE user_id = ? ORDER BY created_at DESC LIMIT 3`,
    ).bind(user.id).all<{ id: string; success: number; ip_address: string | null; created_at: string; reason: string | null }>(),

    c.env.DB.prepare(
      `SELECT b.id, b.period_month, b.period_year, b.total_amount_minor, b.paid_amount_minor,
              b.due_amount_minor, b.status, b.due_date, b.generated_at, b.created_at,
              COALESCE((SELECT SUM(p.due_amount_minor) FROM bills p
                WHERE p.institution_id=b.institution_id AND p.user_id=b.user_id
                  AND p.deleted_on IS NULL AND p.purged_at IS NULL
                  AND p.status NOT IN ('VOID','DELETED')
                  AND (p.period_year*12+p.period_month)<(b.period_year*12+b.period_month)),0) AS previous_due_minor
         FROM bills b
        WHERE b.institution_id=? AND b.user_id=? AND b.deleted_on IS NULL AND b.purged_at IS NULL AND b.status<>'DELETED'
        ORDER BY COALESCE(b.generated_at,b.created_at) DESC, b.id DESC LIMIT 5`,
    ).bind(user.institution_id, user.id).all<any>(),

    c.env.DB.prepare(
      `SELECT id, amount_minor, method, status, reference, effective_month, effective_year, created_at
         FROM payments WHERE institution_id=? AND user_id=? AND deleted_on IS NULL AND purged_at IS NULL AND status<>'DELETED'
        ORDER BY created_at DESC, id DESC LIMIT 5`,
    ).bind(user.institution_id, user.id).all<any>(),

    c.env.DB.prepare(
      `SELECT id, refund_number, amount_minor, paid_amount_minor, remaining_amount_minor, status, created_at
         FROM refunds WHERE institution_id=? AND user_id=? ORDER BY created_at DESC, id DESC LIMIT 5`,
    ).bind(user.institution_id, user.id).all<any>(),

    c.env.DB.prepare(
      `SELECT COALESCE(SUM(total_amount_minor),0) AS a,
              COALESCE(SUM(CASE WHEN status<>'DRAFT' THEN total_amount_minor ELSE 0 END),0) AS b,
              COALESCE(SUM(due_amount_minor),0) AS c,
              COALESCE(SUM(CASE WHEN (period_year*12+period_month)<? THEN due_amount_minor ELSE 0 END),0) AS d
         FROM bills WHERE institution_id=? AND user_id=? AND deleted_on IS NULL AND purged_at IS NULL AND status NOT IN ('VOID','DELETED')`,
    ).bind(periodIndex, user.institution_id, user.id).first<AggregateRow>(),

    c.env.DB.prepare(
      `SELECT COALESCE(SUM(CASE WHEN status='APPROVED' THEN amount_minor ELSE 0 END),0) AS a,
              COALESCE(SUM(CASE WHEN status='PENDING' THEN amount_minor ELSE 0 END),0) AS b,
              COALESCE(SUM(CASE WHEN status='REFUNDED' THEN amount_minor ELSE 0 END),0) AS c,
              0 AS d
         FROM payments WHERE institution_id=? AND user_id=? AND deleted_on IS NULL AND purged_at IS NULL`,
    ).bind(user.institution_id, user.id).first<AggregateRow>(),

    c.env.DB.prepare(
      `SELECT COALESCE(SUM(CASE WHEN status IN ('PENDING','PARTIALLY_PAID') THEN remaining_amount_minor ELSE 0 END),0) AS a,
              COALESCE(SUM(CASE WHEN status='COMPLETED' THEN amount_minor ELSE 0 END),0) AS b, 0 AS c, 0 AS d
         FROM refunds WHERE institution_id=? AND user_id=?`,
    ).bind(user.institution_id, user.id).first<AggregateRow>(),

    c.env.DB.prepare(
      `WITH events AS (
         SELECT 'payment:'||id AS id, 'DEPOSIT' AS type, amount_minor,
                'Payment · '||method AS description, created_at
           FROM payments WHERE institution_id=? AND user_id=? AND status='APPROVED' AND deleted_on IS NULL AND purged_at IS NULL
         UNION ALL
         SELECT 'refund-payment:'||id, 'REFUND', -amount_minor, 'Refund payout', created_at
           FROM payments WHERE institution_id=? AND user_id=? AND status='REFUNDED' AND deleted_on IS NULL AND purged_at IS NULL
         UNION ALL
         SELECT 'bill:'||id, 'BILL_SETTLEMENT', -total_amount_minor,
                'Bill · '||printf('%04d-%02d',period_year,period_month+1), COALESCE(generated_at,created_at)
           FROM bills WHERE institution_id=? AND user_id=? AND deleted_on IS NULL AND purged_at IS NULL AND status NOT IN ('DRAFT','VOID','DELETED')
       ), scored AS (
         SELECT id,type,amount_minor,description,created_at,
                SUM(amount_minor) OVER (ORDER BY created_at,id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_balance_minor,
                COUNT(*) OVER () AS total_count FROM events
       ) SELECT * FROM scored ORDER BY created_at DESC,id DESC LIMIT 10`,
    ).bind(user.institution_id,user.id,user.institution_id,user.id,user.institution_id,user.id).all<any>(),

    c.env.DB.prepare(
      `SELECT COUNT(*) AS count FROM meal_entries WHERE institution_id=? AND user_id=?
        AND service_date>=? AND service_date<? AND status IN ('ON','LOCKED')`,
    ).bind(user.institution_id,user.id,monthKey(period.year,period.month),monthKey(next.year,next.month)).first<{ count: number }>(),

    c.env.DB.prepare(
      `SELECT id,type,reason,source,status,applied_at,expires_at FROM restrictions
        WHERE institution_id=? AND user_id=? AND status='ACTIVE' ORDER BY applied_at DESC,id DESC`,
    ).bind(user.institution_id,user.id).all<RestrictionRow>(),

    c.env.DB.prepare(
      `SELECT key,value FROM policies WHERE institution_id=?
        AND key IN ('policy.lowBalance.enabled','policy.lowBalance.graceDays','policy.lowBalance.requiredBalance')`,
    ).bind(user.institution_id).all<PolicyRow>(),
  ]);

  const totalDepositedMinor = Number(paymentAgg?.a ?? 0);
  const pendingDepositsMinor = Number(paymentAgg?.b ?? 0);
  const paidRefundMinor = Number(paymentAgg?.c ?? 0);
  const totalBilledMinor = Number(billAgg?.a ?? 0);
  const settledBilledMinor = Number(billAgg?.b ?? 0);
  const outstandingDueMinor = Number(billAgg?.c ?? 0);
  const previousDueMinor = Number(billAgg?.d ?? 0);
  const refundPendingMinor = Number(refundAgg?.a ?? 0);
  const totalRefundedMinor = Number(refundAgg?.b ?? 0);
  const rawAvailableMinor = totalDepositedMinor - settledBilledMinor - paidRefundMinor;
  const availableBalance = major(Math.max(0, rawAvailableMinor));
  const outstandingDue = major(outstandingDueMinor);
  const policy = policyFrom(policyRows.results);
  const active = restrictions.results;
  const financialRestricted = active.some((row) => row.type === "FINANCIAL");
  const adminRestricted = active.some((row) => row.type === "ADMINISTRATIVE");
  const exempt = active.some((row) => row.type === "FINANCIAL" && row.source === "MANUAL" && row.reason.includes("EXEMPTION"));

  let graceDaysRemaining: number | null = null;
  if (policy.enabled && !exempt && !financialRestricted && availableBalance < policy.requiredBalance && outstandingDue > 0) {
    const warning = await c.env.DB.prepare(
      `SELECT created_at FROM notifications WHERE institution_id=? AND user_id=? AND title='Low Balance Warning'
        ORDER BY created_at DESC LIMIT 1`,
    ).bind(user.institution_id,user.id).first<{ created_at: string }>();
    if (!warning) graceDaysRemaining = policy.graceDays;
    else {
      const end = Date.parse(warning.created_at) + policy.graceDays * 86_400_000;
      graceDaysRemaining = Math.max(0, Math.ceil((end - Date.now()) / 86_400_000));
    }
  }

  const canBookMeals = !adminRestricted && (!financialRestricted || exempt);
  const restrictionStatus = exempt ? "EXEMPTED"
    : financialRestricted || adminRestricted ? "RESTRICTED"
      : policy.enabled && availableBalance < policy.requiredBalance && outstandingDue > 0
        ? (graceDaysRemaining !== null && graceDaysRemaining > 0 ? "LOW_BALANCE" : "RESTRICTED")
        : outstandingDue > 0 ? "OVERDUE" : "HEALTHY";
  const fundStatus = outstandingDueMinor > 0 && rawAvailableMinor <= 0 ? "OVERDUE" : rawAvailableMinor < 0 ? "LOW_BALANCE" : "HEALTHY";

  return c.json({ success: true, data: {
    contractVersion: 2,
    profile: {
      id:user.id,name:user.name,email:user.email,phone:user.phone,role:user.role,status:user.status,
      avatarUrl:user.avatar_url,room:user.room,gender:user.gender,emergencyContact:user.emergency_contact,
      institutionName:user.institution_name,institutionUserId:user.institution_user_id,emailVerified:user.email_verified===1,
      twoFactorEnabled:false,createdAt:user.created_at,lastLoginAt:user.last_login_at,
    },
    fundAccount: {
      availableBalance,pendingDeposits:major(pendingDepositsMinor),refundPending:major(refundPendingMinor),outstandingDue,
      previousDue:major(previousDueMinor),financialStatus:fundStatus,totalDeposited:major(totalDepositedMinor),
      totalBilled:major(totalBilledMinor),totalRefunded:major(totalRefundedMinor),
      ledgerEntryCount:Number(ledger.results[0]?.total_count ?? 0),
    },
    restrictions: {
      canBookMeals,financialStatus:restrictionStatus,availableBalance,requiredBalance:policy.requiredBalance,
      graceDaysRemaining,hasExemption:exempt,restrictionReason:active[0]?.reason ?? null,
    },
    activeRestrictions: active.map((row)=>({id:row.id,type:row.type,reason:row.reason,source:row.source,status:row.status,appliedAt:row.applied_at,expiresAt:row.expires_at})),
    recentBills: bills.results.map((b:any)=>({id:b.id,billNumber:null,periodMonth:b.period_month,periodYear:b.period_year,totalAmount:major(b.total_amount_minor),paidAmount:major(b.paid_amount_minor),dueAmount:major(b.due_amount_minor),previousDue:major(b.previous_due_minor),status:b.status,dueDate:b.due_date,generatedAt:b.generated_at})),
    recentPayments: payments.results.map((p:any)=>({id:p.id,amount:major(p.amount_minor),method:p.method,status:p.status,reference:p.reference,effectiveMonth:p.effective_month,effectiveYear:p.effective_year,createdAt:p.created_at})),
    recentRefunds: refunds.results.map((r:any)=>({id:r.id,refundNumber:r.refund_number,amount:major(r.amount_minor),paidAmount:major(r.paid_amount_minor),remainingAmount:major(r.remaining_amount_minor),status:r.status,createdAt:r.created_at})),
    ledger: ledger.results.map((e:any)=>({id:e.id,type:e.type,amount:major(e.amount_minor),runningBalance:major(e.running_balance_minor),description:e.description,createdAt:e.created_at})),
    mealStats:{currentMonthON:Number(mealCount?.count ?? 0)},
    loginHistory:loginHistory.results.map((e)=>({id:e.id,success:e.success===1,ipAddress:e.ip_address,createdAt:e.created_at,reason:e.reason})),
    dataAvailability:{profile:true,loginHistory:true,fundAccount:true,bills:true,payments:true,refunds:true,ledger:true,meals:true,restrictions:true},
  }});
});
