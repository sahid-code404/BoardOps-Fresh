import { Hono, type Context } from "hono";
import { authenticatedPrincipal, type AuthPrincipal } from "../auth/authorization";
import type { AppEnv } from "../types";

type PaymentStatus = "PENDING" | "APPROVED" | "REJECTED" | "REFUNDED" | "VOID" | "DELETED";
type PaymentMethod = "CASH" | "UPI" | "CARD" | "BANK_TRANSFER" | "WALLET" | "REFUND";
type RestorablePaymentStatus = Exclude<PaymentStatus, "DELETED">;

type PaymentRow = {
  id: string;
  institution_id: string;
  user_id: string;
  bill_id: string | null;
  amount_minor: number;
  method: PaymentMethod;
  status: PaymentStatus;
  reference: string | null;
  notes: string | null;
  idempotency_key: string | null;
  approved_by: string | null;
  approved_at: string | null;
  effective_month: number | null;
  effective_year: number | null;
  status_before_delete: RestorablePaymentStatus | null;
  deleted_on: string | null;
  deletion_scheduled_for: string | null;
  deleted_by: string | null;
  deletion_reason: string | null;
  purged_at: string | null;
  created_at: string;
  updated_at: string;
};

type PaymentWithUserRow = PaymentRow & {
  user_name: string;
  user_email: string;
  user_room: string | null;
  user_avatar_url: string | null;
};

type BillRow = {
  id: string;
  institution_id: string;
  user_id: string;
  total_amount_minor: number;
  paid_amount_minor: number;
  due_amount_minor: number;
  status: "DRAFT" | "GENERATED" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "VOID" | "DELETED";
  due_date: string | null;
  deleted_on: string | null;
  purged_at: string | null;
};

type RefundRow = {
  id: string;
  institution_id: string;
  user_id: string;
  bill_id: string | null;
  amount_minor: number;
  paid_amount_minor: number;
  remaining_amount_minor: number;
  status: "PENDING" | "PARTIALLY_PAID" | "PAID" | "CANCELLED";
  reason: string | null;
  created_at: string;
  updated_at: string;
};

type CreditRow = {
  approved_minor: number | null;
  refunded_minor: number | null;
  billed_minor: number | null;
};

const PAYMENT_METHODS = new Set<Exclude<PaymentMethod, "REFUND">>([
  "CASH",
  "UPI",
  "CARD",
  "BANK_TRANSFER",
  "WALLET",
]);
const RESTORABLE_STATUSES = new Set<RestorablePaymentStatus>([
  "PENDING",
  "APPROVED",
  "REJECTED",
  "REFUNDED",
  "VOID",
]);

export const paymentRoutes = new Hono<AppEnv>();

async function principalFor(c: Context<AppEnv>): Promise<AuthPrincipal | Response> {
  const principal = await authenticatedPrincipal(c);
  return principal ?? c.json({ success: false, error: "Authentication required" }, 401);
}

function minorToMajor(value: number): number {
  return Number(value || 0) / 100;
}

function majorToMinor(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 1e-7) return null;
  return rounded;
}

function paymentResponse(row: PaymentWithUserRow) {
  return {
    id: row.id,
    amount: minorToMajor(row.amount_minor),
    method: row.method,
    status: row.status,
    reference: row.reference,
    notes: row.notes,
    billId: row.bill_id,
    approvedAt: row.approved_at,
    effectiveMonth: row.effective_month,
    effectiveYear: row.effective_year,
    createdAt: row.created_at,
    // Golden UI uses deletedAt as the recovery-window deadline.
    deletedAt: row.deletion_scheduled_for,
    deletionReason: row.deletion_reason,
    user: {
      name: row.user_name,
      email: row.user_email,
      room: row.user_room,
      avatarUrl: row.user_avatar_url,
    },
  };
}

function refundResponse(row: RefundRow) {
  return {
    id: row.id,
    userId: row.user_id,
    billId: row.bill_id,
    amount: minorToMajor(row.amount_minor),
    paidAmount: minorToMajor(row.paid_amount_minor),
    remainingAmount: minorToMajor(row.remaining_amount_minor),
    status: row.status,
    reason: row.reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function institutionTimezone(c: Context<AppEnv>, institutionId: string): Promise<string> {
  const row = await c.env.DB.prepare(`SELECT timezone FROM institutions WHERE id = ? LIMIT 1`)
    .bind(institutionId)
    .first<{ timezone: string }>();
  return row?.timezone || "UTC";
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
  return Math.round((localAsUtc - instant.getTime()) / 60000);
}

function localMidnightUtc(year: number, month: number, day: number, timeZone: string): string {
  const wallClockUtc = Date.UTC(year, month, day, 0, 0, 0, 0);
  let candidate = new Date(wallClockUtc);
  let offset = timezoneOffsetMinutes(timeZone, candidate);
  candidate = new Date(wallClockUtc - offset * 60000);
  const corrected = timezoneOffsetMinutes(timeZone, candidate);
  if (corrected !== offset) {
    offset = corrected;
    candidate = new Date(wallClockUtc - offset * 60000);
  }
  return candidate.toISOString();
}

function isValidPeriod(month: number, year: number): boolean {
  return Number.isInteger(month) && month >= 0 && month <= 11 && Number.isInteger(year) && year >= 2000 && year <= 9999;
}

async function markExpiredDeletionQueue(c: Context<AppEnv>, institutionId: string, nowIso: string): Promise<void> {
  await c.env.DB.prepare(
    `UPDATE payments
        SET purged_at = ?, updated_at = ?
      WHERE institution_id = ?
        AND status = 'DELETED'
        AND purged_at IS NULL
        AND deletion_scheduled_for IS NOT NULL
        AND deletion_scheduled_for <= ?`,
  )
    .bind(nowIso, nowIso, institutionId, nowIso)
    .run();
}

async function loadPaymentWithUser(
  c: Context<AppEnv>,
  principal: AuthPrincipal,
  paymentId: string,
): Promise<PaymentWithUserRow | null> {
  const residentClause = principal.role === "USER" ? " AND p.user_id = ?" : "";
  const bindings: unknown[] = [paymentId, principal.institutionId];
  if (principal.role === "USER") bindings.push(principal.id);
  return c.env.DB.prepare(
    `SELECT p.*,
            u.name AS user_name,
            u.email AS user_email,
            u.room AS user_room,
            u.avatar_url AS user_avatar_url
       FROM payments p
       JOIN users u ON u.id = p.user_id
      WHERE p.id = ?
        AND p.institution_id = ?
        AND u.institution_id = p.institution_id
        AND u.role = 'USER'
        ${residentClause}
      LIMIT 1`,
  )
    .bind(...bindings)
    .first<PaymentWithUserRow>();
}

async function audit(
  c: Context<AppEnv>,
  principal: AuthPrincipal,
  action: string,
  entityId: string | null,
  reason: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  await c.env.DB.prepare(
    `INSERT INTO audit_events
      (id, institution_id, actor_user_id, action, entity_type, entity_id,
       request_id, reason, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'Payment', ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      principal.institutionId,
      principal.id,
      action,
      entityId,
      c.get("requestId"),
      reason,
      JSON.stringify(metadata),
      new Date().toISOString(),
    )
    .run();
}

async function activeBillForUser(
  c: Context<AppEnv>,
  institutionId: string,
  userId: string,
  billId: string,
): Promise<BillRow | null> {
  return c.env.DB.prepare(
    `SELECT id, institution_id, user_id, total_amount_minor, paid_amount_minor,
            due_amount_minor, status, due_date, deleted_on, purged_at
       FROM bills
      WHERE id = ? AND institution_id = ? AND user_id = ?
      LIMIT 1`,
  )
    .bind(billId, institutionId, userId)
    .first<BillRow>();
}

async function recomputeBill(c: Context<AppEnv>, institutionId: string, billId: string | null): Promise<void> {
  if (!billId) return;
  const bill = await c.env.DB.prepare(
    `SELECT id, institution_id, user_id, total_amount_minor, paid_amount_minor,
            due_amount_minor, status, due_date, deleted_on, purged_at
       FROM bills
      WHERE id = ? AND institution_id = ?
      LIMIT 1`,
  )
    .bind(billId, institutionId)
    .first<BillRow>();
  if (!bill || bill.purged_at) return;

  const sums = await c.env.DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'APPROVED' AND deleted_on IS NULL THEN amount_minor ELSE 0 END), 0) AS approved_minor,
       COALESCE(SUM(CASE WHEN status = 'REFUNDED' AND deleted_on IS NULL THEN amount_minor ELSE 0 END), 0) AS refunded_minor
     FROM payments
     WHERE institution_id = ? AND bill_id = ? AND purged_at IS NULL`,
  )
    .bind(institutionId, billId)
    .first<{ approved_minor: number | null; refunded_minor: number | null }>();

  const approved = Number(sums?.approved_minor ?? 0);
  const refunded = Number(sums?.refunded_minor ?? 0);
  const paid = Math.max(0, approved - refunded);
  const due = Math.max(0, bill.total_amount_minor - paid);

  let nextStatus = bill.status;
  if (bill.status !== "VOID" && bill.status !== "DELETED" && bill.status !== "DRAFT") {
    if (due === 0) {
      nextStatus = "PAID";
    } else if (bill.due_date && bill.due_date < new Date().toISOString()) {
      nextStatus = "OVERDUE";
    } else if (paid > 0) {
      nextStatus = "PARTIALLY_PAID";
    } else {
      nextStatus = "GENERATED";
    }
  }

  await c.env.DB.prepare(
    `UPDATE bills
        SET paid_amount_minor = ?, due_amount_minor = ?, status = ?, updated_at = ?
      WHERE id = ? AND institution_id = ?`,
  )
    .bind(paid, due, nextStatus, new Date().toISOString(), billId, institutionId)
    .run();
}

async function userCredit(c: Context<AppEnv>, institutionId: string, userId: string): Promise<{
  creditMinor: number;
  totalApprovedMinor: number;
  totalBilledMinor: number;
  totalRefundedMinor: number;
}> {
  const row = await c.env.DB.prepare(
    `SELECT
       (SELECT COALESCE(SUM(amount_minor), 0)
          FROM payments
         WHERE institution_id = ? AND user_id = ?
           AND status = 'APPROVED' AND deleted_on IS NULL AND purged_at IS NULL) AS approved_minor,
       (SELECT COALESCE(SUM(amount_minor), 0)
          FROM payments
         WHERE institution_id = ? AND user_id = ?
           AND status = 'REFUNDED' AND deleted_on IS NULL AND purged_at IS NULL) AS refunded_minor,
       (SELECT COALESCE(SUM(total_amount_minor), 0)
          FROM bills
         WHERE institution_id = ? AND user_id = ?
           AND deleted_on IS NULL AND purged_at IS NULL
           AND status IN ('GENERATED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE')) AS billed_minor`,
  )
    .bind(institutionId, userId, institutionId, userId, institutionId, userId)
    .first<CreditRow>();

  const totalApprovedMinor = Number(row?.approved_minor ?? 0);
  const totalRefundedMinor = Number(row?.refunded_minor ?? 0);
  const totalBilledMinor = Number(row?.billed_minor ?? 0);
  return {
    creditMinor: Math.max(0, totalApprovedMinor - totalBilledMinor - totalRefundedMinor),
    totalApprovedMinor,
    totalBilledMinor,
    totalRefundedMinor,
  };
}

paymentRoutes.get("/payments", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;
  const principal = auth;
  const nowIso = new Date().toISOString();
  await markExpiredDeletionQueue(c, principal.institutionId, nowIso);

  const clauses = [
    "p.institution_id = ?",
    "u.institution_id = p.institution_id",
    "u.role = 'USER'",
    "p.purged_at IS NULL",
  ];
  const bindings: unknown[] = [principal.institutionId];

  const includeDeleted = c.req.query("includeDeleted") === "true";
  clauses.push(includeDeleted ? "p.deleted_on IS NOT NULL" : "p.deleted_on IS NULL");

  if (principal.role === "USER") {
    clauses.push("p.user_id = ?");
    bindings.push(principal.id);
  }

  const monthRaw = c.req.query("month");
  const yearRaw = c.req.query("year");
  if ((monthRaw === undefined) !== (yearRaw === undefined)) {
    return c.json({ success: false, error: "month and year must be supplied together" }, 400);
  }
  if (monthRaw !== undefined && yearRaw !== undefined) {
    const month = Number(monthRaw);
    const year = Number(yearRaw);
    if (!isValidPeriod(month, year)) {
      return c.json({ success: false, error: "month/year must identify a valid calendar month" }, 400);
    }
    const timeZone = await institutionTimezone(c, principal.institutionId);
    const start = localMidnightUtc(year, month, 1, timeZone);
    const endMonth = month === 11 ? 0 : month + 1;
    const endYear = month === 11 ? year + 1 : year;
    const end = localMidnightUtc(endYear, endMonth, 1, timeZone);
    clauses.push("p.created_at >= ?", "p.created_at < ?");
    bindings.push(start, end);
  }

  const requestedLimit = Number(c.req.query("limit") ?? 200);
  const limit = Number.isFinite(requestedLimit) ? Math.min(500, Math.max(1, Math.trunc(requestedLimit))) : 200;
  bindings.push(limit);

  const rows = await c.env.DB.prepare(
    `SELECT p.*,
            u.name AS user_name,
            u.email AS user_email,
            u.room AS user_room,
            u.avatar_url AS user_avatar_url
       FROM payments p
       JOIN users u ON u.id = p.user_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY p.created_at DESC
      LIMIT ?`,
  )
    .bind(...bindings)
    .all<PaymentWithUserRow>();

  return c.json({ success: true, data: rows.results.map(paymentResponse) });
});

paymentRoutes.get("/payments/refund", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;
  const principal = auth;

  const residents = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.room, u.avatar_url,
            EXISTS(
              SELECT 1 FROM bills b
              WHERE b.institution_id = u.institution_id
                AND b.user_id = u.id
                AND b.deleted_on IS NULL
                AND b.purged_at IS NULL
                AND b.status IN ('GENERATED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE')
            ) AS has_billed_history
       FROM users u
      WHERE u.institution_id = ?
        AND u.role = 'USER'
        AND u.status = 'ACTIVE'
        AND u.deleted_at IS NULL
      ORDER BY u.name ASC`,
  )
    .bind(principal.institutionId)
    .all<{
      id: string;
      name: string;
      email: string;
      room: string | null;
      avatar_url: string | null;
      has_billed_history: number;
    }>();

  const result: Array<Record<string, unknown>> = [];
  for (const resident of residents.results) {
    if (!resident.has_billed_history) continue;
    const credit = await userCredit(c, principal.institutionId, resident.id);
    if (credit.creditMinor <= 0) continue;
    result.push({
      userId: resident.id,
      name: resident.name,
      email: resident.email,
      room: resident.room,
      avatarUrl: resident.avatar_url,
      creditAmount: minorToMajor(credit.creditMinor),
      breakdown: {
        totalApproved: minorToMajor(credit.totalApprovedMinor),
        totalBilled: minorToMajor(credit.totalBilledMinor),
        totalRefunded: minorToMajor(credit.totalRefundedMinor),
      },
    });
  }

  result.sort((a, b) => Number(b.creditAmount ?? 0) - Number(a.creditAmount ?? 0));
  return c.json({ success: true, data: result });
});

paymentRoutes.get("/refunds", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;
  const principal = auth;

  const clauses = ["institution_id = ?"];
  const bindings: unknown[] = [principal.institutionId];
  const status = c.req.query("status");
  if (status) {
    if (!new Set(["PENDING", "PARTIALLY_PAID", "PAID", "CANCELLED"]).has(status)) {
      return c.json({ success: false, error: "Invalid refund status" }, 400);
    }
    clauses.push("status = ?");
    bindings.push(status);
  }

  const rows = await c.env.DB.prepare(
    `SELECT * FROM refunds
      WHERE ${clauses.join(" AND ")}
      ORDER BY created_at DESC`,
  )
    .bind(...bindings)
    .all<RefundRow>();
  return c.json({ success: true, data: rows.results.map(refundResponse) });
});

paymentRoutes.get("/payments/:id", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;
  const row = await loadPaymentWithUser(c, auth, c.req.param("id"));
  if (!row || row.purged_at) return c.json({ success: false, error: "Payment not found" }, 404);
  return c.json({ success: true, data: paymentResponse(row) });
});

paymentRoutes.post("/payments", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;
  const principal = auth;
  if (principal.role !== "USER") {
    return c.json({ success: false, error: "Only residents can submit payments" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const amountMinor = majorToMinor(body.amount);
  if (amountMinor === null) {
    return c.json({ success: false, error: "amount must be a positive value with at most two decimal places" }, 422);
  }
  const method = String(body.method ?? "CASH") as Exclude<PaymentMethod, "REFUND">;
  if (!PAYMENT_METHODS.has(method)) {
    return c.json({ success: false, error: "Invalid payment method" }, 422);
  }

  const billId = typeof body.billId === "string" && body.billId.trim() ? body.billId.trim() : null;
  if (billId) {
    const bill = await activeBillForUser(c, principal.institutionId, principal.id, billId);
    if (!bill || bill.deleted_on || bill.purged_at || bill.status === "VOID" || bill.status === "DELETED" || bill.status === "DRAFT") {
      return c.json({ success: false, error: "Selected bill is not payable" }, 422);
    }
  }

  const reference = typeof body.reference === "string" && body.reference.trim() ? body.reference.trim().slice(0, 200) : null;
  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 2000) : null;
  const headerKey = c.req.header("Idempotency-Key")?.trim();
  const idempotencyKey = headerKey ? headerKey.slice(0, 200) : null;

  if (idempotencyKey) {
    const existing = await c.env.DB.prepare(
      `SELECT p.*,
              u.name AS user_name, u.email AS user_email, u.room AS user_room, u.avatar_url AS user_avatar_url
         FROM payments p
         JOIN users u ON u.id = p.user_id
        WHERE p.institution_id = ? AND p.user_id = ? AND p.idempotency_key = ?
        LIMIT 1`,
    )
      .bind(principal.institutionId, principal.id, idempotencyKey)
      .first<PaymentWithUserRow>();
    if (existing) return c.json({ success: true, data: paymentResponse(existing) });
  }

  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO payments
      (id, institution_id, user_id, bill_id, amount_minor, method, status,
       reference, notes, idempotency_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      principal.institutionId,
      principal.id,
      billId,
      amountMinor,
      method,
      reference,
      notes,
      idempotencyKey,
      nowIso,
      nowIso,
    )
    .run();

  await audit(c, principal, "PAYMENT_SUBMITTED", id, null, {
    amountMinor,
    method,
    billId,
    idempotencyKey: idempotencyKey ? "present" : "absent",
  });

  const created = await loadPaymentWithUser(c, principal, id);
  if (!created) return c.json({ success: false, error: "Payment persistence failed" }, 500);
  return c.json({ success: true, data: paymentResponse(created) }, 201);
});

paymentRoutes.patch("/payments/:id", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;
  const principal = auth;
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const action = String(body.action ?? "");
  if (action !== "APPROVE" && action !== "REJECT") {
    return c.json({ success: false, error: "action must be APPROVE or REJECT" }, 422);
  }

  const existing = await loadPaymentWithUser(c, principal, c.req.param("id"));
  if (!existing || existing.purged_at) return c.json({ success: false, error: "Payment not found" }, 404);
  if (existing.deleted_on || existing.status === "DELETED") {
    return c.json({ success: false, error: "Payment is scheduled for deletion" }, 422);
  }
  if (existing.method === "REFUND" || existing.status === "REFUNDED" || existing.status === "VOID") {
    return c.json({ success: false, error: "This payment cannot be approved or rejected" }, 422);
  }

  const target: PaymentStatus = action === "APPROVE" ? "APPROVED" : "REJECTED";
  if (existing.status === target) {
    return c.json({ success: true, data: paymentResponse(existing) });
  }

  if (target === "APPROVED" && existing.bill_id) {
    const bill = await activeBillForUser(c, principal.institutionId, existing.user_id, existing.bill_id);
    if (!bill || bill.deleted_on || bill.purged_at || bill.status === "VOID" || bill.status === "DELETED" || bill.status === "DRAFT") {
      return c.json({ success: false, error: "Cannot approve payment for a voided, deleted, or draft bill" }, 422);
    }
  }

  const nowIso = new Date().toISOString();
  if (target === "APPROVED") {
    const timeZone = await institutionTimezone(c, principal.institutionId);
    const period = currentPeriodInTimeZone(timeZone);
    await c.env.DB.prepare(
      `UPDATE payments
          SET status = 'APPROVED', approved_by = ?, approved_at = ?,
              effective_month = ?, effective_year = ?, updated_at = ?
        WHERE id = ? AND institution_id = ?`,
    )
      .bind(principal.id, nowIso, period.month, period.year, nowIso, existing.id, principal.institutionId)
      .run();
  } else {
    await c.env.DB.prepare(
      `UPDATE payments
          SET status = 'REJECTED', approved_by = NULL, approved_at = NULL,
              effective_month = NULL, effective_year = NULL, updated_at = ?
        WHERE id = ? AND institution_id = ?`,
    )
      .bind(nowIso, existing.id, principal.institutionId)
      .run();
  }

  await recomputeBill(c, principal.institutionId, existing.bill_id);
  await audit(c, principal, target === "APPROVED" ? "PAYMENT_APPROVED" : "PAYMENT_REJECTED", existing.id, null, {
    previousStatus: existing.status,
    nextStatus: target,
    amountMinor: existing.amount_minor,
    billId: existing.bill_id,
  });

  const updated = await loadPaymentWithUser(c, principal, existing.id);
  if (!updated) return c.json({ success: false, error: "Payment persistence failed" }, 500);
  return c.json({ success: true, data: paymentResponse(updated) });
});

paymentRoutes.put("/payments/:id", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;
  const principal = auth;
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const action = String(body.action ?? "");
  if (action !== "EDIT" && action !== "VOID") {
    return c.json({ success: false, error: "action must be EDIT or VOID" }, 422);
  }

  const existing = await loadPaymentWithUser(c, principal, c.req.param("id"));
  if (!existing || existing.purged_at) return c.json({ success: false, error: "Payment not found" }, 404);
  if (existing.deleted_on || existing.status === "DELETED") {
    return c.json({ success: false, error: "Payment is scheduled for deletion" }, 422);
  }

  if (action === "VOID") {
    if (existing.status === "VOID") {
      return c.json({ success: true, data: paymentResponse(existing) });
    }
    if (existing.status === "REFUNDED" || existing.method === "REFUND") {
      return c.json({ success: false, error: "Completed refund payouts cannot be voided through the payment editor" }, 422);
    }
    const nowIso = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE payments SET status = 'VOID', updated_at = ? WHERE id = ? AND institution_id = ?`,
    )
      .bind(nowIso, existing.id, principal.institutionId)
      .run();
    await recomputeBill(c, principal.institutionId, existing.bill_id);
    await audit(c, principal, "PAYMENT_VOID", existing.id, null, {
      previousStatus: existing.status,
      amountMinor: existing.amount_minor,
      billId: existing.bill_id,
    });
    const updated = await loadPaymentWithUser(c, principal, existing.id);
    if (!updated) return c.json({ success: false, error: "Payment persistence failed" }, 500);
    return c.json({ success: true, data: paymentResponse(updated) });
  }

  if (existing.status === "VOID" || existing.status === "REFUNDED") {
    return c.json({ success: false, error: "Voided and refunded payments are immutable" }, 422);
  }

  const updates: string[] = [];
  const bindings: unknown[] = [];
  if (body.amount !== undefined) {
    if (existing.status === "APPROVED") {
      return c.json({
        success: false,
        error: "Approved payment amounts are immutable. Void the payment and submit a replacement instead.",
      }, 422);
    }
    const amountMinor = majorToMinor(body.amount);
    if (amountMinor === null) {
      return c.json({ success: false, error: "amount must be a positive value with at most two decimal places" }, 422);
    }
    updates.push("amount_minor = ?");
    bindings.push(amountMinor);
  }
  if (body.method !== undefined) {
    const method = String(body.method) as Exclude<PaymentMethod, "REFUND">;
    if (!PAYMENT_METHODS.has(method)) {
      return c.json({ success: false, error: "Invalid payment method" }, 422);
    }
    updates.push("method = ?");
    bindings.push(method);
  }
  if (Object.prototype.hasOwnProperty.call(body, "reference")) {
    const value = body.reference === null ? null : String(body.reference ?? "").trim().slice(0, 200) || null;
    updates.push("reference = ?");
    bindings.push(value);
  }
  if (Object.prototype.hasOwnProperty.call(body, "notes")) {
    const value = body.notes === null ? null : String(body.notes ?? "").trim().slice(0, 2000) || null;
    updates.push("notes = ?");
    bindings.push(value);
  }
  if (updates.length === 0) {
    return c.json({ success: false, error: "No editable fields provided" }, 422);
  }

  const nowIso = new Date().toISOString();
  updates.push("updated_at = ?");
  bindings.push(nowIso, existing.id, principal.institutionId);
  await c.env.DB.prepare(
    `UPDATE payments SET ${updates.join(", ")} WHERE id = ? AND institution_id = ?`,
  )
    .bind(...bindings)
    .run();

  await audit(c, principal, "PAYMENT_EDIT", existing.id, null, {
    previous: {
      amountMinor: existing.amount_minor,
      method: existing.method,
      reference: existing.reference,
      notes: existing.notes,
    },
  });
  const updated = await loadPaymentWithUser(c, principal, existing.id);
  if (!updated) return c.json({ success: false, error: "Payment persistence failed" }, 500);
  return c.json({ success: true, data: paymentResponse(updated) });
});

paymentRoutes.delete("/payments/:id", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;
  const principal = auth;
  const existing = await loadPaymentWithUser(c, principal, c.req.param("id"));
  if (!existing || existing.purged_at) return c.json({ success: false, error: "Payment not found" }, 404);

  if (existing.deleted_on && existing.deletion_scheduled_for) {
    return c.json({ success: true, permanentDeletion: existing.deletion_scheduled_for });
  }

  let reason: string | null = null;
  try {
    const body = await c.req.json<Record<string, unknown>>();
    if (typeof body.reason === "string" && body.reason.trim()) reason = body.reason.trim().slice(0, 1000);
  } catch {
    // A reason is optional and the golden client may send no body.
  }

  const now = new Date();
  const scheduled = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const nowIso = now.toISOString();
  const scheduledIso = scheduled.toISOString();
  await c.env.DB.prepare(
    `UPDATE payments
        SET status_before_delete = ?, status = 'DELETED', deleted_on = ?,
            deletion_scheduled_for = ?, deleted_by = ?, deletion_reason = ?,
            updated_at = ?
      WHERE id = ? AND institution_id = ?`,
  )
    .bind(
      existing.status,
      nowIso,
      scheduledIso,
      principal.id,
      reason,
      nowIso,
      existing.id,
      principal.institutionId,
    )
    .run();
  await recomputeBill(c, principal.institutionId, existing.bill_id);
  await audit(c, principal, "PAYMENT_SOFT_DELETE", existing.id, reason, {
    previousStatus: existing.status,
    deletionScheduledFor: scheduledIso,
    billId: existing.bill_id,
  });
  return c.json({ success: true, permanentDeletion: scheduledIso });
});

paymentRoutes.post("/payments/:id/restore", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;
  const principal = auth;
  const nowIso = new Date().toISOString();
  await markExpiredDeletionQueue(c, principal.institutionId, nowIso);
  const existing = await loadPaymentWithUser(c, principal, c.req.param("id"));
  if (!existing || existing.purged_at) return c.json({ success: false, error: "Payment not found" }, 404);
  if (!existing.deleted_on || existing.status !== "DELETED") {
    return c.json({ success: false, error: "This payment is not in the deletion queue" }, 422);
  }
  const restoreStatus = existing.status_before_delete;
  if (!restoreStatus || !RESTORABLE_STATUSES.has(restoreStatus)) {
    return c.json({ success: false, error: "Payment recovery state is invalid" }, 409);
  }

  await c.env.DB.prepare(
    `UPDATE payments
        SET status = ?, status_before_delete = NULL, deleted_on = NULL,
            deletion_scheduled_for = NULL, deleted_by = NULL,
            deletion_reason = NULL, updated_at = ?
      WHERE id = ? AND institution_id = ?`,
  )
    .bind(restoreStatus, nowIso, existing.id, principal.institutionId)
    .run();
  await recomputeBill(c, principal.institutionId, existing.bill_id);
  await audit(c, principal, "PAYMENT_RESTORE", existing.id, null, {
    restoredStatus: restoreStatus,
    billId: existing.bill_id,
  });
  const restored = await loadPaymentWithUser(c, principal, existing.id);
  if (!restored) return c.json({ success: false, error: "Payment persistence failed" }, 500);
  return c.json({ success: true, data: paymentResponse(restored) });
});

paymentRoutes.post("/payments/refund", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;
  const principal = auth;
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const amountMinor = majorToMinor(body.amount);
  if (!userId || amountMinor === null) {
    return c.json({ success: false, error: "userId and a positive two-decimal amount are required" }, 422);
  }

  const resident = await c.env.DB.prepare(
    `SELECT id, name FROM users
      WHERE id = ? AND institution_id = ? AND role = 'USER'
        AND deleted_at IS NULL
      LIMIT 1`,
  )
    .bind(userId, principal.institutionId)
    .first<{ id: string; name: string }>();
  if (!resident) return c.json({ success: false, error: "Resident not found" }, 404);

  const credit = await userCredit(c, principal.institutionId, userId);
  if (amountMinor > credit.creditMinor) {
    return c.json({
      success: false,
      error: `User only has ₹${minorToMajor(credit.creditMinor)} refundable credit`,
    }, 422);
  }

  let billId: string | null = null;
  if (typeof body.billId === "string" && body.billId.trim()) {
    const bill = await activeBillForUser(c, principal.institutionId, userId, body.billId.trim());
    if (!bill || bill.deleted_on || bill.purged_at || bill.status === "VOID" || bill.status === "DELETED") {
      return c.json({ success: false, error: "Selected refund bill is unavailable" }, 422);
    }
    const overpayment = Math.max(0, bill.paid_amount_minor - bill.total_amount_minor);
    if (overpayment < amountMinor) {
      return c.json({
        success: false,
        error: "Selected bill does not contain enough overpayment for this refund",
      }, 422);
    }
    billId = bill.id;
  } else {
    const overpaid = await c.env.DB.prepare(
      `SELECT id, institution_id, user_id, total_amount_minor, paid_amount_minor,
              due_amount_minor, status, due_date, deleted_on, purged_at
         FROM bills
        WHERE institution_id = ? AND user_id = ?
          AND deleted_on IS NULL AND purged_at IS NULL
          AND status IN ('PAID', 'PARTIALLY_PAID', 'OVERDUE', 'GENERATED')
          AND paid_amount_minor - total_amount_minor >= ?
        ORDER BY (paid_amount_minor - total_amount_minor) DESC, created_at DESC
        LIMIT 1`,
    )
      .bind(principal.institutionId, userId, amountMinor)
      .first<BillRow>();
    billId = overpaid?.id ?? null;
  }

  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const notes = typeof body.notes === "string" && body.notes.trim()
    ? body.notes.trim().slice(0, 2000)
    : "Refund of excess resident credit";
  await c.env.DB.prepare(
    `INSERT INTO payments
      (id, institution_id, user_id, bill_id, amount_minor, method, status,
       reference, notes, approved_by, approved_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'REFUND', 'REFUNDED', 'REFUND', ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      principal.institutionId,
      userId,
      billId,
      amountMinor,
      notes,
      principal.id,
      nowIso,
      nowIso,
      nowIso,
    )
    .run();
  await recomputeBill(c, principal.institutionId, billId);
  await audit(c, principal, "PAYMENT_REFUND", id, null, {
    userId,
    amountMinor,
    billId,
    totalCreditBeforeMinor: credit.creditMinor,
  });

  const created = await loadPaymentWithUser(c, principal, id);
  if (!created) return c.json({ success: false, error: "Refund persistence failed" }, 500);
  return c.json({ success: true, data: paymentResponse(created) }, 201);
});
